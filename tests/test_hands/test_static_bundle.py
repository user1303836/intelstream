from __future__ import annotations

from importlib import resources
from typing import TYPE_CHECKING

import aiohttp
import pytest
from scripts.check_hands_wheel import (
    EXPECTED,
    PREFIX,
    REVIEWED_SDK_URL_LITERALS,
    validate_bundle,
)

from intelstream.hands.server import SECURITY_HEADERS, HandsServer

if TYPE_CHECKING:
    from importlib.resources.abc import Traversable

EXPECTED_RELATIVE = {
    "index.html",
    "assets/hands.js",
    "assets/hands.css",
}


def _files(root: Traversable, prefix: str = "") -> set[str]:
    found: set[str] = set()
    for child in root.iterdir():
        path = f"{prefix}{child.name}"
        if child.is_dir():
            found.update(_files(child, f"{path}/"))
        elif child.is_file():
            found.add(path)
    return found


def _bundle() -> dict[str, bytes]:
    root = resources.files("intelstream.hands").joinpath("static")
    return {
        f"{PREFIX}{path}": root.joinpath(*path.split("/")).read_bytes()
        for path in EXPECTED_RELATIVE
    }


def test_package_resources_are_exact_nonempty_stable_bundle() -> None:
    root = resources.files("intelstream.hands").joinpath("static")
    assert _files(root) == EXPECTED_RELATIVE
    bundle = _bundle()
    assert set(bundle) == EXPECTED
    assert all(bundle.values())


def test_bundle_has_relative_refs_and_no_executable_or_sensitive_build_content() -> None:
    errors = validate_bundle(_bundle())
    assert errors == [], "\n".join(errors)


def _bundle_with_javascript(source: str) -> dict[str, bytes]:
    bundle = _bundle()
    bundle[f"{PREFIX}assets/hands.js"] = source.encode()
    return bundle


def test_package_scanner_accepts_exact_reviewed_sdk_url_allowlist() -> None:
    source = "\n".join(
        f"const sdkUrl{index} = {'SDK metadata: ' + url!r};"
        for index, url in enumerate(sorted(REVIEWED_SDK_URL_LITERALS))
    )
    assert validate_bundle(_bundle_with_javascript(source)) == []


@pytest.mark.parametrize(
    "source",
    [
        "const indirect = 'https://evil.example/steal'; consume(indirect)",
        "const indirect = '//evil.example/steal'; consume(indirect)",
    ],
)
def test_package_scanner_rejects_indirect_unreviewed_endpoint(source: str) -> None:
    errors = validate_bundle(_bundle_with_javascript(source))
    assert any("unreviewed external URL literal" in error for error in errors)


def test_package_scanner_rejects_unquoted_css_endpoint() -> None:
    bundle = _bundle()
    bundle[f"{PREFIX}assets/hands.css"] = b"body{background:url(https://evil.example/x)}"
    errors = validate_bundle(bundle)
    assert any("unreviewed external URL literal" in error for error in errors)


@pytest.mark.parametrize(
    "source",
    [
        "const config = {'client_secret': 'value'}",
        "const leaked = config['client-secret']",
        "const config = {'bot_token': 'value'}",
        "const leaked = config['bot-token']",
    ],
)
def test_package_scanner_rejects_server_only_identifier(source: str) -> None:
    errors = validate_bundle(_bundle_with_javascript(source))
    assert any("sensitive server-only identifier" in error for error in errors)


class _Closable:
    ticket_ttl_seconds = 300

    async def close(self) -> None:
        pass


async def test_packaged_server_serves_exact_bundle_with_mime_cache_and_security_headers() -> None:
    server = HandsServer(
        repository=object(),  # type: ignore[arg-type]
        application_id="123456789",
        guild_id="987654321",
        client_secret="not-bundled",
        bot_token="not-bundled",
        host="127.0.0.1",
        port=0,
        auth=_Closable(),  # type: ignore[arg-type]
        rooms=_Closable(),  # type: ignore[arg-type]
    )
    await server.start()
    assert server.bound_port is not None
    base = f"http://127.0.0.1:{server.bound_port}"
    expected = {
        "/": ("text/html", "no-store", "index.html"),
        "/assets/hands.js": ("text/javascript", "no-cache", "assets/hands.js"),
        "/assets/hands.css": ("text/css", "no-cache", "assets/hands.css"),
    }
    try:
        async with aiohttp.ClientSession() as client:
            for path, (mime, cache, resource_path) in expected.items():
                response = await client.get(f"{base}{path}")
                assert response.status == 200
                assert response.content_type == mime
                assert response.headers["Cache-Control"] == cache
                for name, value in SECURITY_HEADERS.items():
                    assert response.headers[name] == value
                assert await response.read() == _bundle()[f"{PREFIX}{resource_path}"]

            missing = await client.get(f"{base}/assets/missing.js")
            assert missing.status == 404
            for name, value in SECURITY_HEADERS.items():
                assert missing.headers[name] == value
    finally:
        await server.close()
