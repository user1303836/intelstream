from __future__ import annotations

import asyncio
import base64
import json
import os
import socket
import struct
import time
import zlib
from types import SimpleNamespace
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock

import aiohttp
import httpx
import pytest
from yarl import URL

from intelstream.database.repository import Repository
from intelstream.hands import server as server_module
from intelstream.hands.auth import AuthenticatedPlayer, AuthExchange, HandsAuth, HandsAuthError
from intelstream.hands.engine import EngineConfig
from intelstream.hands.protocol import PROTOCOL_VERSION
from intelstream.hands.rooms import (
    SNAPSHOT_BACKLOG_BYTES,
    HandsRoomManager,
    RoomConfig,
    RoomError,
)
from intelstream.hands.server import AdmissionConfig, HandsServer

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from pathlib import Path

APP = "123456789"
GUILD = "987654321"
ORIGIN = f"https://{APP}.discordsays.com"


class FakeAuth:
    application_id = APP
    ticket_ttl_seconds = 300

    def __init__(self) -> None:
        self.closed = False
        self.begin_calls: list[object] = []
        self.tickets: dict[str, AuthenticatedPlayer] = {}
        self.ticket_counter = 0

    async def begin(self, instance_id: object):
        self.begin_calls.append(instance_id)
        if instance_id == "bad":
            raise HandsAuthError("invalid_activity")
        return "oauth-state", object()

    async def exchange(self, *, code: object, state: object) -> AuthExchange:
        if code != "code" or state != "oauth-state":
            raise HandsAuthError()
        player = AuthenticatedPlayer("one", GUILD, "instance", "One", None)
        return AuthExchange("access", "ticket-one", player)

    def issue_ticket(self, player: AuthenticatedPlayer) -> str:
        self.ticket_counter += 1
        ticket = f"rotated-{self.ticket_counter}"
        self.tickets[ticket] = player
        return ticket

    def verify_ticket(self, ticket: object) -> AuthenticatedPlayer:
        if not isinstance(ticket, str):
            raise HandsAuthError("invalid_ticket")
        player = self.tickets.pop(ticket, None)
        if player is None:
            raise HandsAuthError("invalid_ticket")
        return player

    def activate_ticket(self, ticket: object, player: AuthenticatedPlayer) -> None:
        if not isinstance(ticket, str) or self.tickets.get(ticket) != player:
            raise HandsAuthError("invalid_ticket")
        for candidate, owner in list(self.tickets.items()):
            if owner == player and candidate != ticket:
                self.tickets.pop(candidate, None)

    def instance_for_state(self, state: object) -> str | None:
        return {"oauth-state": "instance", "other-state": "elsewhere"}.get(str(state))

    async def close(self) -> None:
        self.closed = True


class MagicRooms:
    def __init__(
        self,
        *,
        join_error: BaseException | None = None,
        close_error: BaseException | None = None,
    ) -> None:
        self.join_error = join_error
        self.close_mock = AsyncMock(side_effect=close_error)

    async def join(self, *_args, **_kwargs):
        if self.join_error is not None:
            raise self.join_error
        raise AssertionError("join result not configured")

    async def leave(self, _membership) -> None:
        return None

    async def close(self) -> None:
        await self.close_mock()


@pytest.fixture
async def repository() -> Repository:
    repo = Repository("sqlite+aiosqlite:///:memory:")
    await repo.initialize()
    yield repo
    await repo.close()


async def start_server(
    repository: Repository,
    *,
    auth: FakeAuth | None = None,
    dev_mode: bool = False,
    auth_timeout: float = 0.5,
    ticket_refresh: float | None = None,
    ticket_sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    rooms: HandsRoomManager | None = None,
    admission: AdmissionConfig | None = None,
    monotonic_clock: Callable[[], float] = time.monotonic,
    static_root: Path | None = None,
    websocket_heartbeat: float = server_module.WEBSOCKET_HEARTBEAT_SECONDS,
) -> tuple[HandsServer, FakeAuth, str]:
    fake_auth = auth or FakeAuth()
    server = HandsServer(
        repository=repository,
        application_id=APP,
        guild_id=GUILD,
        client_secret="secret",
        bot_token="bot-token",
        host="127.0.0.1",
        port=0,
        dev_mode=dev_mode,
        auth=fake_auth,
        rooms=rooms,
        auth_timeout_seconds=auth_timeout,
        ticket_refresh_seconds=ticket_refresh,
        ticket_sleep=ticket_sleep,
        admission=admission,
        monotonic_clock=monotonic_clock,
        static_root=static_root,
        websocket_heartbeat_seconds=websocket_heartbeat,
    )
    await server.start()
    assert server.bound_port is not None
    return server, fake_auth, f"http://127.0.0.1:{server.bound_port}"


