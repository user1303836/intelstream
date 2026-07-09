from unittest.mock import patch

import httpx
import pytest

from intelstream.utils.safe_http import SafeHTTPError, safe_request
from intelstream.utils.url_validation import SSRFError


async def test_safe_request_follows_relative_redirect_and_reads_body() -> None:
    requested_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        if request.url.path == "/start":
            return httpx.Response(302, headers={"location": "/final"})
        return httpx.Response(200, text="finished")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with patch("intelstream.utils.safe_http.validate_url_for_ssrf"):
            response = await safe_request(client, "GET", "https://example.com/start")

    assert response.text == "finished"
    assert requested_urls == ["https://example.com/start", "https://example.com/final"]


async def test_safe_request_blocks_private_redirect_before_second_request() -> None:
    requested_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://127.0.0.1/admin"})

    def validate(url: str) -> None:
        if url.startswith("http://127.0.0.1"):
            raise SSRFError("private address")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with patch("intelstream.utils.safe_http.validate_url_for_ssrf", side_effect=validate):
            with pytest.raises(SafeHTTPError, match="Redirect blocked"):
                await safe_request(client, "GET", "https://example.com/start")

    assert requested_urls == ["https://example.com/start"]


async def test_safe_request_rejects_content_length_over_limit_without_reading() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-length": "100"},
            content=b"small",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with (
            patch("intelstream.utils.safe_http.validate_url_for_ssrf"),
            pytest.raises(SafeHTTPError, match="10 byte limit"),
        ):
            await safe_request(
                client,
                "GET",
                "https://example.com/large",
                max_response_bytes=10,
            )


async def test_safe_request_rejects_streamed_body_over_limit() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"eleven-byte")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with (
            patch("intelstream.utils.safe_http.validate_url_for_ssrf"),
            pytest.raises(SafeHTTPError, match="10 byte limit"),
        ):
            await safe_request(
                client,
                "GET",
                "https://example.com/large",
                max_response_bytes=10,
            )


async def test_safe_request_enforces_redirect_limit() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": f"/next{request.url.path}"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with (
            patch("intelstream.utils.safe_http.validate_url_for_ssrf"),
            pytest.raises(SafeHTTPError, match="Too many redirects"),
        ):
            await safe_request(
                client,
                "GET",
                "https://example.com/start",
                max_redirects=2,
            )
