import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.services.oidc_http import (
    MAX_CONCURRENT_OIDC_REQUESTS,
    OidcHttpError,
    OidcHttpErrorCode,
    ValidatedNetworkBackend,
    ValidatedOidcHttpClient,
    ValidatedOidcTransport,
    validate_oidc_url,
    validate_resolved_address,
)


@pytest.mark.parametrize(
    "url",
    [
        "http://idp.example.test",
        "https://user@idp.example.test",
        "https://idp.example.test/path#fragment",
        "/relative",
    ],
)
def test_oidc_url_rejects_unsafe_destinations(url: str) -> None:
    with pytest.raises(OidcHttpError) as error:
        validate_oidc_url(url, development=False)

    assert error.value.code == OidcHttpErrorCode.INVALID_URL


def test_oidc_url_allows_only_literal_loopback_http_in_development() -> None:
    validate_oidc_url("http://127.0.0.1:9000/issuer", development=True)
    validate_oidc_url("http://[::1]:9000/issuer", development=True)
    validate_oidc_url("http://localhost:9000/issuer", development=True)

    with pytest.raises(OidcHttpError):
        validate_oidc_url("http://idp.internal/issuer", development=True)


@pytest.mark.parametrize("address", ["0.0.0.0", "169.254.169.254", "224.0.0.1", "240.0.0.1", "127.0.0.1"])
def test_resolved_address_rejects_forbidden_production_ranges(address: str) -> None:
    with pytest.raises(OidcHttpError) as error:
        validate_resolved_address(address, development=False)

    assert error.value.code == OidcHttpErrorCode.FORBIDDEN_ADDRESS


def test_resolved_address_allows_private_unicast() -> None:
    validate_resolved_address("10.20.30.40", development=False)


@pytest.mark.asyncio
async def test_transport_adapts_httpcore_response_streams_for_httpx() -> None:
    class CoreStream:
        def __init__(self) -> None:
            self.closed = False

        async def __aiter__(self):
            yield b"{}"

        async def aclose(self) -> None:
            self.closed = True

    stream = CoreStream()
    transport = ValidatedOidcTransport(development=False)
    transport._pool.handle_async_request = AsyncMock(
        return_value=SimpleNamespace(status=200, headers=[(b"content-type", b"application/json")], stream=stream, extensions={})
    )

    response = await transport.handle_async_request(httpx.Request("GET", "https://idp.example.test/metadata"))

    assert await response.aread() == b"{}"
    assert stream.closed is True
    await transport.aclose()


@pytest.mark.asyncio
async def test_network_backend_rejects_all_results_if_one_is_forbidden() -> None:
    async def resolver(host: str, port: int) -> list[str]:
        return ["10.20.30.40", "169.254.169.254"]

    backend = ValidatedNetworkBackend(resolver=resolver, development=False)
    with pytest.raises(OidcHttpError) as error:
        await backend.connect_tcp("idp.example.test", 443)

    assert error.value.code == OidcHttpErrorCode.FORBIDDEN_ADDRESS


@pytest.mark.asyncio
async def test_response_limit_accepts_exact_size_and_rejects_one_byte_over() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(200, headers={"content-type": "application/json"}, content=b"{}"))
    async with ValidatedOidcHttpClient(transport=transport, development=False) as client:
        response = await client.request_json("GET", "https://idp.example.test/data", response_limit=2)
        assert response.data == {}

        with pytest.raises(OidcHttpError) as error:
            await client.request_json("GET", "https://idp.example.test/data", response_limit=1)

    assert error.value.code == OidcHttpErrorCode.RESPONSE_TOO_LARGE


@pytest.mark.asyncio
async def test_redirects_and_non_json_responses_are_rejected() -> None:
    redirect_transport = httpx.MockTransport(lambda request: httpx.Response(302, headers={"location": "https://other.example.test"}))
    async with ValidatedOidcHttpClient(transport=redirect_transport, development=False) as client:
        with pytest.raises(OidcHttpError) as redirect_error:
            await client.request_json("GET", "https://idp.example.test/data", response_limit=100)
    assert redirect_error.value.code == OidcHttpErrorCode.REDIRECT_REJECTED

    html_transport = httpx.MockTransport(lambda request: httpx.Response(200, headers={"content-type": "text/html"}, content=b"{}"))
    async with ValidatedOidcHttpClient(transport=html_transport, development=False) as client:
        with pytest.raises(OidcHttpError) as content_error:
            await client.request_json("GET", "https://idp.example.test/data", response_limit=100)
    assert content_error.value.code == OidcHttpErrorCode.INVALID_CONTENT_TYPE


@pytest.mark.asyncio
async def test_outbound_request_concurrency_is_bounded() -> None:
    active = 0
    peak = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return httpx.Response(200, headers={"content-type": "application/json"}, content=b"{}")

    transport = httpx.MockTransport(handler)
    async with (
        ValidatedOidcHttpClient(transport=transport, development=False) as first_client,
        ValidatedOidcHttpClient(transport=transport, development=False) as second_client,
    ):
        await asyncio.gather(
            *(first_client.request_json("GET", "https://idp.example.test/data", response_limit=100) for _ in range(8)),
            *(second_client.request_json("GET", "https://idp.example.test/data", response_limit=100) for _ in range(8)),
        )

    assert peak == MAX_CONCURRENT_OIDC_REQUESTS