async def connect_reader_that_stalls(
    port: int, ticket: str, *, read_frames: int = 0
) -> tuple[socket.socket, list[dict[str, object]]]:
    """Authenticates over a raw socket, reads `read_frames` server frames, then never reads again.

    The small receive buffer and the absent reads fill the server's transport within a fraction of
    a second of per-tick snapshots, as a phone that switched networks or went to the background
    would.
    """
    loop = asyncio.get_running_loop()
    raw = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    raw.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
    raw.setblocking(False)
    await loop.sock_connect(raw, ("127.0.0.1", port))
    key = base64.b64encode(os.urandom(16)).decode()
    await loop.sock_sendall(
        raw,
        (
            "GET /api/hands/ws HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: {ORIGIN}\r\n\r\n"
        ).encode(),
    )
    received = b""
    while b"\r\n\r\n" not in received:
        received += await loop.sock_recv(raw, 1)
    assert b" 101 " in received.split(b"\r\n", 1)[0]
    payload = json.dumps(
        {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": ticket}
    ).encode()
    assert len(payload) < 126
    mask = os.urandom(4)
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    await loop.sock_sendall(raw, bytes([0x81, 0x80 | len(payload)]) + mask + masked)

    async def read_exactly(count: int) -> bytes:
        data = b""
        while len(data) < count:
            chunk = await loop.sock_recv(raw, count - len(data))
            assert chunk, "server closed the socket"
            data += chunk
        return data

    frames: list[dict[str, object]] = []
    for _ in range(read_frames):
        first, second = await read_exactly(2)
        length = second & 0x7F
        if length == 126:
            (length,) = struct.unpack("!H", await read_exactly(2))
        elif length == 127:
            (length,) = struct.unpack("!Q", await read_exactly(8))
        assert first & 0x40 == 0, "a raw reader does not negotiate compression"
        frames.append(json.loads(await read_exactly(length)))
    return raw, frames


async def connect_deflate_client(
    port: int, ticket: str
) -> tuple[asyncio.StreamReader, asyncio.StreamWriter, str]:
    """Authenticates over a raw socket that offers permessage-deflate, as browsers do."""
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    key = base64.b64encode(os.urandom(16)).decode()
    writer.write(
        (
            "GET /api/hands/ws HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: {ORIGIN}\r\n"
            "Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n\r\n"
        ).encode()
    )
    head = (await reader.readuntil(b"\r\n\r\n")).decode()
    assert " 101 " in head.split("\r\n", 1)[0]
    extensions = next(
        (
            line.split(":", 1)[1].strip()
            for line in head.split("\r\n")
            if line.lower().startswith("sec-websocket-extensions:")
        ),
        "",
    )
    payload = json.dumps(
        {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": ticket}
    ).encode()
    mask = os.urandom(4)
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    writer.write(bytes([0x81, 0x80 | len(payload)]) + mask + masked)
    return reader, writer, extensions


async def read_server_frame(reader: asyncio.StreamReader) -> tuple[bool, int, bytes]:
    first, second = await reader.readexactly(2)
    length = second & 0x7F
    if length == 126:
        (length,) = struct.unpack("!H", await reader.readexactly(2))
    elif length == 127:
        (length,) = struct.unpack("!Q", await reader.readexactly(8))
    return bool(first & 0x40), first & 0x0F, await reader.readexactly(length)


async def receive_until(
    socket: aiohttp.ClientWebSocketResponse, kind: str, *, deadline_seconds: float = 10.0
) -> dict[str, object]:
    async with asyncio.timeout(deadline_seconds):
        while True:
            message = await socket.receive()
            assert message.type == aiohttp.WSMsgType.TEXT, message
            payload = json.loads(message.data)
            if payload["type"] == kind:
                return payload


def stalled_reader_rooms(
    repository: Repository, match_id: str, *, outbound_queue_size: int = 16
) -> HandsRoomManager:
    return HandsRoomManager(
        repository,
        config=RoomConfig(
            style_select_seconds=0.0,
            tick_interval_seconds=0.002,
            reconnect_grace_seconds=0.5,
            result_hold_seconds=0.0,
            outbound_queue_size=outbound_queue_size,
            engine_config=EngineConfig(
                rounds=1,
                round_ticks=1_000_000,
                rest_ticks=0,
                countdown_ticks=1,
                flash_ko_enabled=False,
            ),
        ),
        match_id_factory=lambda: match_id,
    )


async def start_capped_proxy(upstream_port: int, *, bytes_per_second: int) -> asyncio.Server:
    """A TCP proxy whose server-to-client direction runs no faster than a weak mobile link."""

    async def relay(
        client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter
    ) -> None:
        upstream_reader, upstream_writer = await asyncio.open_connection("127.0.0.1", upstream_port)

        async def up() -> None:
            while data := await client_reader.read(65536):
                upstream_writer.write(data)
                await upstream_writer.drain()

        async def down() -> None:
            loop = asyncio.get_running_loop()
            started = loop.time()
            relayed = 0
            while data := await upstream_reader.read(2048):
                relayed += len(data)
                client_writer.write(data)
                await client_writer.drain()
                await asyncio.sleep(max(0.0, relayed / bytes_per_second - (loop.time() - started)))

        await asyncio.gather(up(), down(), return_exceptions=True)
        client_writer.close()
        upstream_writer.close()

    return await asyncio.start_server(relay, "127.0.0.1", 0)


async def post_bootstrap(
    client: aiohttp.ClientSession,
    base: str,
    instance_id: str,
    *,
    headers: dict[str, str] | None = None,
) -> aiohttp.ClientResponse:
    return await client.post(
        f"{base}/api/hands/bootstrap",
        json={"instance_id": instance_id},
        headers=headers,
    )


async def test_health_static_security_and_safe_resolution(
    repository: Repository, tmp_path: Path
) -> None:
    (tmp_path / "index.html").write_text("<title>Hands</title>")
    (tmp_path / "app.js").write_text("console.log('hands')")
    server, auth, base = await start_server(repository, static_root=tmp_path)
    async with aiohttp.ClientSession() as client:
        health = await client.get(f"{base}/healthz")
        assert await health.json() == {"status": "ok"}
        assert health.headers["X-Content-Type-Options"] == "nosniff"

        index = await client.get(f"{base}/")
        body = await index.text()
        assert index.status == 200
        assert index.content_type == "text/html"
        assert "Hands" in body
        assert index.headers["Cache-Control"] == "no-store"
        assert "frame-ancestors" in index.headers["Content-Security-Policy"]
        policy = dict(
            directive.strip().split(" ", 1)
            for directive in index.headers["Content-Security-Policy"].split(";")
        )
        # Discord's image host only for the players' avatars, as the bundle scan allows.
        assert policy["img-src"] == "'self' data: blob: https://cdn.discordapp.com/avatars/"
        assert policy["connect-src"] == "'self'"
        assert policy["script-src"] == "'self'"
        assert policy["default-src"] == "'self'"
        assert "client-secret" not in body

        asset = await client.get(f"{base}/app.js")
        assert asset.status == 200
        assert asset.headers["Cache-Control"] == "no-cache"

        missing = await client.get(f"{base}/assets/../auth.py")
        assert missing.status == 404
    await server.close()
    await server.close()
    assert auth.closed


async def test_bootstrap_token_origin_schema_media_and_no_store(
    repository: Repository, monkeypatch: pytest.MonkeyPatch
) -> None:
    safe_logger = MagicMock()
    monkeypatch.setattr(server_module, "logger", safe_logger)
    server, auth, base = await start_server(repository)
    headers = {"Origin": ORIGIN}
    async with aiohttp.ClientSession() as client:
        rejected = await post_bootstrap(client, base, "instance")
        assert rejected.status == 403
        legacy_get = await client.get(
            f"{base}/api/hands/bootstrap?instance_id=instance", headers=headers
        )
        assert legacy_get.status == 404
        bootstrap_media = await client.post(
            f"{base}/api/hands/bootstrap",
            data='{"instance_id":"instance"}',
            headers={**headers, "Content-Type": "text/plain"},
        )
        assert bootstrap_media.status == 415
        extra = await client.post(
            f"{base}/api/hands/bootstrap",
            json={"instance_id": "instance", "user_id": "forged"},
            headers=headers,
        )
        assert extra.status == 400
        duplicate = await client.post(
            f"{base}/api/hands/bootstrap",
            data='{"instance_id":"instance","instance_id":"forged"}',
            headers={**headers, "Content-Type": "application/json"},
        )
        assert duplicate.status == 400
        bootstrap = await post_bootstrap(client, base, "instance", headers=headers)
        assert await bootstrap.json() == {
            "client_id": APP,
            "protocol": PROTOCOL_VERSION,
            "state": "oauth-state",
            "simulation": {
                "tick_rate": 30,
                "ring_half_width": 500,
                "ring_half_height": 500,
            },
        }
        assert bootstrap.headers["Cache-Control"] == "no-store"
        assert auth.begin_calls == ["instance"]

        media = await client.post(
            f"{base}/api/hands/token", data="{}", headers={**headers, "Content-Type": "text/plain"}
        )
        assert media.status == 415
        forged = await client.post(
            f"{base}/api/hands/token",
            json={"code": "code", "state": "oauth-state", "user_id": "forged"},
            headers=headers,
        )
        assert forged.status == 400
        duplicate = await client.post(
            f"{base}/api/hands/token",
            data='{"code":"code","code":"other","state":"oauth-state"}',
            headers={**headers, "Content-Type": "application/json"},
        )
        assert duplicate.status == 400
        token = await client.post(
            f"{base}/api/hands/token",
            json={"code": "code", "state": "oauth-state"},
            headers=headers,
        )
        payload = await token.json()
        assert payload["access_token"] == "access"
        assert payload["ticket"] == "ticket-one"
        assert payload["player"]["id"] == "one"
        assert payload["player"]["rating"] == 1000
        assert token.headers["Cache-Control"] == "no-store"

        invalid = await client.post(
            f"{base}/api/hands/token",
            json={"code": "wrong", "state": "oauth-state"},
            headers=headers,
        )
        assert invalid.status == 401
        assert await invalid.json() == {"error": "authentication_failed"}
    safe_logger.info.assert_any_call("Hands OAuth bootstrap completed")
    safe_logger.info.assert_any_call("Hands OAuth token request received")
    safe_logger.info.assert_any_call(
        "Hands OAuth exchange completed", guild_id=GUILD, user_id="one"
    )
    safe_logger.warning.assert_any_call(
        "Hands OAuth exchange rejected", code="authentication_failed"
    )
    await server.close()


async def test_dev_mode_allows_only_local_origins(repository: Repository) -> None:
    server, _auth, base = await start_server(repository, dev_mode=True)
    async with aiohttp.ClientSession() as client:
        local = await post_bootstrap(
            client,
            base,
            "instance",
            headers={"Origin": "http://localhost:5173"},
        )
        assert local.status == 200
        spoofed = await post_bootstrap(
            client,
            base,
            "instance",
            headers={"Origin": "http://localhost.evil.test:5173"},
        )
        assert spoofed.status == 403
    await server.close()


async def test_websocket_requires_ticket_first_without_query_and_times_out(
    repository: Repository,
) -> None:
    server, auth, base = await start_server(repository, auth_timeout=0.02)
    async with aiohttp.ClientSession() as client:
        query = await client.get(
            f"{base}/api/hands/ws?ticket=secret",
            headers={"Origin": ORIGIN, "Upgrade": "websocket"},
        )
        assert query.status in {400, 426}

        ws = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        message = await ws.receive(timeout=1)
        payload = json.loads(message.data)
        assert payload["type"] == "error"
        assert payload["code"] == "authentication_timeout"
        await ws.close()

        malformed = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await malformed.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "bad"}
        )
        message = await malformed.receive(timeout=1)
        assert json.loads(message.data)["code"] == "invalid_ticket"
        await malformed.close()
    assert not auth.tickets
    await server.close()


