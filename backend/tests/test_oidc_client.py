import time
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from authlib.jose import JsonWebKey, jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.services.oidc_client import (
    OidcClaimMapping,
    OidcClientError,
    OidcClientErrorCode,
    OidcProviderMetadata,
    build_authorization_request,
    exchange_and_validate_callback,
    load_provider_metadata,
)
from app.services.oidc_http import ValidatedOidcHttpClient

ISSUER = "https://idp.example.test"
CLIENT_ID = "sambee"
REDIRECT_URI = "https://sambee.example.test/api/auth/oidc/callback"


def _metadata() -> OidcProviderMetadata:
    return OidcProviderMetadata(
        issuer=ISSUER,
        authorization_endpoint=f"{ISSUER}/authorize",
        token_endpoint=f"{ISSUER}/token",
        jwks_uri=f"{ISSUER}/jwks",
        userinfo_endpoint=f"{ISSUER}/userinfo",
        id_token_signing_alg_values_supported=("RS256",),
        scopes_supported=("openid", "profile", "groups"),
    )


def _key_material(key_id: str) -> tuple[bytes, dict[str, Any]]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    public_jwk = JsonWebKey.import_key(public_pem, {"kid": key_id, "use": "sig", "alg": "RS256"}).as_dict()
    return private_pem, {"keys": [public_jwk]}


def _id_token(private_key: Any, key_id: str, *, nonce: str, now: int, claims: dict[str, Any] | None = None) -> str:
    payload: dict[str, Any] = {
        "iss": ISSUER,
        "sub": "provider-subject",
        "aud": CLIENT_ID,
        "exp": now + 300,
        "iat": now,
        "nonce": nonce,
        "preferred_username": "alice",
        "groups": ["sambee-users"],
    }
    payload.update(claims or {})
    return jwt.encode({"alg": "RS256", "kid": key_id}, payload, private_key).decode()


@pytest.mark.asyncio
async def test_metadata_requires_exact_issuer_and_loads_jwks_through_injected_transport() -> None:
    requested_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        if request.url.path.endswith("openid-configuration"):
            return httpx.Response(
                200,
                headers={"content-type": "application/json"},
                json={
                    "issuer": ISSUER,
                    "authorization_endpoint": f"{ISSUER}/authorize",
                    "token_endpoint": f"{ISSUER}/token",
                    "jwks_uri": f"{ISSUER}/jwks",
                    "userinfo_endpoint": f"{ISSUER}/userinfo",
                    "grant_types_supported": ["authorization_code"],
                    "token_endpoint_auth_methods_supported": ["client_secret_basic"],
                    "id_token_signing_alg_values_supported": ["RS256"],
                },
            )
        return httpx.Response(200, headers={"content-type": "application/jwk-set+json"}, json={"keys": [{"kty": "RSA"}]})

    async with ValidatedOidcHttpClient(transport=httpx.MockTransport(handler), development=False) as client:
        metadata, jwks = await load_provider_metadata(client, ISSUER, development=False)

    assert metadata.issuer == ISSUER
    assert jwks["keys"] == [{"kty": "RSA"}]
    assert requested_urls == [f"{ISSUER}/.well-known/openid-configuration", f"{ISSUER}/jwks"]


@pytest.mark.asyncio
async def test_metadata_rejects_issuer_mismatch() -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            headers={"content-type": "application/json"},
            json={
                "issuer": f"{ISSUER}/different",
                "authorization_endpoint": f"{ISSUER}/authorize",
                "token_endpoint": f"{ISSUER}/token",
                "jwks_uri": f"{ISSUER}/jwks",
                "id_token_signing_alg_values_supported": ["RS256"],
            },
        )
    )
    async with ValidatedOidcHttpClient(transport=transport, development=False) as client:
        with pytest.raises(OidcClientError) as error:
            await load_provider_metadata(client, ISSUER, development=False)
    assert error.value.code == OidcClientErrorCode.INVALID_ISSUER


def test_authorization_request_contains_state_nonce_and_pkce_s256() -> None:
    request = build_authorization_request(
        _metadata(),
        client_id=CLIENT_ID,
        redirect_uri=REDIRECT_URI,
        scopes=("openid", "profile", "groups"),
        state="state-value",
        nonce="nonce-value",
        code_verifier="v" * 64,
    )
    query = parse_qs(urlsplit(request.url).query)
    assert request.state == "state-value"
    assert query["state"] == ["state-value"]
    assert query["nonce"] == ["nonce-value"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["code_challenge"] != ["v" * 64]
    assert query["redirect_uri"] == [REDIRECT_URI]


@pytest.mark.asyncio
async def test_callback_uses_basic_auth_and_refreshes_unknown_key_once() -> None:
    now = int(time.time())
    private_key, current_jwks = _key_material("current-key")
    _, stale_jwks = _key_material("stale-key")
    encoded_token = _id_token(private_key, "current-key", nonce="nonce-value", now=now)
    refresh_count = 0

    async def refresh_jwks() -> dict[str, Any]:
        nonlocal refresh_count
        refresh_count += 1
        return current_jwks

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"].startswith("Basic ")
        body = parse_qs(request.content.decode())
        assert body["code_verifier"] == ["v" * 64]
        assert body["code"] == ["authorization-code"]
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            json={"id_token": encoded_token, "access_token": "provider-access-token"},
        )

    async with ValidatedOidcHttpClient(transport=httpx.MockTransport(handler), development=False) as client:
        claims = await exchange_and_validate_callback(
            client,
            _metadata(),
            stale_jwks,
            client_id=CLIENT_ID,
            client_secret="client-secret",
            redirect_uri=REDIRECT_URI,
            code="authorization-code",
            code_verifier="v" * 64,
            nonce="nonce-value",
            mapping=OidcClaimMapping(username="preferred_username", groups="groups", name="name", email="email"),
            refresh_jwks=refresh_jwks,
            now=now,
        )

    assert refresh_count == 1
    assert claims.subject == "provider-subject"
    assert claims.username == "alice"
    assert claims.groups == ("sambee-users",)


@pytest.mark.asyncio
async def test_userinfo_is_called_once_and_must_match_id_token_subject() -> None:
    now = int(time.time())
    private_key, jwks = _key_material("current-key")
    encoded_token = _id_token(
        private_key,
        "current-key",
        nonce="nonce-value",
        now=now,
        claims={"preferred_username": None, "groups": None},
    )
    userinfo_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal userinfo_count
        if request.url.path == "/userinfo":
            userinfo_count += 1
            return httpx.Response(
                200,
                headers={"content-type": "application/json"},
                json={"sub": "different-subject", "preferred_username": "alice", "groups": ["sambee-users"]},
            )
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            json={"id_token": encoded_token, "access_token": "provider-access-token"},
        )

    async def refresh_jwks() -> dict[str, Any]:
        raise AssertionError("known key must not refresh")

    async with ValidatedOidcHttpClient(transport=httpx.MockTransport(handler), development=False) as client:
        with pytest.raises(OidcClientError) as error:
            await exchange_and_validate_callback(
                client,
                _metadata(),
                jwks,
                client_id=CLIENT_ID,
                client_secret="client-secret",
                redirect_uri=REDIRECT_URI,
                code="authorization-code",
                code_verifier="v" * 64,
                nonce="nonce-value",
                mapping=OidcClaimMapping(username="preferred_username", groups="groups", name="name", email="email"),
                refresh_jwks=refresh_jwks,
                now=now,
            )

    assert error.value.code == OidcClientErrorCode.USERINFO_SUBJECT_MISMATCH
    assert userinfo_count == 1
