from __future__ import annotations

import asyncio

import pytest
from scripts.hands_e2e_server import parse_args, run

from intelstream.config import Settings
from intelstream.hands.server import HandsServer


def test_the_development_server_stays_off_the_production_port() -> None:
    production = Settings.model_fields["hands_port"].default
    assert parse_args([]).port != production
    assert parse_args(["--port", "8195"]).port == 8195


async def test_the_development_server_runs_and_closes_where_loops_have_no_signal_handlers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unsupported(*_args: object) -> None:
        raise NotImplementedError

    # Windows event loops raise this for every signal handler.
    monkeypatch.setattr(asyncio.get_running_loop(), "add_signal_handler", unsupported)
    started = asyncio.Event()
    closed = asyncio.Event()
    original_start = HandsServer.start
    original_close = HandsServer.close

    async def start(server: HandsServer) -> None:
        await original_start(server)
        started.set()

    async def close(server: HandsServer) -> None:
        await original_close(server)
        closed.set()

    monkeypatch.setattr(HandsServer, "start", start)
    monkeypatch.setattr(HandsServer, "close", close)
    running = asyncio.create_task(run(parse_args(["--port", "0"])))
    async with asyncio.timeout(10):
        await started.wait()
    await asyncio.sleep(0)
    assert not running.done()

    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    assert closed.is_set()