async def test_an_outdated_client_is_told_in_its_own_version_without_spending_its_ticket(
    repository: Repository,
) -> None:
    auth = FakeAuth()
    auth.tickets["valid"] = AuthenticatedPlayer("one", GUILD, "room", "One", None)
    server, _auth, base = await start_server(repository, auth=auth)
    async with aiohttp.ClientSession() as client:
        for frame in (
            # A window still on the build before this protocol, and one from a newer build.
            {"version": PROTOCOL_VERSION - 1, "type": "authenticate", "ticket": "valid"},
            {
                "version": PROTOCOL_VERSION + 1,
                "type": "authenticate",
                "ticket": "valid",
                "build": "next",
            },
        ):
            socket = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
            await socket.send_json(frame)
            error = json.loads((await socket.receive(timeout=1)).data)
            assert error == {
                "code": "client_outdated",
                "type": "error",
                "version": frame["version"],
            }
            closing = await socket.receive(timeout=1)
            assert closing.type == aiohttp.WSMsgType.CLOSE
            assert closing.data == 4003
            await socket.close()
        assert "valid" in auth.tickets

        socket = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await socket.send_json({"version": PROTOCOL_VERSION, "type": "resume", "ticket": "valid"})
        error = json.loads((await socket.receive(timeout=1)).data)
        assert error == {"code": "invalid_ticket", "type": "error", "version": PROTOCOL_VERSION}
        await socket.close()
    await server.close()


async def test_authenticated_room_admission_is_not_part_of_first_frame_timeout(
    repository: Repository,
) -> None:
    class DelayedRejectionRooms(MagicRooms):
        def __init__(self) -> None:
            super().__init__()
            self.entered = asyncio.Event()
            self.release = asyncio.Event()

        async def join(self, *_args, **_kwargs):
            self.entered.set()
            await self.release.wait()
            raise RoomError("room_full")

    auth = FakeAuth()
    auth.tickets["valid"] = AuthenticatedPlayer("one", GUILD, "room", "One", None)
    rooms = DelayedRejectionRooms()
    # Well above Windows' 15.6 ms timer resolution, which let a 10 ms timeout expire before the
    # authentication frame was read.
    auth_timeout = 0.25
    server, _auth, base = await start_server(
        repository,
        auth=auth,
        auth_timeout=auth_timeout,
        rooms=rooms,
    )
    async with aiohttp.ClientSession() as client:
        socket = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await socket.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "valid"}
        )
        async with asyncio.timeout(2):
            await rooms.entered.wait()
        await asyncio.sleep(2 * auth_timeout)
        rooms.release.set()
        error = json.loads((await socket.receive(timeout=1)).data)
        assert error["code"] == "room_full"
        await socket.close()
    await server.close()


async def test_welcome_ticket_is_issued_after_blocking_room_admission(
    repository: Repository,
) -> None:
    original_get = repository.get_or_create_hands_rating
    admission_entered = asyncio.Event()
    admission_release = asyncio.Event()

    async def delayed_rating(guild_id: str, user_id: str):
        admission_entered.set()
        await admission_release.wait()
        return await original_get(guild_id, user_id)

    repository.get_or_create_hands_rating = delayed_rating
    now = 1000.0

    class TimedAuth(FakeAuth):
        def __init__(self) -> None:
            super().__init__()
            self.issue_times: list[float] = []

        def issue_ticket(self, player: AuthenticatedPlayer) -> str:
            self.issue_times.append(now)
            return super().issue_ticket(player)

    auth = TimedAuth()
    auth.tickets["valid"] = AuthenticatedPlayer("one", GUILD, "room", "One", None)
    server, _auth, base = await start_server(repository, auth=auth)
    async with aiohttp.ClientSession() as client:
        socket = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await socket.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "valid"}
        )
        await admission_entered.wait()
        assert auth.ticket_counter == 0
        now = 2000.0
        admission_release.set()
        welcome = json.loads((await socket.receive(timeout=1)).data)
        assert welcome["type"] == "welcome"
        assert welcome["reconnect_ticket"] == "rotated-1"
        assert auth.issue_times == [2000.0]
        await socket.close()
    await server.close()


async def test_two_websockets_start_and_third_is_read_only_spectator(
    repository: Repository,
) -> None:
    sleep_release = asyncio.Event()

    async def controlled_sleep(_delay: float) -> None:
        await sleep_release.wait()

    auth = FakeAuth()
    auth.tickets = {
        "one": AuthenticatedPlayer("one", GUILD, "room", "One", None),
        "two": AuthenticatedPlayer("two", GUILD, "room", "Two", None),
        "three": AuthenticatedPlayer("three", GUILD, "room", "Three", None),
    }
    rooms = HandsRoomManager(
        repository,
        config=RoomConfig(
            style_select_seconds=0.0,
            tick_interval_seconds=0.002,
            broadcast_every_ticks=1,
            reconnect_grace_seconds=0.1,
            result_hold_seconds=0.05,
            engine_config=EngineConfig(
                rounds=1,
                round_ticks=1000,
                rest_ticks=0,
                countdown_ticks=1,
                flash_ko_enabled=False,
            ),
        ),
        sleep=controlled_sleep,
        match_id_factory=lambda: "server-room",
    )
    server, _auth, base = await start_server(repository, auth=auth, rooms=rooms)
    async with aiohttp.ClientSession() as client:
        sockets = []
        for ticket in ("one", "two"):
            ws = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
            await ws.send_json(
                {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": ticket}
            )
            sockets.append(ws)
        async with asyncio.timeout(1):
            seen_ready = False
            while not seen_ready:
                message = await sockets[0].receive()
                if message.type == aiohttp.WSMsgType.TEXT:
                    seen_ready = json.loads(message.data)["type"] == "ready"
        third = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await third.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "three"}
        )
        welcome = json.loads((await third.receive(timeout=1)).data)
        assert welcome["type"] == "welcome"
        assert welcome["role"] == "spectator"
        assert "seat" not in welcome
        snapshot = json.loads((await third.receive(timeout=1)).data)
        assert snapshot["type"] == "snapshot"
        assert all(fighter["get_up_prompt"] is None for fighter in snapshot["payload"]["fighters"])

        await third.send_json({})
        error = json.loads((await third.receive(timeout=1)).data)
        assert error["code"] == "spectator_read_only"
        await third.close()
        assert all(not socket.closed for socket in sockets)
        for ws in sockets:
            async with asyncio.timeout(1):
                await ws.close()
    async with asyncio.timeout(1):
        await server.close()


async def test_a_lone_fighter_calls_the_computer_and_a_spectator_cannot(
    repository: Repository,
) -> None:
    auth = FakeAuth()
    auth.tickets = {
        "one": AuthenticatedPlayer("one", GUILD, "room", "One", None),
        "two": AuthenticatedPlayer("two", GUILD, "room", "Two", None),
    }
    rooms = HandsRoomManager(
        repository,
        config=RoomConfig(
            style_select_seconds=0.0,
            tick_interval_seconds=0.002,
            broadcast_every_ticks=1,
            reconnect_grace_seconds=0.1,
            result_hold_seconds=0.05,
            engine_config=EngineConfig(
                rounds=1,
                round_ticks=5000,
                rest_ticks=0,
                countdown_ticks=1,
                flash_ko_enabled=False,
            ),
        ),
        match_id_factory=lambda: "server-cpu",
    )
    server, _auth, base = await start_server(repository, auth=auth, rooms=rooms)

    async def receive_type(ws: aiohttp.ClientWebSocketResponse, kind: str) -> dict:
        async with asyncio.timeout(1):
            while True:
                message = await ws.receive()
                if message.type != aiohttp.WSMsgType.TEXT:
                    raise AssertionError(f"socket closed before {kind}")
                payload = json.loads(message.data)
                if payload["type"] == kind:
                    return payload

    async with aiohttp.ClientSession() as client:
        fighter = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await fighter.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "one"}
        )
        await receive_type(fighter, "waiting")
        await fighter.send_json({"version": PROTOCOL_VERSION, "type": "cpu", "level": "champion"})
        ready = await receive_type(fighter, "ready")
        assert [player["id"] for player in ready["players"]] == ["one", "cpu:champion"]
        assert ready["players"][1]["cpu"] is True
        snapshot = await receive_type(fighter, "snapshot")
        assert [entry["player_id"] for entry in snapshot["payload"]["fighters"]] == [
            "one",
            "cpu:champion",
        ]

        watcher = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await watcher.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "two"}
        )
        welcome = await receive_type(watcher, "welcome")
        assert welcome["role"] == "spectator"
        await watcher.send_json({"version": PROTOCOL_VERSION, "type": "cpu", "level": "rookie"})
        error = await receive_type(watcher, "error")
        assert error["code"] == "spectator_read_only"
        await watcher.close()
        assert not fighter.closed
        async with asyncio.timeout(1):
            await fighter.close()
    async with asyncio.timeout(1):
        await server.close()


