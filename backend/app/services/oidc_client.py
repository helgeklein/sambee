import base64
import hashlib
import hmac
import json
import logging
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Final, cast
from urllib.parse import urlsplit

import httpx
from authlib.integrations.httpx_client import OAuth2Client
from joserfc import jwt
from joserfc.jwk import KeySet, KeySetSerialization
from joserfc.jwt import JWTClaimsRegistry

from app.core.environment import IS_DEVELOPMENT
from app.services.oidc_http import (
    DISCOVERY_RESPONSE_LIMIT_BYTES,
    ID_TOKEN_CLOCK_SKEW_SECONDS,
    JWKS_RESPONSE_LIMIT_BYTES,
    MAX_FUTURE_IAT_SECONDS,
    OIDC_CACHE_MAX_AGE_SECONDS,
    TOKEN_RESPONSE_LIMIT_BYTES,
    USERINFO_RESPONSE_LIMIT_BYTES,
    OidcHttpError,
    ValidatedOidcHttpClient,
    validate_oidc_url,
)

ALLOWED_ID_TOKEN_ALGORITHMS: Final = ("RS256",)
DISCOVERY_SUFFIX: Final = "/.well-known/openid-configuration"
OIDC_PROVIDER_CACHE_MAX_ENTRIES: Final = 64

logger = logging.getLogger(__name__)


class OidcClientErrorCode(StrEnum):
    INVALID_ISSUER = "invalid_issuer"
    INVALID_METADATA = "invalid_metadata"
    INVALID_JWKS = "invalid_jwks"
    TOKEN_EXCHANGE_FAILED = "token_exchange_failed"
    INVALID_ID_TOKEN = "invalid_id_token"
    USERINFO_UNAVAILABLE = "userinfo_unavailable"
    USERINFO_SUBJECT_MISMATCH = "userinfo_subject_mismatch"
    REQUIRED_CLAIM_MISSING = "required_claim_missing"


