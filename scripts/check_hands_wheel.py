#!/usr/bin/env python3
"""Verify that a built wheel contains the complete, safe Hands static bundle."""

from __future__ import annotations

import posixpath
import re
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath

PREFIX = "intelstream/hands/static/"
EXPECTED = {
    f"{PREFIX}index.html",
    f"{PREFIX}assets/hands.js",
    f"{PREFIX}assets/hands.css",
}
DYNAMIC_CODE = re.compile(r"(?<![\w$])(?:eval\s*\(|new\s+Function\b|Function\s*\()")
SOURCE_MAP = re.compile(r"sourceMappingURL", re.IGNORECASE)
ABSOLUTE_LOCAL_OR_HANDS_ORIGIN = re.compile(
    r"(?:https?|wss?)://(?:"
    r"(?:localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?(?:[/\s?\"']|$)"
    r"|[^/\s\"']+/api/hands(?:[/\s?\"']|$))",
    re.IGNORECASE,
)
# These are the complete URL literals carried by the reviewed, pinned Discord
# SDK bundle. They are SDK metadata/allowlist values, not Hands runtime targets.
REVIEWED_SDK_URL_LITERALS = {
    "https://github.com/uuidjs/uuid#getrandomvalues-not-supported",
    "https://discord.com",
    "https://discordapp.com",
    "https://ptb.discord.com",
    "https://ptb.discordapp.com",
    "https://canary.discord.com",
    "https://canary.discordapp.com",
    "https://staging.discord.co",
    "http://localhost:3333",
    "https://pax.discord.com",
}
STRING_LITERAL = re.compile(
    r"""(?P<quote>["'`])(?P<value>(?:\\.|(?!(?P=quote)).)*)(?P=quote)""",
    re.DOTALL,
)
URL_TOKEN = re.compile(r"""(?:https?:)?(?:/|\\/){2}[^\s"'`\\<>(){},;]+""", re.IGNORECASE)
CSS_URL_LITERAL = re.compile(
    r"""(?:url\(|@import\s+)[\s"']*((?:https?:)?//[^\s"')]+)""", re.IGNORECASE
)
DEV_FIXTURE = re.compile(r"dev-fixtures|fixture-(?:one|two)|\bDEV_FIXTURES?\b", re.IGNORECASE)
SENSITIVE_IDENTIFIER = re.compile(
    r"(?<![\w-])(?:client[_-]?secret|bot[_-]?token)(?![\w-])", re.IGNORECASE
)
CREDENTIAL_VALUE = re.compile(
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
    r"|(?:mfa\.[\w-]{20,}|[A-Za-z\d_-]{24}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{25,})",
    re.IGNORECASE,
)


class _BundleHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.scripts: list[str | None] = []
        self.stylesheets: list[str] = []
        self.runtime_refs: list[str] = []
        self.attribute_urls: list[str] = []
        self.inline_executable = False
        self._inline_script = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name.lower(): value for name, value in attrs}
        for name, value in attrs:
            lowered = name.lower()
            if lowered.startswith("on") and value:
                self.inline_executable = True
            if value and re.match(r"^(?:https?:)?//", value.strip(), re.IGNORECASE):
                self.attribute_urls.append(value.strip())
            if lowered in {"src", "href"} and value:
                self.runtime_refs.append(value)
                if value.strip().lower().startswith("javascript:"):
                    self.inline_executable = True
        if tag.lower() == "script":
            source = values.get("src")
            self.scripts.append(source)
            self._inline_script = source is None
        if tag.lower() == "link" and values.get("rel") == "stylesheet":
            href = values.get("href")
            if href is not None:
                self.stylesheets.append(href)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script":
            self._inline_script = False

    def handle_data(self, data: str) -> None:
        if self._inline_script and data.strip():
            self.inline_executable = True


def _relative_reference(value: str) -> bool:
    path = PurePosixPath(value.split("?", 1)[0].split("#", 1)[0])
    return (
        value.startswith("./")
        and not value.startswith("//")
        and not path.is_absolute()
        and ".." not in path.parts
        and ":" not in value
    )