async def test_fighters_pick_their_styles_over_the_socket_and_a_spectator_cannot(
    repository: Repository,
) -> None:
    auth = FakeAuth()
    auth.tickets = {
        name: AuthenticatedPlayer(name, GUILD, "room", name.title(), None)
        for name in ("one", "two", "three")
    }
    rooms = HandsRoomManager(
        repository,
        config=RoomConfig(
            style_select_seconds=5.0,
            tick_interval_seconds=0.002,
            broadcast_every_ticks=1,
            reconnect_grace_seconds=0.1,
            result_hold_seconds=0.05,
            engine_config=EngineConfig(
                rounds=1,
                round_ticks=5000,
                rest_ticks=0,
                countdown_ticks=1,
                flash_ko_enabled=False,
            ),
        ),
        match_id_factory=lambda: "server-styles",
    )
    server, _auth, base = await start_server(repository, auth=auth, rooms=rooms)

    async def receive_type(ws: aiohttp.ClientWebSocketResponse, kind: str) -> dict:
        async with asyncio.timeout(1):
            while True:
                message = await ws.receive()
                if message.type != aiohttp.WSMsgType.TEXT:
                    raise AssertionError(f"socket closed before {kind}")
                payload = json.loads(message.data)
                if payload["type"] == kind:
                    return payload

    def choice(style: str, ready: bool) -> dict:
        return {"version": PROTOCOL_VERSION, "type": "style", "style": style, "ready": ready}

    async with aiohttp.ClientSession() as client:
        sockets = {}
        for name in ("one", "two"):
            sockets[name] = await client.ws_connect(
                f"{base}/api/hands/ws", headers={"Origin": ORIGIN}
            )
            await sockets[name].send_json(
                {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": name}
            )
        await receive_type(sockets["one"], "select")
        await sockets["one"].send_json(choice("swarmer", True))
        await sockets["two"].send_json(choice("counter_puncher", True))
        ready = await receive_type(sockets["two"], "ready")
        assert {player["id"]: player["style"] for player in ready["players"]} == {
            "one": "swarmer",
            "two": "counter_puncher",
        }
        snapshot = await receive_type(sockets["one"], "snapshot")
        assert [entry["style"] for entry in snapshot["payload"]["fighters"]] == [
            "swarmer",
            "counter_puncher",
        ]

        watcher = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await watcher.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "three"}
        )
        assert (await receive_type(watcher, "welcome"))["role"] == "spectator"
        await watcher.send_json(choice("slugger", True))
        assert (await receive_type(watcher, "error"))["code"] == "spectator_read_only"
        await watcher.close()
        async with asyncio.timeout(1):
            for ws in sockets.values():
                await ws.close()
    async with asyncio.timeout(1):
        await server.close()


async def test_a_spectator_seated_before_the_bell_fights_over_the_same_socket(
    repository: Repository,
) -> None:
    auth = FakeAuth()
    auth.tickets = {
        name: AuthenticatedPlayer(name, GUILD, "room", name.title(), None)
        for name in ("one", "two", "three")
    }
    rooms = HandsRoomManager(
        repository,
        config=RoomConfig(
            style_select_seconds=5.0,
            tick_interval_seconds=0.002,
            reconnect_grace_seconds=0.1,
            result_hold_seconds=0.05,
            engine_config=EngineConfig(rounds=1, round_ticks=5000, rest_ticks=0, countdown_ticks=1),
        ),
    )
    server, _auth, base = await start_server(repository, auth=auth, rooms=rooms)

    async def receive_type(ws: aiohttp.ClientWebSocketResponse, kind: str) -> dict:
        async with asyncio.timeout(2):
            while True:
                message = await ws.receive()
                if message.type != aiohttp.WSMsgType.TEXT:
                    raise AssertionError(f"socket closed before {kind}")
                payload = json.loads(message.data)
                assert payload["type"] != "error", payload
                if payload["type"] == kind:
                    return payload

    async def connect(name: str) -> aiohttp.ClientWebSocketResponse:
        ws = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await ws.send_json({"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": name})
        return ws

    def choice(style: str) -> dict:
        return {"version": PROTOCOL_VERSION, "type": "style", "style": style, "ready": True}

    async with aiohttp.ClientSession() as client:
        one = await connect("one")
        two = await connect("two")
        await receive_type(one, "select")
        three = await connect("three")
        assert (await receive_type(three, "welcome"))["role"] == "spectator"
        await two.close()
        seated = await receive_type(three, "welcome")
        assert (seated["role"], seated["seat"]) == ("fighter", 2)
        assert seated["reconnect_ticket"] in auth.tickets
        await three.send_json(choice("slugger"))
        await one.send_json(choice("boxer"))
        ready = await receive_type(three, "ready")
        assert {player["id"]: player["style"] for player in ready["players"]} == {
            "one": "boxer",
            "three": "slugger",
        }
        await receive_type(three, "snapshot")
        async with asyncio.timeout(1):
            for ws in (one, three):
                await ws.close()
    async with asyncio.timeout(1):
        await server.close()


