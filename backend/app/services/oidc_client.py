import base64
import json
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Final, cast
from urllib.parse import urlsplit

import httpx
from authlib.integrations.httpx_client import OAuth2Client
from authlib.jose import JsonWebKey, JsonWebToken
from authlib.oidc.core import CodeIDToken

from app.core.environment import IS_DEVELOPMENT
from app.services.oidc_http import (
    DISCOVERY_RESPONSE_LIMIT_BYTES,
    ID_TOKEN_CLOCK_SKEW_SECONDS,
    JWKS_RESPONSE_LIMIT_BYTES,
    MAX_FUTURE_IAT_SECONDS,
    TOKEN_RESPONSE_LIMIT_BYTES,
    USERINFO_RESPONSE_LIMIT_BYTES,
    ValidatedOidcHttpClient,
    validate_oidc_url,
)

ALLOWED_ID_TOKEN_ALGORITHMS: Final = ("RS256",)
DISCOVERY_SUFFIX: Final = "/.well-known/openid-configuration"


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


async def load_provider_metadata(
    http_client: ValidatedOidcHttpClient,
    issuer: str,
    *,
    development: bool = IS_DEVELOPMENT,
) -> tuple[OidcProviderMetadata, dict[str, Any]]:
    response = await http_client.request_json(
        "GET",
        _discovery_url(issuer, development=development),
        response_limit=DISCOVERY_RESPONSE_LIMIT_BYTES,
    )
    data = response.data
    discovered_issuer = _required_string(data, "issuer", OidcClientErrorCode.INVALID_METADATA)
    if discovered_issuer != issuer:
        raise OidcClientError(OidcClientErrorCode.INVALID_ISSUER, "OIDC discovery issuer does not exactly match configuration")

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
    auth_methods = _string_tuple(data, "token_endpoint_auth_methods_supported")
    if auth_methods and "client_secret_basic" not in auth_methods:
        raise OidcClientError(OidcClientErrorCode.INVALID_METADATA, "OIDC provider does not support client_secret_basic")
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
    )
    return metadata, _validate_jwks(jwks_response.data)


def build_authorization_request(
    metadata: OidcProviderMetadata,
    *,
    client_id: str,
    redirect_uri: str,
    scopes: tuple[str, ...],
    state: str,
    nonce: str,
    code_verifier: str,
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


def _decode_id_token(
    encoded_token: str,
    jwks: dict[str, Any],
    *,
    metadata: OidcProviderMetadata,
    client_id: str,
    nonce: str,
    access_token: str | None,
    now: int,
) -> dict[str, Any]:
    validator = JsonWebToken(list(ALLOWED_ID_TOKEN_ALGORITHMS))
    try:
        claims = validator.decode(
            encoded_token,
            JsonWebKey.import_key_set(jwks),
            claims_cls=CodeIDToken,
            claims_options={
                "iss": {"essential": True, "value": metadata.issuer},
                "aud": {"essential": True, "value": client_id},
                "sub": {"essential": True},
                "exp": {"essential": True},
                "iat": {"essential": True},
            },
            claims_params={"client_id": client_id, "nonce": nonce, "access_token": access_token},
        )
        claims.validate(now=now, leeway=ID_TOKEN_CLOCK_SKEW_SECONDS)
    except Exception as error:
        raise OidcClientError(OidcClientErrorCode.INVALID_ID_TOKEN, "OIDC ID token validation failed") from error
    issued_at = claims.get("iat")
    if not isinstance(issued_at, (int, float)) or issued_at > now + MAX_FUTURE_IAT_SECONDS:
        raise OidcClientError(OidcClientErrorCode.INVALID_ID_TOKEN, "OIDC ID token issued-at time is invalid")
    return dict(claims)


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
) -> NormalizedOidcClaims:
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
