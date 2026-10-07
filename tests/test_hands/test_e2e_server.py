from __future__ import annotations

from scripts.hands_e2e_server import parse_args

from intelstream.config import Settings


def test_the_development_server_stays_off_the_production_port() -> None:
    production = Settings.model_fields["hands_port"].default
    assert parse_args([]).port != production
    assert parse_args(["--port", "8195"]).port == 8195