async def test_state_updates_are_deflated_but_frames_carrying_a_ticket_never_are(
    repository: Repository,
) -> None:
    refresh_now = asyncio.Event()
    never = asyncio.Event()
    refreshes = 0

    async def ticket_sleep(_delay: float) -> None:
        nonlocal refreshes
        refreshes += 1
        await (refresh_now if refreshes == 1 else never).wait()

    auth = FakeAuth()
    auth.tickets = {
        "one": AuthenticatedPlayer("one", GUILD, "room", "One", None),
        "two": AuthenticatedPlayer("two", GUILD, "room", "Two", None),
    }
    rooms = stalled_reader_rooms(repository, "deflated")
    server, _auth, base = await start_server(
        repository, auth=auth, rooms=rooms, ticket_refresh=1.0, ticket_sleep=ticket_sleep
    )
    assert server.bound_port is not None
    reader, writer, extensions = await connect_deflate_client(server.bound_port, "one")
    assert extensions.startswith("permessage-deflate")
    # One inflater for the whole stream: the server keeps its deflate context between messages.
    inflater = zlib.decompressobj(-15)
    received: list[tuple[dict[str, object], bool]] = []

    async def read_until(kind: str, count: int = 1) -> None:
        async with asyncio.timeout(10):
            while sum(1 for message, _ in received if message["type"] == kind) < count:
                compressed, opcode, payload = await read_server_frame(reader)
                if opcode != 0x1:
                    continue
                if compressed:
                    payload = inflater.decompress(payload + b"\x00\x00\xff\xff")
                received.append((json.loads(payload), compressed))

    async with aiohttp.ClientSession() as client:
        two = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await two.send_json({"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "two"})
        await read_until("snapshot", 3)
        refresh_now.set()
        await read_until("ticket")
        snapshots_before = sum(1 for message, _ in received if message["type"] == "snapshot")
        await read_until("snapshot", snapshots_before + 3)
        await two.close()
    writer.close()
    await server.close()

    welcome, welcome_compressed = received[0]
    assert welcome["type"] == "welcome"
    assert isinstance(welcome["reconnect_ticket"], str)
    assert not welcome_compressed
    ticket, ticket_compressed = next(item for item in received if item[0]["type"] == "ticket")
    assert isinstance(ticket["reconnect_ticket"], str)
    assert not ticket_compressed
    assert all(
        compressed
        for message, compressed in received
        if message["type"] not in {"welcome", "ticket"}
    )


async def test_a_spectator_on_a_slow_mobile_link_keeps_up_with_the_fight(
    repository: Repository,
) -> None:
    auth = FakeAuth()
    for user in ("one", "two", "three"):
        auth.tickets[user] = AuthenticatedPlayer(user, GUILD, "room", user.title(), None)
    rooms = HandsRoomManager(
        repository,
        config=RoomConfig(
            style_select_seconds=0.0,
            engine_config=EngineConfig(
                rounds=1, round_ticks=1_000_000, countdown_ticks=1, flash_ko_enabled=False
            ),
        ),
        match_id_factory=lambda: "slow-link",
    )
    server, _auth, base = await start_server(repository, auth=auth, rooms=rooms)
    assert server.bound_port is not None
    proxy = await start_capped_proxy(server.bound_port, bytes_per_second=40_000)
    proxy_port = proxy.sockets[0].getsockname()[1]

    async def fight(socket: aiohttp.ClientWebSocketResponse) -> None:
        async for _message in socket:
            pass

    async with aiohttp.ClientSession() as client:
        fighters = []
        for ticket in ("one", "two"):
            socket = await client.ws_connect(
                f"{base}/api/hands/ws", headers={"Origin": ORIGIN}, compress=15
            )
            await socket.send_json(
                {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": ticket}
            )
            fighters.append(asyncio.create_task(fight(socket)))
        spectator = await client.ws_connect(
            f"http://127.0.0.1:{proxy_port}/api/hands/ws", headers={"Origin": ORIGIN}, compress=15
        )
        await spectator.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "three"}
        )
        loop = asyncio.get_running_loop()
        started = loop.time()
        lag_ticks: list[int] = []
        async with asyncio.timeout(10):
            # Uncompressed per-tick snapshots need about 65 KB/s, so this link fell a third of a
            # second further behind every second.
            while loop.time() - started < 3.0:
                payload = json.loads((await spectator.receive()).data)
                if payload["type"] == "snapshot":
                    engine = rooms._rooms["room"].engine
                    assert engine is not None
                    lag_ticks.append(engine.tick - payload["payload"]["tick"])
        await spectator.close()
        for task in fighters:
            task.cancel()
        await asyncio.gather(*fighters, return_exceptions=True)
    proxy.close()
    await server.close()

    assert max(lag_ticks[-30:]) <= 6
    assert len(lag_ticks) > 60


async def test_a_fighter_whose_socket_stops_reading_is_paused_then_forfeits(
    repository: Repository,
) -> None:
    auth = FakeAuth()
    auth.tickets = {
        "one": AuthenticatedPlayer("one", GUILD, "room", "One", None),
        "two": AuthenticatedPlayer("two", GUILD, "room", "Two", None),
    }
    rooms = stalled_reader_rooms(repository, "stalled-reader")
    server, _auth, base = await start_server(repository, auth=auth, rooms=rooms)
    assert server.bound_port is not None
    async with aiohttp.ClientSession() as client:
        one = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await one.send_json({"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "one"})
        await receive_until(one, "waiting")
        stalled, _frames = await connect_reader_that_stalls(server.bound_port, "two")
        try:
            paused = await receive_until(one, "paused")
            assert paused["player_id"] == "two"
            final = await receive_until(one, "final")
        finally:
            stalled.close()
        assert final["winner_id"] == "one"
        assert final["method"] == "forfeit"
        await one.close()
    assert await repository.get_hands_match("stalled-reader") is not None
    await server.close()


async def test_reconnecting_over_a_stalled_socket_does_not_hold_up_any_join(
    repository: Repository,
) -> None:
    auth = FakeAuth()
    auth.tickets = {
        "one": AuthenticatedPlayer("one", GUILD, "room", "One", None),
        "two": AuthenticatedPlayer("two", GUILD, "room", "Two", None),
        "elsewhere": AuthenticatedPlayer("three", GUILD, "other-room", "Three", None),
    }
    # A generous outbound bound keeps the stalled socket attached until the player reconnects.
    rooms = stalled_reader_rooms(repository, "stalled-reconnect", outbound_queue_size=100_000)
    server, _auth, base = await start_server(repository, auth=auth, rooms=rooms)
    assert server.bound_port is not None
    async with aiohttp.ClientSession() as client:
        one = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await one.send_json({"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "one"})
        await receive_until(one, "waiting")
        stalled, frames = await connect_reader_that_stalls(server.bound_port, "two", read_frames=1)
        try:
            assert frames[0]["type"] == "welcome"
            room = rooms._rooms["room"]
            old_connection = room._slots["two"].connection
            assert old_connection is not None
            old_socket = old_connection.socket
            assert isinstance(old_socket, server_module._RoomSocket)
            # The room holds snapshots back once a few kilobytes are buffered, short of the
            # transport's own pause; a lower mark gets the paused transport a dead peer leaves.
            # More than that backlog only builds once the peer's kernel buffers are full too, so
            # the pause is lasting rather than one overlapped write still in flight.
            transport = old_socket._request.transport
            assert transport is not None
            # The server's own kernel send buffer is kept small too, so the stall builds in a
            # fraction of a second however large the system would autotune it.
            transport.get_extra_info("socket").setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
            transport.set_write_buffer_limits(high=1024)
            async with asyncio.timeout(30):
                while not (  # noqa: ASYNC110
                    old_socket._request.protocol.writing_paused
                    and transport.get_write_buffer_size() > SNAPSHOT_BACKLOG_BYTES
                ):
                    await asyncio.sleep(0.01)

            replacement = await client.ws_connect(
                f"{base}/api/hands/ws", headers={"Origin": ORIGIN}
            )
            elsewhere = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
            await replacement.send_json(
                {
                    "version": PROTOCOL_VERSION,
                    "type": "authenticate",
                    "ticket": frames[0]["reconnect_ticket"],
                }
            )
            await elsewhere.send_json(
                {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "elsewhere"}
            )
            welcome = await receive_until(replacement, "welcome", deadline_seconds=2)
            assert welcome["player_id"] == "two"
            await receive_until(replacement, "resumed", deadline_seconds=2)
            elsewhere_welcome = await receive_until(elsewhere, "welcome", deadline_seconds=2)
            assert elsewhere_welcome["player_id"] == "three"

            # The stalled socket is aborted once its close times out.
            loop = asyncio.get_running_loop()
            async with asyncio.timeout(10):
                while True:
                    try:
                        if not await loop.sock_recv(stalled, 65536):
                            break
                    except ConnectionError:
                        break
        finally:
            stalled.close()
        for socket_ in (one, replacement, elsewhere):
            await socket_.close()
    await server.close()


@pytest.mark.parametrize(
    "kwargs",
    [
        {"per_caller_request_limit": 0},
        {"max_concurrent_upstream_per_caller": 0},
        {"max_concurrent_ws_auth_per_caller": 0},
        {"trusted_proxy_cidrs": ("not-a-network",)},
        {"trusted_proxy_cidrs": ("0.0.0.0/0",)},
        {"trusted_proxy_cidrs": ("::/0",)},
    ],
)
def test_admission_config_rejects_unbounded_or_invalid_values(
    kwargs: dict[str, object],
) -> None:
    with pytest.raises(ValueError):
        AdmissionConfig(**kwargs)  # type: ignore[arg-type]


@pytest.mark.parametrize("refresh", [float("nan"), 0.5, 300.0])
def test_ticket_refresh_interval_must_be_finite_bounded_and_pre_expiry(
    refresh: float,
) -> None:
    with pytest.raises(ValueError, match="ticket refresh"):
        HandsServer(
            repository=object(),  # type: ignore[arg-type]
            application_id=APP,
            guild_id=GUILD,
            client_secret="secret",
            bot_token="token",
            host="127.0.0.1",
            port=0,
            auth=FakeAuth(),
            rooms=MagicRooms(),
            ticket_refresh_seconds=refresh,
        )


async def test_public_semaphore_acquisition_rejects_capacity_and_releases() -> None:
    semaphore = asyncio.Semaphore(1)
    assert await HandsServer._try_acquire(semaphore)
    assert not await HandsServer._try_acquire(semaphore)
    semaphore.release()
    assert await HandsServer._try_acquire(semaphore)
    semaphore.release()


async def test_bootstrap_http_admission_limits(repository: Repository) -> None:
    server, _auth, base = await start_server(
        repository,
        admission=AdmissionConfig(request_limit=1, request_window_seconds=60),
    )
    headers = {"Origin": ORIGIN}
    async with aiohttp.ClientSession() as client:
        first = await post_bootstrap(client, base, "instance", headers=headers)
        assert first.status == 200
        limited = await post_bootstrap(client, base, "instance", headers=headers)
        assert limited.status == 429
        assert (
            sum(len(requests) for requests in server._bootstrap_caller_limit._requests.values())
            == 1
        )
    await server.close()


async def test_http_admission_is_per_caller_and_forwarded_headers_require_trust(
    repository: Repository,
) -> None:
    direct, _auth, direct_base = await start_server(
        repository,
        admission=AdmissionConfig(
            request_limit=10,
            per_caller_request_limit=1,
            request_window_seconds=60,
        ),
    )
    async with aiohttp.ClientSession() as client:
        first = await post_bootstrap(
            client,
            direct_base,
            "one",
            headers={"Origin": ORIGIN, "X-Forwarded-For": "203.0.113.1"},
        )
        spoofed = await post_bootstrap(
            client,
            direct_base,
            "one",
            headers={"Origin": ORIGIN, "X-Forwarded-For": "203.0.113.2"},
        )
        assert first.status == 200
        assert spoofed.status == 429
    await direct.close()

    trusted, _auth, trusted_base = await start_server(
        repository,
        admission=AdmissionConfig(
            request_limit=10,
            per_caller_request_limit=1,
            request_window_seconds=60,
            trusted_proxy_cidrs=("127.0.0.0/8", "::1/128"),
        ),
    )
    async with aiohttp.ClientSession() as client:
        first = await post_bootstrap(
            client,
            trusted_base,
            "one",
            headers={
                "Origin": ORIGIN,
                "X-Forwarded-For": "198.51.100.9, 203.0.113.10",
            },
        )
        forged_left = await post_bootstrap(
            client,
            trusted_base,
            "one",
            headers={
                "Origin": ORIGIN,
                "X-Forwarded-For": "192.0.2.99, 203.0.113.10",
            },
        )
        other = await post_bootstrap(
            client,
            trusted_base,
            "three",
            headers={"Origin": ORIGIN, "X-Forwarded-For": "203.0.113.11"},
        )
        malformed = await post_bootstrap(
            client,
            trusted_base,
            "four",
            headers={"Origin": ORIGIN, "X-Forwarded-For": "not-an-ip"},
        )
        assert first.status == 200
        assert forged_left.status == 429
        assert other.status == 200
        assert malformed.status == 400
    await trusted.close()


async def test_players_behind_one_proxy_address_are_limited_per_activity_instance(
    repository: Repository,
) -> None:
    # Discord's Activity proxy hides players' addresses: every request arrives from its address.
    server, _auth, base = await start_server(
        repository,
        admission=AdmissionConfig(
            request_limit=10,
            per_caller_request_limit=1,
            request_window_seconds=60,
            trusted_proxy_cidrs=("127.0.0.0/8", "::1/128"),
        ),
    )
    proxy = {"Origin": ORIGIN, "X-Forwarded-For": "162.159.0.1"}
    async with aiohttp.ClientSession() as client:
        statuses = [
            (await post_bootstrap(client, base, instance, headers=proxy)).status
            for instance in ("voice-a", "voice-b", "voice-a")
        ]
        # One voice channel's sign-ins cannot crowd out another's, and each is still limited.
        assert statuses == [200, 200, 429]

        async def token(state: str) -> int:
            response = await client.post(
                f"{base}/api/hands/token",
                json={"code": "code", "state": state},
                headers=proxy,
            )
            return response.status

        # The exchange is scoped through the state the server issued for an instance; a state it
        # never issued names nothing and counts against the address.
        assert await token("oauth-state") == 200
        assert await token("other-state") == 401
        assert await token("oauth-state") == 429
        assert await token("forged-one") == 401
        assert await token("forged-two") == 429
    await server.close()


async def test_per_caller_window_capacity_purges_expired_callers(
    repository: Repository,
) -> None:
    class MutableClock:
        value = 0.0

        def __call__(self) -> float:
            return self.value

    clock = MutableClock()
    server, _auth, base = await start_server(
        repository,
        admission=AdmissionConfig(
            request_limit=10,
            per_caller_request_limit=1,
            request_window_seconds=10,
            max_tracked_callers=2,
            trusted_proxy_cidrs=("127.0.0.0/8", "::1/128"),
        ),
        monotonic_clock=clock,
    )
    async with aiohttp.ClientSession() as client:

        async def bootstrap(caller: str, instance: str) -> int:
            response = await post_bootstrap(
                client,
                base,
                instance,
                headers={"Origin": ORIGIN, "X-Forwarded-For": caller},
            )
            return response.status

        assert await bootstrap("203.0.113.1", "one") == 200
        assert await bootstrap("203.0.113.2", "two") == 200
        assert await bootstrap("203.0.113.3", "three") == 429
        assert len(server._bootstrap_caller_limit._requests) == 2
        clock.value = 11
        assert await bootstrap("203.0.113.3", "three") == 200
        assert list(server._bootstrap_caller_limit._requests) == ["203.0.113.3 three"]
    await server.close()


async def test_per_caller_upstream_concurrency_does_not_block_other_callers(
    repository: Repository,
) -> None:
    class BlockingAuth(FakeAuth):
        def __init__(self) -> None:
            super().__init__()
            self.calls = 0
            self.first_entered = asyncio.Event()
            self.second_entered = asyncio.Event()
            self.release = asyncio.Event()

        async def begin(self, instance_id: object):
            self.calls += 1
            (self.first_entered if self.calls == 1 else self.second_entered).set()
            await self.release.wait()
            return await super().begin(instance_id)

    auth = BlockingAuth()
    server, _auth, base = await start_server(
        repository,
        auth=auth,
        admission=AdmissionConfig(
            request_limit=20,
            per_caller_request_limit=10,
            request_window_seconds=60,
            max_concurrent_upstream=2,
            max_concurrent_upstream_per_caller=1,
            trusted_proxy_cidrs=("127.0.0.0/8", "::1/128"),
        ),
    )
    async with aiohttp.ClientSession() as client:
        first = asyncio.create_task(
            post_bootstrap(
                client,
                base,
                "one",
                headers={"Origin": ORIGIN, "X-Forwarded-For": "203.0.113.1"},
            )
        )
        await auth.first_entered.wait()
        same = await post_bootstrap(
            client,
            base,
            "one",
            headers={"Origin": ORIGIN, "X-Forwarded-For": "203.0.113.1"},
        )
        other = asyncio.create_task(
            post_bootstrap(
                client,
                base,
                "other",
                headers={"Origin": ORIGIN, "X-Forwarded-For": "203.0.113.2"},
            )
        )
        await auth.second_entered.wait()
        assert same.status == 503
        assert auth.calls == 2
        auth.release.set()
        responses = await asyncio.gather(first, other)
        assert [response.status for response in responses] == [200, 200]
    await server.close()


async def test_per_caller_websocket_auth_slots_release_and_isolate_callers(
    repository: Repository,
) -> None:
    server, _auth, base = await start_server(
        repository,
        admission=AdmissionConfig(
            max_concurrent_ws_auth=3,
            max_concurrent_ws_auth_per_caller=1,
            trusted_proxy_cidrs=("127.0.0.0/8", "::1/128"),
        ),
    )
    headers_one = {"Origin": ORIGIN, "X-Forwarded-For": "203.0.113.1"}
    headers_two = {"Origin": ORIGIN, "X-Forwarded-For": "203.0.113.2"}
    async with aiohttp.ClientSession() as client:
        first = await client.ws_connect(f"{base}/api/hands/ws", headers=headers_one)
        with pytest.raises(aiohttp.WSServerHandshakeError) as caught:
            await client.ws_connect(f"{base}/api/hands/ws", headers=headers_one)
        assert caught.value.status == 503

        other = await client.ws_connect(f"{base}/api/hands/ws", headers=headers_two)
        await other.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "bad"}
        )
        assert json.loads((await other.receive(timeout=1)).data)["code"] == "invalid_ticket"
        await other.close()

        await first.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "bad"}
        )
        assert json.loads((await first.receive(timeout=1)).data)["code"] == "invalid_ticket"
        await first.close()
        replacement = await client.ws_connect(f"{base}/api/hands/ws", headers=headers_one)
        await replacement.close()
    await server.close()


async def test_concurrent_upstream_and_websocket_auth_are_bounded(
    repository: Repository,
) -> None:
    class BlockingAuth(FakeAuth):
        def __init__(self) -> None:
            super().__init__()
            self.entered = asyncio.Event()
            self.release = asyncio.Event()

        async def begin(self, instance_id: object):
            self.entered.set()
            await self.release.wait()
            return await super().begin(instance_id)

    auth = BlockingAuth()
    server, _auth, base = await start_server(
        repository,
        auth=auth,
        admission=AdmissionConfig(
            request_limit=10,
            request_window_seconds=60,
            max_concurrent_upstream=1,
            max_concurrent_ws_auth=1,
        ),
        auth_timeout=0.5,
    )
    headers = {"Origin": ORIGIN}
    async with aiohttp.ClientSession() as client:
        first_request = asyncio.create_task(
            post_bootstrap(client, base, "instance", headers=headers)
        )
        await auth.entered.wait()
        busy = await post_bootstrap(client, base, "instance", headers=headers)
        assert busy.status == 503
        auth.release.set()
        first = await first_request
        assert first.status == 200

        first_ws = await client.ws_connect(f"{base}/api/hands/ws", headers=headers)
        with pytest.raises(aiohttp.WSServerHandshakeError) as caught:
            await client.ws_connect(f"{base}/api/hands/ws", headers=headers)
        assert caught.value.status == 503
        await first_ws.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "bad"}
        )
        await first_ws.receive(timeout=1)
        await first_ws.close()

        auth.tickets["valid"] = AuthenticatedPlayer("one", GUILD, "room", "One", None)
        available = await client.ws_connect(f"{base}/api/hands/ws", headers=headers)
        await available.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "valid"}
        )
        welcome = await available.receive(timeout=1)
        assert json.loads(welcome.data)["type"] == "welcome"
        await available.close()
    await server.close()