def _validate_member_paths(entries: list[zipfile.ZipInfo]) -> list[str]:
    errors: list[str] = []
    normalized_names: dict[str, str] = {}
    for entry in entries:
        original = entry.orig_filename
        if "\x00" in original:
            errors.append(f"wheel contains NUL in member path: {original!r}")
            continue
        if not original:
            errors.append("wheel contains an empty member path")
            continue
        if "\\" in original:
            errors.append(f"wheel contains backslash in member path: {original}")
            continue

        path = original[:-1] if original.endswith("/") else original
        if not path:
            errors.append(f"wheel contains an empty member path: {original!r}")
            continue
        parts = path.split("/")
        if path.startswith("/") or re.match(r"^[A-Za-z]:", path):
            errors.append(f"wheel contains absolute member path: {original}")
            continue
        if ".." in parts:
            errors.append(f"wheel contains traversal member path: {original}")
            continue
        normalized = posixpath.normpath(path)
        if any(part in {"", "."} for part in parts) or normalized != path:
            errors.append(f"wheel contains non-normalized member path: {original}")
            continue

        previous = normalized_names.get(normalized)
        if previous is not None:
            errors.append(f"wheel contains duplicate normalized paths: {previous}, {original}")
        else:
            normalized_names[normalized] = original
    return errors


def _url_literals(text: str) -> list[str]:
    return [
        match.group(0).replace("\\/", "/")
        for string in STRING_LITERAL.finditer(text)
        for match in URL_TOKEN.finditer(string.group("value"))
    ]


def validate_bundle(contents: dict[str, bytes]) -> list[str]:
    errors: list[str] = []
    html = contents[f"{PREFIX}index.html"].decode("utf-8", errors="replace")
    parser = _BundleHTMLParser()
    parser.feed(html)
    if parser.scripts != ["./assets/hands.js"]:
        errors.append("index.html must reference exactly ./assets/hands.js")
    if parser.stylesheets != ["./assets/hands.css"]:
        errors.append("index.html must reference exactly ./assets/hands.css")
    if parser.inline_executable:
        errors.append("index.html contains inline executable content")
    for reference in parser.runtime_refs:
        if not _relative_reference(reference):
            errors.append(f"index.html contains a non-relative runtime reference: {reference}")
    for literal in parser.attribute_urls:
        if literal not in REVIEWED_SDK_URL_LITERALS:
            errors.append(f"index.html: unreviewed external URL literal: {literal}")

    for name, raw in contents.items():
        text = raw.decode("utf-8", errors="replace")
        if DYNAMIC_CODE.search(text):
            errors.append(f"{name}: dynamic code constructor")
        if SOURCE_MAP.search(text):
            errors.append(f"{name}: source-map reference")
        literals = _url_literals(text)
        if name.endswith(".css"):
            literals.extend(match.group(1) for match in CSS_URL_LITERAL.finditer(text))
        for literal in literals:
            if literal not in REVIEWED_SDK_URL_LITERALS:
                errors.append(f"{name}: unreviewed external URL literal: {literal}")
        if ABSOLUTE_LOCAL_OR_HANDS_ORIGIN.search(text):
            allowed_localhost_only = text.replace("http://localhost:3333", "")
            if ABSOLUTE_LOCAL_OR_HANDS_ORIGIN.search(allowed_localhost_only):
                errors.append(f"{name}: absolute localhost or Hands API origin")
        if DEV_FIXTURE.search(text):
            errors.append(f"{name}: development fixture")
        if SENSITIVE_IDENTIFIER.search(text):
            errors.append(f"{name}: sensitive server-only identifier")
        if CREDENTIAL_VALUE.search(text):
            errors.append(f"{name}: credential-like value")
    return errors


def check_wheel(wheel: Path) -> list[str]:
    if not wheel.is_file():
        return [f"wheel does not exist: {wheel}"]
    if wheel.suffix != ".whl":
        return [f"expected one .whl file, got: {wheel}"]
    try:
        with zipfile.ZipFile(wheel) as archive:
            entries = archive.infolist()
            path_errors = _validate_member_paths(entries)
            if path_errors:
                return path_errors
            names = [entry.filename for entry in entries if not entry.is_dir()]
            found = {name for name in names if name.startswith(PREFIX)}
            missing = sorted(EXPECTED - found)
            extra = sorted(found - EXPECTED)
            errors = []
            if missing:
                errors.append(f"missing Hands static paths: {', '.join(missing)}")
            if extra:
                errors.append(f"unexpected Hands static paths: {', '.join(extra)}")
            if errors:
                return errors
            contents = {name: archive.read(name) for name in EXPECTED}
    except (OSError, zipfile.BadZipFile) as exc:
        return [f"cannot read wheel {wheel}: {exc}"]
    empty = sorted(name for name, content in contents.items() if not content)
    if empty:
        return [f"empty Hands static paths: {', '.join(empty)}"]
    return validate_bundle(contents)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_hands_wheel.py WHEEL", file=sys.stderr)
        print("error: provide exactly one wheel path", file=sys.stderr)
        return 2
    wheel = Path(argv[1])
    errors = check_wheel(wheel)
    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 1
    print(f"Hands wheel bundle passed: {wheel} (3 exact, nonempty, safe artifacts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
