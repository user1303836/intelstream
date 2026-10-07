from __future__ import annotations

from scripts.hands_parity_fixtures import documents


def test_the_tables_the_client_predicts_from_still_match_the_engine() -> None:
    """The client's prediction tests check it against these files; a rule change that alters them
    must regenerate them (scripts/hands_parity_fixtures.py), so the client is checked against it."""
    stale = [
        path.name
        for path, text in documents().items()
        if not path.exists() or path.read_text(encoding="utf-8") != text
    ]
    assert not stale, f"run scripts/hands_parity_fixtures.py to regenerate {stale}"