async def test_ticket_replay_does_not_replace_live_socket(repository: Repository) -> None:
    auth = FakeAuth()
    auth.tickets["one-use"] = AuthenticatedPlayer("one", GUILD, "room", "One", None)
    server, _auth, base = await start_server(repository, auth=auth)
    async with aiohttp.ClientSession() as client:
        live = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await live.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "one-use"}
        )
        welcome = json.loads((await live.receive(timeout=1)).data)
        assert welcome["type"] == "welcome"
        assert welcome["reconnect_ticket"].startswith("rotated-")

        replay = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await replay.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "one-use"}
        )
        error = json.loads((await replay.receive(timeout=1)).data)
        assert error["code"] == "invalid_ticket"
        await replay.close()
        assert not live.closed
        await live.close()
    await server.close()


async def test_refreshed_ticket_survives_original_rotation_expiry(
    repository: Repository,
) -> None:
    wall = 1000.0
    refresh_wakes: asyncio.Queue[None] = asyncio.Queue()

    def wall_clock() -> float:
        return wall

    async def ticket_sleep(delay: float) -> None:
        assert delay == 15
        await refresh_wakes.get()

    activated = asyncio.Event()

    class ObservableAuth(HandsAuth):
        def activate_ticket(self, ticket: object, player: AuthenticatedPlayer) -> None:
            super().activate_ticket(ticket, player)
            activated.set()

    http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _request: httpx.Response(500))
    )
    auth = ObservableAuth(
        application_id=APP,
        guild_id=GUILD,
        client_secret="secret",
        bot_token="bot-token",
        client=http_client,
        close_client=True,
        wall_clock=wall_clock,
        ticket_ttl_seconds=30,
        ticket_secret=b"ticket-refresh-secret" * 2,
    )
    player = AuthenticatedPlayer("111222333", GUILD, "room", "One", None)
    initial_ticket = auth.issue_ticket(player)
    server = HandsServer(
        repository=repository,
        application_id=APP,
        guild_id=GUILD,
        client_secret="secret",
        bot_token="bot-token",
        host="127.0.0.1",
        port=0,
        auth=auth,
        ticket_sleep=ticket_sleep,
    )
    await server.start()
    assert server.bound_port is not None
    base = f"http://127.0.0.1:{server.bound_port}"
    async with aiohttp.ClientSession() as client:
        live = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await live.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": initial_ticket}
        )
        welcome = json.loads((await live.receive(timeout=1)).data)
        original_rotation = welcome["reconnect_ticket"]

        wall = 1020.0
        refresh_wakes.put_nowait(None)
        while True:
            refreshed = json.loads((await live.receive(timeout=1)).data)
            if refreshed["type"] == "ticket":
                break
        refreshed_ticket = refreshed["reconnect_ticket"]
        assert refreshed_ticket != original_rotation
        await live.send_json(
            {
                "version": PROTOCOL_VERSION,
                "type": "ticket_ack",
                "refresh_id": refreshed["refresh_id"],
            }
        )
        await activated.wait()
        with pytest.raises(HandsAuthError, match="invalid_ticket"):
            auth.verify_ticket(original_rotation)

        wall = 1031.0
        await live.close()

        replacement = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await replacement.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": refreshed_ticket}
        )
        replacement_welcome = json.loads((await replacement.receive(timeout=1)).data)
        assert replacement_welcome["type"] == "welcome"
        await replacement.close()
    await server.close()
    assert http_client.is_closed
    await asyncio.sleep(0)
    assert not {
        task.get_name()
        for task in asyncio.all_tasks()
        if not task.done() and task.get_name().startswith("hands-ticket-refresh-")
    }