class OidcClientError(Exception):
    def __init__(self, code: OidcClientErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class OidcProviderMetadata:
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    userinfo_endpoint: str | None
    id_token_signing_alg_values_supported: tuple[str, ...]
    scopes_supported: tuple[str, ...]
    grant_types_supported: tuple[str, ...] = ()
    code_challenge_methods_supported: tuple[str, ...] = ()


@dataclass(frozen=True)
class OidcAuthorizationRequest:
    url: str
    state: str


@dataclass(frozen=True)
class OidcClaimMapping:
    username: str
    groups: str | None
    name: str | None
    email: str | None


@dataclass(frozen=True)
class NormalizedOidcClaims:
    issuer: str
    subject: str
    username: str
    groups: tuple[str, ...]
    name: str | None
    email: str | None


@dataclass(frozen=True)
class ValidatedOidcTokenSet:
    claims: NormalizedOidcClaims
    authenticated_at: int | None
    provider_access_token: str | None
    refresh_token: str | None

    @property
    def issuer(self) -> str:
        return self.claims.issuer

    @property
    def subject(self) -> str:
        return self.claims.subject

    @property
    def username(self) -> str:
        return self.claims.username

    @property
    def groups(self) -> tuple[str, ...]:
        return self.claims.groups

    @property
    def name(self) -> str | None:
        return self.claims.name

    @property
    def email(self) -> str | None:
        return self.claims.email


class OidcRefreshErrorCode(StrEnum):
    PERMANENT = "permanent"
    AMBIGUOUS = "ambiguous"


class OidcRefreshError(OidcClientError):
    def __init__(self, code: OidcRefreshErrorCode, message: str) -> None:
        super().__init__(OidcClientErrorCode.TOKEN_EXCHANGE_FAILED, message)
        self.refresh_code = code


@dataclass(frozen=True)
class _CachedProvider:
    metadata: OidcProviderMetadata
    jwks: dict[str, Any]
    expires_at: float


_PROVIDER_CACHE: OrderedDict[str, _CachedProvider] = OrderedDict()


JwksLoader = Callable[[], Awaitable[dict[str, Any]]]


def _required_string(data: Mapping[str, Any], key: str, error_code: OidcClientErrorCode) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value:
        raise OidcClientError(error_code, f"OIDC response is missing a valid {key}")
    return value


def _optional_string(data: Mapping[str, Any], key: str) -> str | None:
    value = data.get(key)
    return value if isinstance(value, str) and value else None


def _string_tuple(data: Mapping[str, Any], key: str) -> tuple[str, ...]:
    value = data.get(key)
    if value is None:
        return ()
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise OidcClientError(OidcClientErrorCode.INVALID_METADATA, f"OIDC metadata contains an invalid {key}")
    return tuple(cast(list[str], value))


def _discovery_url(issuer: str, *, development: bool) -> str:
    validate_oidc_url(issuer, development=development)
    parsed = urlsplit(issuer)
    if parsed.query:
        raise OidcClientError(OidcClientErrorCode.INVALID_ISSUER, "OIDC issuer must not contain a query")
    return issuer.rstrip("/") + DISCOVERY_SUFFIX


def _validate_jwks(data: dict[str, Any]) -> dict[str, Any]:
    keys = data.get("keys")
    if not isinstance(keys, list) or not keys or any(not isinstance(key, dict) for key in keys):
        raise OidcClientError(OidcClientErrorCode.INVALID_JWKS, "OIDC JWKS must contain at least one key")
    return data


def _cache_ttl(headers: httpx.Headers) -> int:
    directives = {part.strip().lower() for value in headers.get_list("cache-control") for part in value.split(",")}
    if directives.intersection({"no-store", "no-cache", "private"}):
        return 0
    max_age = next((directive.partition("=")[2].strip('"') for directive in directives if directive.startswith("max-age=")), None)
    if max_age is None or not max_age.isdigit():
        return 0
    age = headers.get("age", "0").strip()
    current_age = int(age) if age.isdigit() else 0
    return max(0, min(int(max_age), OIDC_CACHE_MAX_AGE_SECONDS) - current_age)


def _store_cached_provider(
    issuer: str,
    metadata: OidcProviderMetadata,
    jwks: dict[str, Any],
    ttl: int,
) -> None:
    if ttl <= 0:
        _PROVIDER_CACHE.pop(issuer, None)
        return
    _PROVIDER_CACHE[issuer] = _CachedProvider(metadata=metadata, jwks=jwks, expires_at=time.monotonic() + ttl)
    _PROVIDER_CACHE.move_to_end(issuer)
    while len(_PROVIDER_CACHE) > OIDC_PROVIDER_CACHE_MAX_ENTRIES:
        _PROVIDER_CACHE.popitem(last=False)


def clear_oidc_provider_cache() -> None:
    _PROVIDER_CACHE.clear()


async def load_provider_metadata(
    http_client: ValidatedOidcHttpClient,
    issuer: str,
    *,
    development: bool = IS_DEVELOPMENT,
) -> tuple[OidcProviderMetadata, dict[str, Any]]:
    cached = _PROVIDER_CACHE.get(issuer)
    if cached is not None:
        if cached.expires_at > time.monotonic():
            _PROVIDER_CACHE.move_to_end(issuer)
            return cached.metadata, cached.jwks
        _PROVIDER_CACHE.pop(issuer, None)
    response = await http_client.request_json(
        "GET",
        _discovery_url(issuer, development=development),
        response_limit=DISCOVERY_RESPONSE_LIMIT_BYTES,
    )
    data = response.data
    discovered_issuer = _required_string(data, "issuer", OidcClientErrorCode.INVALID_METADATA)
    if discovered_issuer != issuer:
        logger.warning(
            "OIDC discovery issuer does not match configured issuer: configured %r, discovered %r",
            issuer,
            discovered_issuer,
        )
        raise OidcClientError(
            OidcClientErrorCode.INVALID_ISSUER,
            f"OIDC discovery issuer does not exactly match the configured issuer: configured {issuer!r}, discovered {discovered_issuer!r}",
        )

    authorization_endpoint = _required_string(data, "authorization_endpoint", OidcClientErrorCode.INVALID_METADATA)
    token_endpoint = _required_string(data, "token_endpoint", OidcClientErrorCode.INVALID_METADATA)
    jwks_uri = _required_string(data, "jwks_uri", OidcClientErrorCode.INVALID_METADATA)
    userinfo_endpoint = _optional_string(data, "userinfo_endpoint")
    for endpoint in (authorization_endpoint, token_endpoint, jwks_uri, userinfo_endpoint):
        if endpoint is not None:
            validate_oidc_url(endpoint, development=development)

    grant_types = _string_tuple(data, "grant_types_supported")
    if grant_types and "authorization_code" not in grant_types:
        raise OidcClientError(OidcClientErrorCode.INVALID_METADATA, "OIDC provider does not advertise authorization code support")
    if grant_types and "refresh_token" not in grant_types:
        raise OidcClientError(OidcClientErrorCode.INVALID_METADATA, "OIDC provider does not advertise refresh token support")
    auth_methods = _string_tuple(data, "token_endpoint_auth_methods_supported")
    if auth_methods and "client_secret_basic" not in auth_methods:
        raise OidcClientError(OidcClientErrorCode.INVALID_METADATA, "OIDC provider does not support client_secret_basic")
    code_challenge_methods = _string_tuple(data, "code_challenge_methods_supported")
    if code_challenge_methods and "S256" not in code_challenge_methods:
        raise OidcClientError(OidcClientErrorCode.INVALID_METADATA, "OIDC provider does not support PKCE S256")
    algorithms = _string_tuple(data, "id_token_signing_alg_values_supported")
    if not set(algorithms).intersection(ALLOWED_ID_TOKEN_ALGORITHMS):
        raise OidcClientError(OidcClientErrorCode.INVALID_METADATA, "OIDC provider does not support an allowed ID-token algorithm")

    jwks_response = await http_client.request_json("GET", jwks_uri, response_limit=JWKS_RESPONSE_LIMIT_BYTES)
    metadata = OidcProviderMetadata(
        issuer=discovered_issuer,
        authorization_endpoint=authorization_endpoint,
        token_endpoint=token_endpoint,
        jwks_uri=jwks_uri,
        userinfo_endpoint=userinfo_endpoint,
        id_token_signing_alg_values_supported=algorithms,
        scopes_supported=_string_tuple(data, "scopes_supported"),
        grant_types_supported=grant_types,
        code_challenge_methods_supported=code_challenge_methods,
    )
    jwks = _validate_jwks(jwks_response.data)
    _store_cached_provider(issuer, metadata, jwks, min(_cache_ttl(response.headers), _cache_ttl(jwks_response.headers)))
    return metadata, jwks


async def refresh_provider_jwks(
    http_client: ValidatedOidcHttpClient,
    metadata: OidcProviderMetadata,
) -> dict[str, Any]:
    response = await http_client.request_json("GET", metadata.jwks_uri, response_limit=JWKS_RESPONSE_LIMIT_BYTES)
    jwks = _validate_jwks(response.data)
    cached = _PROVIDER_CACHE.get(metadata.issuer)
    if cached is not None and cached.metadata == metadata and cached.expires_at > time.monotonic():
        remaining_ttl = max(0, int(cached.expires_at - time.monotonic()))
        _store_cached_provider(metadata.issuer, metadata, jwks, min(remaining_ttl, _cache_ttl(response.headers)))
    else:
        _PROVIDER_CACHE.pop(metadata.issuer, None)
    return jwks


def build_authorization_request(
    metadata: OidcProviderMetadata,
    *,
    client_id: str,
    redirect_uri: str,
    scopes: tuple[str, ...],
    state: str,
    nonce: str,
    code_verifier: str,
    max_age: int | None = None,
    prompt: str | None = None,
) -> OidcAuthorizationRequest:
    client = OAuth2Client(
        client_id=client_id,
        redirect_uri=redirect_uri,
        scope=" ".join(scopes),
        code_challenge_method="S256",
    )
    url, returned_state = client.create_authorization_url(
        metadata.authorization_endpoint,
        state=state,
        nonce=nonce,
        code_verifier=code_verifier,
        response_type="code",
        **({"max_age": max_age} if max_age is not None else {}),
        **({"prompt": prompt} if prompt is not None else {}),
    )
    cast(httpx.Client, client).close()
    if returned_state != state:
        raise OidcClientError(OidcClientErrorCode.INVALID_METADATA, "OIDC library did not preserve authorization state")
    return OidcAuthorizationRequest(url=url, state=returned_state)


def _token_key_id(encoded_token: str) -> str | None:
    try:
        encoded_header = encoded_token.split(".", 1)[0]
        padding = "=" * (-len(encoded_header) % 4)
        header = json.loads(base64.urlsafe_b64decode(encoded_header + padding))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise OidcClientError(OidcClientErrorCode.INVALID_ID_TOKEN, "OIDC ID token has an invalid header") from error
    if not isinstance(header, dict):
        raise OidcClientError(OidcClientErrorCode.INVALID_ID_TOKEN, "OIDC ID token has an invalid header")
    key_id = header.get("kid")
    return key_id if isinstance(key_id, str) else None


def _jwks_contains_key(jwks: Mapping[str, Any], key_id: str | None) -> bool:
    keys = jwks.get("keys")
    return isinstance(keys, list) and any(isinstance(key, dict) and key.get("kid") == key_id for key in keys)


def _validate_oidc_claims(
    claims: dict[str, Any],
    header: Mapping[str, Any],
    *,
    issuer: str,
    client_id: str,
    nonce: str | None,
    access_token: str | None,
    now: int,
) -> None:
    JWTClaimsRegistry(
        now=now,
        leeway=ID_TOKEN_CLOCK_SKEW_SECONDS,
        iss={"essential": True, "value": issuer},
        sub={"essential": True},
        aud={"essential": True, "value": client_id},
        exp={"essential": True},
        iat={"essential": True},
    ).validate(claims)
    if nonce is not None and claims.get("nonce") != nonce:
        raise ValueError("OIDC ID token nonce does not match the authorization request")
    auth_time = claims.get("auth_time")
    if auth_time is not None and (isinstance(auth_time, bool) or not isinstance(auth_time, (int, float))):
        raise ValueError("OIDC ID token authentication time is invalid")
    authentication_methods = claims.get("amr")
    if authentication_methods is not None and (
        not isinstance(authentication_methods, list) or any(not isinstance(method, str) for method in authentication_methods)
    ):
        raise ValueError("OIDC ID token authentication methods are invalid")

    audience = claims["aud"]
    if isinstance(audience, list) and len(audience) == 1:
        audience = audience[0]
    if "azp" in claims:
        authorized_party = claims["azp"]
        if not isinstance(authorized_party, str) or authorized_party != client_id:
            raise ValueError("OIDC ID token authorized party does not match the client")
    elif audience != client_id:
        raise ValueError("OIDC ID token is missing its authorized party")

    access_token_hash = claims.get("at_hash")
    if access_token_hash is not None:
        if access_token is None or not isinstance(access_token_hash, str) or header.get("alg") != "RS256":
            raise ValueError("OIDC ID token has an invalid access-token hash")
        digest = hashlib.sha256(access_token.encode("ascii")).digest()
        expected_hash = base64.urlsafe_b64encode(digest[: len(digest) // 2]).rstrip(b"=").decode("ascii")
        if not hmac.compare_digest(access_token_hash, expected_hash):
            raise ValueError("OIDC ID token access-token hash does not match")


def _decode_id_token(
    encoded_token: str,
    jwks: dict[str, Any],
    *,
    metadata: OidcProviderMetadata,
    client_id: str,
    nonce: str | None,
    access_token: str | None,
    now: int,
) -> dict[str, Any]:
    try:
        token = jwt.decode(
            encoded_token,
            KeySet.import_key_set(cast(KeySetSerialization, jwks)),
            algorithms=ALLOWED_ID_TOKEN_ALGORITHMS,
        )
        _validate_oidc_claims(
            token.claims,
            token.header,
            issuer=metadata.issuer,
            client_id=client_id,
            nonce=nonce,
            access_token=access_token,
            now=now,
        )
    except Exception as error:
        raise OidcClientError(OidcClientErrorCode.INVALID_ID_TOKEN, "OIDC ID token validation failed") from error
    issued_at = token.claims.get("iat")
    if not isinstance(issued_at, (int, float)) or issued_at > now + MAX_FUTURE_IAT_SECONDS:
        raise OidcClientError(OidcClientErrorCode.INVALID_ID_TOKEN, "OIDC ID token issued-at time is invalid")
    return dict(token.claims)


async def _load_userinfo(
    http_client: ValidatedOidcHttpClient,
    metadata: OidcProviderMetadata,
    access_token: str | None,
    subject: str,
) -> dict[str, Any]:
    if metadata.userinfo_endpoint is None or access_token is None:
        raise OidcClientError(OidcClientErrorCode.USERINFO_UNAVAILABLE, "OIDC UserInfo is unavailable")
    response = await http_client.request_json(
        "GET",
        metadata.userinfo_endpoint,
        response_limit=USERINFO_RESPONSE_LIMIT_BYTES,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if response.data.get("sub") != subject:
        raise OidcClientError(OidcClientErrorCode.USERINFO_SUBJECT_MISMATCH, "OIDC UserInfo subject does not match the ID token")
    return response.data


def _claim_string(claims: Mapping[str, Any], name: str | None) -> str | None:
    if name is None:
        return None
    value = claims.get(name)
    return value if isinstance(value, str) and value else None


def _claim_groups(claims: Mapping[str, Any], name: str | None) -> tuple[str, ...] | None:
    if name is None:
        return ()
    value = claims.get(name)
    if not isinstance(value, list) or any(not isinstance(group, str) for group in value):
        return None
    return tuple(cast(list[str], value))


async def exchange_and_validate_callback(
    http_client: ValidatedOidcHttpClient,
    metadata: OidcProviderMetadata,
    jwks: dict[str, Any],
    *,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    code: str,
    code_verifier: str,
    nonce: str,
    mapping: OidcClaimMapping,
    refresh_jwks: JwksLoader,
    now: int | None = None,
) -> ValidatedOidcTokenSet:
    token_response = await http_client.request_json(
        "POST",
        metadata.token_endpoint,
        response_limit=TOKEN_RESPONSE_LIMIT_BYTES,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        },
        auth=httpx.BasicAuth(client_id, client_secret),
    )
    encoded_id_token = token_response.data.get("id_token")
    access_token_value = token_response.data.get("access_token")
    if not isinstance(encoded_id_token, str):
        raise OidcClientError(OidcClientErrorCode.TOKEN_EXCHANGE_FAILED, "OIDC token response did not contain an ID token")
    access_token = access_token_value if isinstance(access_token_value, str) else None

    key_id = _token_key_id(encoded_id_token)
    if not _jwks_contains_key(jwks, key_id):
        jwks = _validate_jwks(await refresh_jwks())
    claims = _decode_id_token(
        encoded_id_token,
        jwks,
        metadata=metadata,
        client_id=client_id,
        nonce=nonce,
        access_token=access_token,
        now=int(time.time()) if now is None else now,
    )
    normalized_claims = await _normalize_oidc_claims(
        http_client,
        metadata,
        claims=claims,
        access_token=access_token,
        mapping=mapping,
    )
    refresh_token_value = token_response.data.get("refresh_token")
    return ValidatedOidcTokenSet(
        claims=normalized_claims,
        authenticated_at=_authentication_time(claims),
        provider_access_token=access_token,
        refresh_token=refresh_token_value if isinstance(refresh_token_value, str) and refresh_token_value else None,
    )


def _authentication_time(claims: Mapping[str, Any]) -> int | None:
    value = claims.get("auth_time")
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise OidcClientError(OidcClientErrorCode.INVALID_ID_TOKEN, "OIDC ID token authentication time is invalid")
    return int(value)


async def _normalize_oidc_claims(
    http_client: ValidatedOidcHttpClient,
    metadata: OidcProviderMetadata,
    *,
    claims: dict[str, Any],
    access_token: str | None,
    mapping: OidcClaimMapping,
) -> NormalizedOidcClaims:
    subject = _required_string(claims, "sub", OidcClientErrorCode.INVALID_ID_TOKEN)
    username = _claim_string(claims, mapping.username)
    groups = _claim_groups(claims, mapping.groups)
    if username is None or groups is None:
        userinfo = await _load_userinfo(http_client, metadata, access_token, subject)
        username = username or _claim_string(userinfo, mapping.username)
        groups = groups if groups is not None else _claim_groups(userinfo, mapping.groups)
        claims = {**userinfo, **claims}
    if username is None or groups is None:
        raise OidcClientError(OidcClientErrorCode.REQUIRED_CLAIM_MISSING, "OIDC required identity claim is missing")
    return NormalizedOidcClaims(
        issuer=metadata.issuer,
        subject=subject,
        username=username,
        groups=groups,
        name=_claim_string(claims, mapping.name),
        email=_claim_string(claims, mapping.email),
    )


async def exchange_and_validate_refresh_token(
    http_client: ValidatedOidcHttpClient,
    metadata: OidcProviderMetadata,
    jwks: dict[str, Any],
    *,
    client_id: str,
    client_secret: str,
    refresh_token: str,
    expected_issuer: str,
    expected_subject: str,
    mapping: OidcClaimMapping,
    refresh_jwks: JwksLoader,
    now: int | None = None,
) -> ValidatedOidcTokenSet:
    """Exchange a refresh token without replaying a failed token-grant request."""

    try:
        token_response = await http_client.request_json(
            "POST",
            metadata.token_endpoint,
            response_limit=TOKEN_RESPONSE_LIMIT_BYTES,
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
            auth=httpx.BasicAuth(client_id, client_secret),
            accepted_error_statuses=frozenset({400, 401}),
        )
    except OidcHttpError as error:
        raise OidcRefreshError(OidcRefreshErrorCode.AMBIGUOUS, "OIDC refresh token delivery outcome is unknown") from error
    if token_response.status_code >= 400:
        error_code = token_response.data.get("error")
        if error_code in {"invalid_grant", "invalid_client", "unauthorized_client"}:
            raise OidcRefreshError(OidcRefreshErrorCode.PERMANENT, "OIDC refresh token was rejected")
        raise OidcRefreshError(OidcRefreshErrorCode.AMBIGUOUS, "OIDC refresh token delivery outcome is unknown")

    try:
        access_token_value = token_response.data.get("access_token")
        access_token = access_token_value if isinstance(access_token_value, str) and access_token_value else None
        encoded_id_token = token_response.data.get("id_token")
        if isinstance(encoded_id_token, str) and encoded_id_token:
            key_id = _token_key_id(encoded_id_token)
            if not _jwks_contains_key(jwks, key_id):
                jwks = _validate_jwks(await refresh_jwks())
            claims = _decode_id_token(
                encoded_id_token,
                jwks,
                metadata=metadata,
                client_id=client_id,
                nonce=None,
                access_token=access_token,
                now=int(time.time()) if now is None else now,
            )
        else:
            if access_token is None:
                raise OidcRefreshError(OidcRefreshErrorCode.PERMANENT, "OIDC refresh response is incomplete")
            claims = await _load_userinfo(http_client, metadata, access_token, expected_subject)
            claims = {**claims, "iss": expected_issuer, "sub": expected_subject}
        normalized_claims = await _normalize_oidc_claims(
            http_client,
            metadata,
            claims=claims,
            access_token=access_token,
            mapping=mapping,
        )
        if normalized_claims.issuer != expected_issuer or normalized_claims.subject != expected_subject:
            raise OidcRefreshError(OidcRefreshErrorCode.PERMANENT, "OIDC refresh identity changed")
        rotated_token = token_response.data.get("refresh_token")
        return ValidatedOidcTokenSet(
            claims=normalized_claims,
            authenticated_at=_authentication_time(claims),
            provider_access_token=access_token,
            refresh_token=rotated_token if isinstance(rotated_token, str) and rotated_token else None,
        )
    except OidcRefreshError:
        raise
    except Exception as error:
        # The provider may have rotated the submitted refresh token before a
        # response-validation or userinfo failure. Retrying the old token is unsafe.
        raise OidcRefreshError(OidcRefreshErrorCode.AMBIGUOUS, "OIDC refresh result could not be validated") from error
