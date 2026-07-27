from __future__ import annotations

import subprocess
import sys
import zipfile
from pathlib import Path

import pytest
from scripts.check_hands_wheel import EXPECTED, _validate_member_paths

SAFE_CONTENT = {
    "intelstream/hands/static/index.html": (
        b'<script type="module" src="./assets/hands.js"></script>'
        b'<link rel="stylesheet" href="./assets/hands.css">'
    ),
    # The pinned SDK carries this inert origin allowlist value; it must not be
    # confused with a Hands backend or runtime import.
    "intelstream/hands/static/assets/hands.js": (
        b"const sdkData='http://localhost:3333';console.log('Hands',sdkData)"
    ),
    "intelstream/hands/static/assets/hands.css": b"body{color:white}",
}
SCRIPT = Path("scripts/check_hands_wheel.py")


def _wheel(path: Path, contents: dict[str, bytes], duplicate: str | None = None) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        for name, content in contents.items():
            archive.writestr(name, content)
        if duplicate is not None:
            archive.writestr(duplicate, contents[duplicate])
    return path


def _check(*arguments: Path | str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *(str(argument) for argument in arguments)],
        check=False,
        capture_output=True,
        text=True,
    )


def test_wheel_checker_accepts_only_exact_safe_bundle(tmp_path: Path) -> None:
    result = _check(_wheel(tmp_path / "valid.whl", SAFE_CONTENT))
    assert result.returncode == 0
    assert "3 exact, nonempty, safe artifacts" in result.stdout


@pytest.mark.parametrize(
    ("name", "contents", "message"),
    [
        (
            "missing.whl",
            {key: value for key, value in SAFE_CONTENT.items() if not key.endswith("hands.css")},
            "missing Hands static paths",
        ),
        (
            "extra.whl",
            {**SAFE_CONTENT, "intelstream/hands/static/assets/extra.js": b"safe"},
            "unexpected Hands static paths",
        ),
        (
            "empty.whl",
            {**SAFE_CONTENT, "intelstream/hands/static/assets/hands.js": b""},
            "empty Hands static paths",
        ),
        (
            "unsafe.whl",
            {**SAFE_CONTENT, "intelstream/hands/static/assets/hands.js": b"eval('bad')"},
            "dynamic code constructor",
        ),
        (
            "dev-origin.whl",
            {
                **SAFE_CONTENT,
                "intelstream/hands/static/assets/hands.js": b"fetch('http://localhost:8080')",
            },
            "unreviewed external URL literal",
        ),
    ],
)
def test_wheel_checker_rejects_bad_layout_or_content(
    tmp_path: Path, name: str, contents: dict[str, bytes], message: str
) -> None:
    result = _check(_wheel(tmp_path / name, contents))
    assert result.returncode != 0
    assert message in result.stderr


@pytest.mark.parametrize(
    "unsafe_path",
    [
        "../outside",
        "package/../outside",
        "package\\outside",
        "/absolute/outside",
        "C:/absolute/outside",
        "package//outside",
        "package/./outside",
    ],
)
def test_wheel_checker_rejects_unsafe_member_anywhere(tmp_path: Path, unsafe_path: str) -> None:
    result = _check(_wheel(tmp_path / "unsafe-path.whl", {**SAFE_CONTENT, unsafe_path: b"outside"}))
    assert result.returncode != 0
    assert "member path" in result.stderr


def test_wheel_checker_rejects_nul_and_empty_member_paths() -> None:
    nul = zipfile.ZipInfo("safe\x00/../outside")
    assert "NUL in member path" in "\n".join(_validate_member_paths([nul]))
    empty = zipfile.ZipInfo("")
    assert "empty member path" in "\n".join(_validate_member_paths([empty]))


def test_wheel_checker_accepts_unrelated_package_index_resource(tmp_path: Path) -> None:
    result = _check(
        _wheel(
            tmp_path / "unrelated-index.whl",
            {**SAFE_CONTENT, "another_package/templates/index.html": b"<p>safe</p>"},
        )
    )
    assert result.returncode == 0


def test_wheel_checker_rejects_duplicate_and_multiple_paths(tmp_path: Path) -> None:
    duplicate = next(iter(EXPECTED))
    with pytest.warns(UserWarning, match="Duplicate name"):
        wheel = _wheel(tmp_path / "duplicate.whl", SAFE_CONTENT, duplicate=duplicate)
    duplicate_result = _check(wheel)
    assert duplicate_result.returncode != 0
    assert "duplicate normalized paths" in duplicate_result.stderr

    normalized_duplicate = tmp_path / "normalized-duplicate.whl"
    with zipfile.ZipFile(normalized_duplicate, "w") as archive:
        for name, content in SAFE_CONTENT.items():
            archive.writestr(name, content)
        archive.writestr("another_package/data", b"file")
        archive.writestr("another_package/data/", b"")
    normalized_result = _check(normalized_duplicate)
    assert normalized_result.returncode != 0
    assert "duplicate normalized paths" in normalized_result.stderr

    arguments_result = _check(wheel, wheel)
    assert arguments_result.returncode == 2
    assert "exactly one wheel path" in arguments_result.stderr
