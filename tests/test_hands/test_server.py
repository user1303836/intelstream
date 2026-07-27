from __future__ import annotations

import asyncio
import json
import time
from types import SimpleNamespace
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import aiohttp
import httpx
import pytest
from yarl import URL

from intelstream.database.repository import Repository
from intelstream.hands.auth import AuthenticatedPlayer, AuthExchange, HandsAuth, HandsAuthError
from intelstream.hands.engine import EngineConfig
from intelstream.hands.rooms import HandsRoomManager, RoomConfig, RoomError
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
    )
    await server.start()
    assert server.bound_port is not None
    return server, fake_auth, f"http://127.0.0.1:{server.bound_port}"


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
        assert "client-secret" not in body

        asset = await client.get(f"{base}/app.js")
        assert asset.status == 200
        assert asset.headers["Cache-Control"] == "no-cache"

        missing = await client.get(f"{base}/assets/../auth.py")
        assert missing.status == 404
    await server.close()
    await server.close()
    assert auth.closed


async def test_bootstrap_token_origin_schema_media_and_no_store(repository: Repository) -> None:
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
            "protocol": 1,
            "state": "oauth-state",
            "simulation": {
                "tick_rate": 30,
                "ring_half_width": 500,
                "ring_half_height": 330,
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
        await malformed.send_json({"version": 1, "type": "authenticate", "ticket": "bad"})
        message = await malformed.receive(timeout=1)
        assert json.loads(message.data)["code"] == "invalid_ticket"
        await malformed.close()
    assert not auth.tickets
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
    server, _auth, base = await start_server(
        repository,
        auth=auth,
        auth_timeout=0.01,
        rooms=rooms,
    )
    async with aiohttp.ClientSession() as client:
        socket = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await socket.send_json({"version": 1, "type": "authenticate", "ticket": "valid"})
        await rooms.entered.wait()
        await asyncio.sleep(0.03)
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
        await socket.send_json({"version": 1, "type": "authenticate", "ticket": "valid"})
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


async def test_two_websockets_start_and_third_is_rejected(repository: Repository) -> None:
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
            await ws.send_json({"version": 1, "type": "authenticate", "ticket": ticket})
            sockets.append(ws)
        async with asyncio.timeout(1):
            seen_ready = False
            while not seen_ready:
                message = await sockets[0].receive()
                if message.type == aiohttp.WSMsgType.TEXT:
                    seen_ready = json.loads(message.data)["type"] == "ready"
        third = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await third.send_json({"version": 1, "type": "authenticate", "ticket": "three"})
        error = await third.receive(timeout=1)
        assert json.loads(error.data)["code"] == "room_full"
        await third.close()
        for ws in sockets:
            async with asyncio.timeout(1):
                await ws.close()
    async with asyncio.timeout(1):
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
            "two",
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
            "two",
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
        assert list(server._bootstrap_caller_limit._requests) == ["203.0.113.3"]
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
            "same",
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
        await other.send_json({"version": 1, "type": "authenticate", "ticket": "bad"})
        assert json.loads((await other.receive(timeout=1)).data)["code"] == "invalid_ticket"
        await other.close()

        await first.send_json({"version": 1, "type": "authenticate", "ticket": "bad"})
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
        await first_ws.send_json({"version": 1, "type": "authenticate", "ticket": "bad"})
        await first_ws.receive(timeout=1)
        await first_ws.close()

        auth.tickets["valid"] = AuthenticatedPlayer("one", GUILD, "room", "One", None)
        available = await client.ws_connect(f"{base}/api/hands/ws", headers=headers)
        await available.send_json({"version": 1, "type": "authenticate", "ticket": "valid"})
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
        await live.send_json({"version": 1, "type": "authenticate", "ticket": "one-use"})
        welcome = json.loads((await live.receive(timeout=1)).data)
        assert welcome["type"] == "welcome"
        assert welcome["reconnect_ticket"].startswith("rotated-")

        replay = await client.ws_connect(f"{base}/api/hands/ws", headers={"Origin": ORIGIN})
        await replay.send_json({"version": 1, "type": "authenticate", "ticket": "one-use"})
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
        await live.send_json({"version": 1, "type": "authenticate", "ticket": initial_ticket})
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
                "version": 1,
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
            {"version": 1, "type": "authenticate", "ticket": refreshed_ticket}
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
        await socket.send_json({"version": 1, "type": "authenticate", "ticket": "valid"})
        error = json.loads((await socket.receive(timeout=1)).data)
        assert error == {"code": "internal_error", "type": "error", "version": 1}
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
