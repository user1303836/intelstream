from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urljoin

import httpx

from intelstream.utils.url_validation import SSRFError, validate_url_for_ssrf

DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
DEFAULT_MAX_REDIRECTS = 10


class SafeHTTPError(Exception):
    """Raised when an HTTP response violates a fetch safety limit."""


async def safe_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    validate_ssrf: bool = True,
    **kwargs: Any,
) -> httpx.Response:
    if max_response_bytes < 1:
        raise ValueError("max_response_bytes must be positive")
    if max_redirects < 0:
        raise ValueError("max_redirects cannot be negative")

    if validate_ssrf:
        _validate_url(url)

    current_url = url
    redirects_followed = 0

    while True:
        async with _stream_response(client, method, current_url, **kwargs) as response:
            if response.is_redirect:
                if redirects_followed >= max_redirects:
                    raise SafeHTTPError("Too many redirects")

                redirect_url = _redirect_url(response)
                if validate_ssrf:
                    _validate_url(redirect_url, redirect=True)
                current_url = redirect_url
                redirects_followed += 1
                continue

            content = await _read_limited(response, max_response_bytes)
            return httpx.Response(
                status_code=response.status_code,
                headers=response.headers,
                content=content,
                request=response.request,
                extensions=response.extensions,
            )


@asynccontextmanager
async def _stream_response(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    **kwargs: Any,
) -> AsyncIterator[httpx.Response]:
    async with client.stream(
        method,
        url,
        follow_redirects=False,
        **kwargs,
    ) as response:
        yield response


def _validate_url(url: str, *, redirect: bool = False) -> None:
    try:
        validate_url_for_ssrf(url)
    except SSRFError as exc:
        prefix = "Redirect" if redirect else "URL"
        raise SafeHTTPError(f"{prefix} blocked by SSRF protection: {exc}") from exc


def _redirect_url(response: httpx.Response) -> str:
    if response.next_request is not None:
        return str(response.next_request.url)

    location = response.headers.get("location")
    if not location:
        raise SafeHTTPError("Redirect without a target URL")
    return str(urljoin(str(response.request.url), str(location)))


async def _read_limited(response: httpx.Response, max_response_bytes: int) -> bytes:
    content_length = response.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > max_response_bytes:
                raise SafeHTTPError(f"Response exceeds {max_response_bytes} byte limit")
        except ValueError:
            pass

    content = bytearray()
    async for chunk in response.aiter_bytes():
        content.extend(chunk)
        if len(content) > max_response_bytes:
            raise SafeHTTPError(f"Response exceeds {max_response_bytes} byte limit")
    return bytes(content)
