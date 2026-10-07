"""Run the Hands server locally without Discord so the real client can be played end to end.

The real ``HandsAuth`` is subclassed so the OAuth ``begin``/``exchange`` steps become a local
handshake (``code`` is ``dev:<display name>``), while tickets, rooms, the websocket protocol,
the engine and persistence stay on the production code paths. The Vite dev server proxies
``/api/hands`` to this process (``HANDS_DEV_BACKEND``), and ``?e2e=1&instance_id=...&player=...``
in the client selects the development authorizer. This authenticates anyone who can reach the
port: run it only on a local development machine.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import secrets
import signal
import zlib

from intelstream.database.repository import Repository
from intelstream.hands.auth import (
    ActivityInstance,
    AuthenticatedPlayer,
    AuthExchange,
    HandsAuth,
    HandsAuthError,
    validate_instance_id,
)
from intelstream.hands.engine import EngineConfig
from intelstream.hands.rooms import HandsRoomManager, RoomConfig
from intelstream.hands.server import HandsServer

APPLICATION_ID = "100000000000000001"
GUILD_ID = "100000000000000002"
MAX_NAME_LENGTH = 32


class DevAuth(HandsAuth):
    def __init__(self) -> None:
        super().__init__(
            application_id=APPLICATION_ID,
            guild_id=GUILD_ID,
            client_secret="dev",
            bot_token="dev",
        )
        self._dev_states: dict[str, str] = {}

    async def begin(self, instance_id: object) -> tuple[str, ActivityInstance]:
        instance = validate_instance_id(instance_id)
        state = secrets.token_urlsafe(16)
        self._dev_states[state] = instance
        return state, ActivityInstance(instance, self.guild_id, "0", frozenset())

    async def exchange(self, *, code: object, state: object) -> AuthExchange:
        instance = self._dev_states.pop(state, None) if isinstance(state, str) else None
        if instance is None:
            raise HandsAuthError("invalid_state")
        if not isinstance(code, str) or not code.startswith("dev:"):
            raise HandsAuthError("invalid_request")
        display_name = code[len("dev:") :].strip()[:MAX_NAME_LENGTH] or "Player"
        user_id = str(10**17 + zlib.crc32(display_name.encode()))
        player = AuthenticatedPlayer(user_id, self.guild_id, instance, display_name, None)
        return AuthExchange("dev-access-token", self.issue_ticket(player), player)


async def run(args: argparse.Namespace) -> None:
    repository = Repository("sqlite+aiosqlite:///:memory:")
    await repository.initialize()
    engine_config = EngineConfig(
        rounds=args.rounds,
        round_ticks=args.round_seconds * 30,
        rest_ticks=args.rest_seconds * 30,
    )
    server = HandsServer(
        repository=repository,
        application_id=APPLICATION_ID,
        guild_id=GUILD_ID,
        client_secret="dev",
        bot_token="dev",
        host="127.0.0.1",
        port=args.port,
        dev_mode=True,
        auth=DevAuth(),
        rooms=HandsRoomManager(
            repository,
            config=RoomConfig(
                engine_config=engine_config, style_select_seconds=args.style_select_seconds
            ),
        ),
    )
    await server.start()
    try:
        print(f"hands e2e server listening on http://127.0.0.1:{server.bound_port}", flush=True)
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for signal_number in (signal.SIGINT, signal.SIGTERM):
            # Windows event loops have no signal handlers; Ctrl+C cancels the run there instead.
            with contextlib.suppress(NotImplementedError):
                loop.add_signal_handler(signal_number, stop.set)
        await stop.wait()
    finally:
        await server.close()
        await repository.close()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    # Not 8080: that is the production server's port, which a live tunnel may forward.
    parser.add_argument("--port", type=int, default=8091)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--round-seconds", type=int, default=120)
    parser.add_argument("--rest-seconds", type=int, default=15)
    parser.add_argument("--style-select-seconds", type=float, default=10.0)
    return parser.parse_args(argv)


def main() -> None:
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(run(parse_args()))


if __name__ == "__main__":
    main()