async def test_unexpected_post_upgrade_failure_closes_with_generic_error(
    repository: Repository,
) -> None:
    rooms = MagicRooms(join_error=RuntimeError("private failure"))
    server, _auth, base = await start_server(repository, rooms=rooms)
    auth = server.auth
    assert isinstance(auth, FakeAuth)
    auth.tickets["valid"] = AuthenticatedPlayer("one", GUILD, "room", "One", None)
    async with aiohttp.ClientSession() as client:
        socket = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await socket.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "valid"}
        )
        error = json.loads((await socket.receive(timeout=1)).data)
        assert error == {"code": "internal_error", "type": "error", "version": PROTOCOL_VERSION}
        assert socket.closed or (await socket.receive(timeout=1)).type in {
            aiohttp.WSMsgType.CLOSE,
            aiohttp.WSMsgType.CLOSED,
        }
    await server.close()


async def test_close_failure_still_closes_all_components_and_repeats_result(
    repository: Repository,
) -> None:
    auth = FakeAuth()
    rooms = MagicRooms(close_error=RuntimeError("rooms close failed"))
    server = HandsServer(
        repository=repository,
        application_id=APP,
        guild_id=GUILD,
        client_secret="secret",
        bot_token="token",
        host="127.0.0.1",
        port=0,
        auth=auth,
        rooms=rooms,
    )
    site_stop = AsyncMock(side_effect=RuntimeError("site stop failed"))
    runner_cleanup = AsyncMock()
    server._site = SimpleNamespace(stop=site_stop)
    server._runner = SimpleNamespace(cleanup=runner_cleanup)

    for _ in range(2):
        with pytest.raises(RuntimeError, match="site stop failed"):
            await server.close()
    site_stop.assert_awaited_once()
    rooms.close_mock.assert_awaited_once()
    runner_cleanup.assert_awaited_once()
    assert auth.closed


async def test_cancelled_close_waiter_does_not_cancel_shared_cleanup(
    repository: Repository,
) -> None:
    release = asyncio.Event()

    class BlockingCloseAuth(FakeAuth):
        async def close(self) -> None:
            await release.wait()
            await super().close()

    auth = BlockingCloseAuth()
    rooms = MagicRooms()
    server = HandsServer(
        repository=repository,
        application_id=APP,
        guild_id=GUILD,
        client_secret="secret",
        bot_token="token",
        host="127.0.0.1",
        port=0,
        auth=auth,
        rooms=rooms,
    )
    waiter = asyncio.create_task(server.close())
    await asyncio.sleep(0)
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert server._close_task is not None and not server._close_task.done()
    release.set()
    await server.close()
    assert auth.closed
    rooms.close_mock.assert_awaited_once()


async def test_request_body_limit_and_clean_shutdown(repository: Repository) -> None:
    server, auth, base = await start_server(repository)
    async with aiohttp.ClientSession() as client:
        response = await client.post(
            URL(f"{base}/api/hands/token"),
            data=b"x" * 20_000,
            headers={"Origin": ORIGIN, "Content-Type": "application/json"},
        )
        assert response.status == 413
        assert response.headers["X-Content-Type-Options"] == "nosniff"
    await server.close()
    assert not server.running
    assert auth.closed


async def _bout_against_the_computer(
    client: aiohttp.ClientSession, base: str, auth: FakeAuth, name: str
) -> aiohttp.ClientWebSocketResponse:
    auth.tickets[name] = AuthenticatedPlayer(name, GUILD, f"room-{name}", name, None)
    ws = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
    await ws.send_json({"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": name})
    async with asyncio.timeout(2):
        while json.loads((await ws.receive()).data)["type"] != "waiting":
            pass
    await ws.send_json({"version": PROTOCOL_VERSION, "type": "cpu", "level": "rookie"})
    async with asyncio.timeout(2):
        while json.loads((await ws.receive()).data)["type"] != "select":
            pass
    # The computer picks its style at once; the bout starts as soon as this fighter confirms one.
    await ws.send_json(
        {"version": PROTOCOL_VERSION, "type": "style", "style": "balanced", "ready": True}
    )
    async with asyncio.timeout(2):
        while json.loads((await ws.receive()).data)["type"] != "ready":
            pass
    return ws


async def _errors_until_closed(ws: aiohttp.ClientWebSocketResponse, seconds: float) -> list[str]:
    errors: list[str] = []
    try:
        async with asyncio.timeout(seconds):
            while True:
                message = await ws.receive()
                if message.type != aiohttp.WSMsgType.TEXT:
                    errors.append("closed")
                    return errors
                payload = json.loads(message.data)
                if payload["type"] == "error":
                    errors.append(payload["code"])
    except TimeoutError:
        errors.append("open")
    return errors


def _cpu_bout_rooms(repository: Repository) -> HandsRoomManager:
    return HandsRoomManager(
        repository,
        config=RoomConfig(
            tick_interval_seconds=0.01,
            reconnect_grace_seconds=1.0,
            result_hold_seconds=0.05,
            engine_config=EngineConfig(
                rounds=1, round_ticks=50_000, rest_ticks=0, countdown_ticks=1
            ),
        ),
    )


async def test_a_flood_of_computer_requests_is_cut_off_like_a_flood_of_inputs(
    repository: Repository,
) -> None:
    auth = FakeAuth()
    server, _auth, base = await start_server(
        repository, auth=auth, rooms=_cpu_bout_rooms(repository)
    )
    async with aiohttp.ClientSession() as client:
        repeat = await _bout_against_the_computer(client, base, auth, "repeat")
        await repeat.send_json({"version": PROTOCOL_VERSION, "type": "cpu", "level": "champion"})
        assert await _errors_until_closed(repeat, 0.3) == ["open"]
        await repeat.close()

        flooder = await _bout_against_the_computer(client, base, auth, "flooder")
        frame = json.dumps({"version": PROTOCOL_VERSION, "type": "cpu", "level": "champion"})
        for _ in range(4000):
            await flooder.send_str(frame)
        assert await _errors_until_closed(flooder, 2.0) == ["rate_limited", "closed"]
    async with asyncio.timeout(1):
        await server.close()


async def test_a_fighter_who_vanishes_without_a_close_pauses_the_bout_within_the_heartbeat(
    repository: Repository,
) -> None:
    # In production a silent drop pauses the bout about 7.5 s after the fighter's last frame.
    assert server_module.WEBSOCKET_HEARTBEAT_SECONDS == 5.0
    heartbeat = 0.2
    auth = FakeAuth()
    rooms = _cpu_bout_rooms(repository)
    server, _auth, base = await start_server(
        repository, auth=auth, rooms=rooms, websocket_heartbeat=heartbeat
    )
    async with aiohttp.ClientSession() as client:
        # A page that sends nothing (blurred, hidden) but whose browser answers pings stays.
        idle = await _bout_against_the_computer(client, base, auth, "idle")
        deadline = asyncio.get_running_loop().time() + 6 * heartbeat
        while asyncio.get_running_loop().time() < deadline:
            message = await idle.receive(timeout=1)
            assert message.type == aiohttp.WSMsgType.TEXT
        await idle.close()

        auth.tickets["vanish"] = AuthenticatedPlayer("vanish", GUILD, "room-vanish", "V", None)
        vanish = await client.ws_connect(
            f"{base}/api/hands/ws", headers={"Origin": ORIGIN}, autoping=False
        )
        await vanish.send_json(
            {"version": PROTOCOL_VERSION, "type": "authenticate", "ticket": "vanish"}
        )
        for request, until in (
            ({"version": PROTOCOL_VERSION, "type": "cpu", "level": "rookie"}, "select"),
            (
                {"version": PROTOCOL_VERSION, "type": "style", "style": "boxer", "ready": True},
                "ready",
            ),
        ):
            await vanish.send_json(request)
            async with asyncio.timeout(2):
                while True:
                    message = await vanish.receive()
                    text = message.data if message.type == aiohttp.WSMsgType.TEXT else "{}"
                    if json.loads(text).get("type") == until:
                        break
        room = rooms._rooms["room-vanish"]
        engine = room.engine
        assert engine is not None
        # The fighter's connection goes quiet: no frames, no pongs, no close.
        silent_since = asyncio.get_running_loop().time()
        async with asyncio.timeout(3):
            while room._slots["vanish"].connection is not None:  # noqa: ASYNC110
                await asyncio.sleep(0.01)
        noticed_after = asyncio.get_running_loop().time() - silent_since
        assert noticed_after < 1.5 * heartbeat + 0.3
        paused_at = engine.tick
        await asyncio.sleep(0.1)
        assert engine.tick == paused_at
        await vanish.close()
    async with asyncio.timeout(1):
        await server.close()


async def test_each_frame_is_decoded_once(
    repository: Repository, monkeypatch: pytest.MonkeyPatch
) -> None:
    from intelstream.hands import protocol

    decoded: list[object] = []
    arrived = asyncio.Event()

    def counting(frame: str | bytes, **kwargs: object) -> object:
        # Every JSON parse the protocol module makes, whichever function makes it.
        decoded.append(frame)
        arrived.set()
        return json.loads(frame, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(
        protocol,
        "json",
        SimpleNamespace(loads=counting, dumps=json.dumps, JSONDecodeError=json.JSONDecodeError),
    )
    auth = FakeAuth()
    server, _auth, base = await start_server(
        repository, auth=auth, rooms=_cpu_bout_rooms(repository)
    )
    async with aiohttp.ClientSession() as client:
        fighter = await _bout_against_the_computer(client, base, auth, "once")
        before = len(decoded)
        arrived.clear()
        await fighter.send_json(
            {
                "version": PROTOCOL_VERSION,
                "type": "input",
                "sequence": 0,
                "client_tick": 0,
                "move": {"x": 1000, "y": 0},
                "defense": "none",
                "actions": [],
            }
        )
        async with asyncio.timeout(1):
            await arrived.wait()
        await asyncio.sleep(0.05)
        assert len(decoded) == before + 1
        await fighter.close()
    async with asyncio.timeout(1):
        await server.close()
