from __future__ import annotations

import asyncio
import contextlib
import json
import math
import mimetypes
import secrets
import time
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from importlib import resources
from ipaddress import IPv4Address, IPv6Address, ip_address, ip_network
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Protocol
from urllib.parse import urlsplit

import structlog
from aiohttp import WSMsgType, web

from intelstream.hands.auth import DEFAULT_TICKET_TTL_SECONDS, HandsAuth, HandsAuthError
from intelstream.hands.protocol import (
    MAX_FRAME_BYTES,
    PROTOCOL_VERSION,
    ProtocolError,
    parse_ticket_ack,
)
from intelstream.hands.rooms import HandsRoomManager, RoomError, RoomMembership
from intelstream.hands.rules import RING_HALF_HEIGHT, RING_HALF_WIDTH, TICKS_PER_SECOND

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Mapping
    from importlib.resources.abc import Traversable

    import httpx

    from intelstream.database.repository import Repository
    from intelstream.hands.auth import AuthenticatedPlayer, AuthExchange

logger = structlog.get_logger(__name__)
MAX_HTTP_BODY_BYTES = 16_384
MAX_AUTH_FRAME_BYTES = 4096
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; base-uri 'none'; object-src 'none'; "
        "script-src 'self'; style-src 'self'; img-src 'self' data: blob:; "
        "connect-src 'self'; media-src 'self' blob:; "
        "frame-ancestors https://discord.com https://*.discord.com"
    ),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
}


@dataclass(frozen=True, slots=True)
class AdmissionConfig:
    request_limit: int = 120
    per_caller_request_limit: int = 20
    request_window_seconds: float = 60.0
    max_tracked_callers: int = 1024
    max_concurrent_upstream: int = 16
    max_concurrent_upstream_per_caller: int = 2
    max_concurrent_ws_auth: int = 64
    max_concurrent_ws_auth_per_caller: int = 4
    trusted_proxy_cidrs: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if (
            min(
                self.request_limit,
                self.per_caller_request_limit,
                self.max_tracked_callers,
                self.max_concurrent_upstream,
                self.max_concurrent_upstream_per_caller,
                self.max_concurrent_ws_auth,
                self.max_concurrent_ws_auth_per_caller,
            )
            < 1
            or self.request_window_seconds <= 0
        ):
            raise ValueError("admission bounds must be positive")
        try:
            networks = [ip_network(value, strict=False) for value in self.trusted_proxy_cidrs]
        except (TypeError, ValueError) as exc:
            raise ValueError("trusted proxy CIDRs must be valid IP networks") from exc
        if any(network.prefixlen == 0 for network in networks):
            raise ValueError("trusted proxy CIDRs must not cover every address")


class _SlidingWindow:
    def __init__(self, limit: int, window: float, clock: Callable[[], float]) -> None:
        self._limit = limit
        self._window = window
        self._clock = clock
        self._requests: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def admit(self) -> bool:
        async with self._lock:
            now = self._clock()
            while self._requests and self._requests[0] <= now - self._window:
                self._requests.popleft()
            if len(self._requests) >= self._limit:
                return False
            self._requests.append(now)
            return True


class _KeyedSlidingWindow:
    def __init__(
        self,
        limit: int,
        window: float,
        max_callers: int,
        clock: Callable[[], float],
    ) -> None:
        self._limit = limit
        self._window = window
        self._max_callers = max_callers
        self._clock = clock
        self._requests: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = asyncio.Lock()

    def _purge(self, now: float) -> None:
        for caller, requests in list(self._requests.items()):
            while requests and requests[0] <= now - self._window:
                requests.popleft()
            if not requests:
                self._requests.pop(caller, None)

    async def admit(self, caller: str) -> bool:
        async with self._lock:
            now = self._clock()
            requests = self._requests.get(caller)
            if requests is None:
                self._purge(now)
                if len(self._requests) >= self._max_callers:
                    return False
                requests = deque()
                self._requests[caller] = requests
            else:
                while requests and requests[0] <= now - self._window:
                    requests.popleft()
            if len(requests) >= self._limit:
                return False
            requests.append(now)
            self._requests.move_to_end(caller)
            return True

    async def refund(self, caller: str) -> None:
        async with self._lock:
            requests = self._requests.get(caller)
            if not requests:
                return
            requests.pop()
            if not requests:
                self._requests.pop(caller, None)


class _KeyedConcurrency:
    def __init__(self, limit: int) -> None:
        self._limit = limit
        self._active: dict[str, int] = {}
        self._lock = asyncio.Lock()

    async def acquire(self, caller: str) -> bool:
        async with self._lock:
            active = self._active.get(caller, 0)
            if active >= self._limit:
                return False
            self._active[caller] = active + 1
            return True

    async def release(self, caller: str) -> None:
        async with self._lock:
            active = self._active.get(caller, 0)
            if active <= 1:
                self._active.pop(caller, None)
            else:
                self._active[caller] = active - 1


@dataclass(slots=True)
class _TicketRefreshState:
    current_ticket: str
    pending_id: str | None = None
    pending_ticket: str | None = None
    acknowledged: asyncio.Event = field(default_factory=asyncio.Event)

    def begin(self, refresh_id: str, reconnect_ticket: str) -> None:
        self.pending_id = refresh_id
        self.pending_ticket = reconnect_ticket
        self.acknowledged.clear()

    def ticket_for(self, refresh_id: str) -> str | None:
        if self.pending_id is None or not secrets.compare_digest(self.pending_id, refresh_id):
            return None
        return self.pending_ticket

    def confirm(self) -> None:
        assert self.pending_ticket is not None
        self.current_ticket = self.pending_ticket
        self.pending_id = None
        self.pending_ticket = None
        self.acknowledged.set()


class AuthBackend(Protocol):
    application_id: str

    @property
    def ticket_ttl_seconds(self) -> int: ...

    async def begin(self, instance_id: object) -> tuple[str, object]: ...

    async def exchange(self, *, code: object, state: object) -> AuthExchange: ...

    def issue_ticket(self, player: AuthenticatedPlayer) -> str: ...

    def verify_ticket(self, ticket: object) -> AuthenticatedPlayer: ...

    def activate_ticket(self, ticket: object, player: AuthenticatedPlayer) -> None: ...

    async def close(self) -> None: ...


class RoomsBackend(Protocol):
    async def join(
        self,
        player: AuthenticatedPlayer,
        socket: web.WebSocketResponse,
        *,
        reconnect_ticket: str | None = None,
        reconnect_ticket_factory: Callable[[], str] | None = None,
    ) -> RoomMembership: ...

    async def leave(self, membership: RoomMembership) -> None: ...

    async def close(self) -> None: ...


@web.middleware
async def _security_middleware(
    request: web.Request,
    handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
) -> web.StreamResponse:
    try:
        response = await handler(request)
    except web.HTTPException as exc:
        for name, value in SECURITY_HEADERS.items():
            exc.headers.setdefault(name, value)
        raise
    except Exception as exc:
        logger.error(
            "Hands request failed",
            path=request.path,
            method=request.method,
            error_type=type(exc).__name__,
        )
        response = _json_response({"error": "internal_error"}, status=500)
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response


def _json_response(payload: Mapping[str, object], *, status: int = 200) -> web.Response:
    return web.json_response(
        payload,
        status=status,
        headers={"Cache-Control": "no-store"},
        dumps=lambda value: json.dumps(value, separators=(",", ":"), sort_keys=True),
    )


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate field")
        result[key] = value
    return result


def _strict_object(raw: bytes, *, fields: set[str]) -> dict[str, object]:
    if len(raw) > MAX_HTTP_BODY_BYTES:
        raise web.HTTPRequestEntityTooLarge(
            max_size=MAX_HTTP_BODY_BYTES, actual_size=len(raw), text="request too large"
        )
    try:
        value = json.loads(raw, object_pairs_hook=_unique_object)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
        raise web.HTTPBadRequest(text="invalid request") from exc
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise web.HTTPBadRequest(text="invalid request")
    if set(value) != fields:
        raise web.HTTPBadRequest(text="invalid request")
    return value


class HandsServer:
    def __init__(
        self,
        *,
        repository: Repository,
        application_id: str,
        guild_id: str,
        client_secret: str,
        bot_token: str,
        host: str,
        port: int,
        dev_mode: bool = False,
        auth: AuthBackend | None = None,
        rooms: RoomsBackend | None = None,
        http_client: httpx.AsyncClient | None = None,
        static_root: Traversable | None = None,
        auth_timeout_seconds: float = 5.0,
        ticket_refresh_seconds: float | None = None,
        ticket_sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        admission: AdmissionConfig | None = None,
        monotonic_clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if auth_timeout_seconds <= 0:
            raise ValueError("auth timeout must be positive")
        self.repository = repository
        self.application_id = application_id
        self.guild_id = guild_id
        self.host = host
        self.port = port
        self.bound_port: int | None = None
        self.dev_mode = dev_mode
        self.auth_timeout_seconds = auth_timeout_seconds
        ticket_ttl_seconds = (
            auth.ticket_ttl_seconds if auth is not None else DEFAULT_TICKET_TTL_SECONDS
        )
        refresh_seconds = (
            ticket_ttl_seconds / 2 if ticket_refresh_seconds is None else ticket_refresh_seconds
        )
        if (
            not math.isfinite(refresh_seconds)
            or refresh_seconds < 1.0
            or refresh_seconds >= ticket_ttl_seconds
        ):
            raise ValueError("ticket refresh must be finite and occur safely before expiry")
        self.ticket_refresh_seconds = refresh_seconds
        self._ticket_sleep = ticket_sleep
        self.auth: AuthBackend = auth or HandsAuth(
            application_id=application_id,
            guild_id=guild_id,
            client_secret=client_secret,
            bot_token=bot_token,
            client=http_client,
        )
        self.rooms: RoomsBackend = rooms or HandsRoomManager(repository)
        self.static_root = static_root or resources.files("intelstream.hands").joinpath("static")
        bounds = admission or AdmissionConfig()
        self._trusted_proxy_networks = tuple(
            ip_network(value, strict=False) for value in bounds.trusted_proxy_cidrs
        )
        self._bootstrap_limit = _SlidingWindow(
            bounds.request_limit, bounds.request_window_seconds, monotonic_clock
        )
        self._bootstrap_caller_limit = _KeyedSlidingWindow(
            bounds.per_caller_request_limit,
            bounds.request_window_seconds,
            bounds.max_tracked_callers,
            monotonic_clock,
        )
        self._token_limit = _SlidingWindow(
            bounds.request_limit, bounds.request_window_seconds, monotonic_clock
        )
        self._token_caller_limit = _KeyedSlidingWindow(
            bounds.per_caller_request_limit,
            bounds.request_window_seconds,
            bounds.max_tracked_callers,
            monotonic_clock,
        )
        self._upstream_slots = asyncio.Semaphore(bounds.max_concurrent_upstream)
        self._upstream_caller_slots = _KeyedConcurrency(bounds.max_concurrent_upstream_per_caller)
        self._ws_auth_slots = asyncio.Semaphore(bounds.max_concurrent_ws_auth)
        self._ws_auth_caller_slots = _KeyedConcurrency(bounds.max_concurrent_ws_auth_per_caller)
        self._app = web.Application(
            client_max_size=MAX_HTTP_BODY_BYTES,
            middlewares=[_security_middleware],
        )
        self._app.add_routes(
            [
                web.get("/healthz", self._health),
                web.post("/api/hands/bootstrap", self._bootstrap),
                web.post("/api/hands/token", self._token),
                web.get("/api/hands/ws", self._websocket),
                web.get("/", self._index),
                web.get("/{path:.*}", self._static),
            ]
        )
        self._runner: web.AppRunner | None = None
        self._site: web.TCPSite | None = None
        self._closed = False
        self._started = False
        self._lifecycle_lock = asyncio.Lock()
        self._close_task: asyncio.Task[None] | None = None

    @property
    def running(self) -> bool:
        return self._started and self._close_task is None and not self._closed

    async def start(self) -> None:
        async with self._lifecycle_lock:
            if self._started:
                return
            if self._closed or self._close_task is not None:
                raise RuntimeError("Hands server has been closed")
            runner = web.AppRunner(self._app, access_log=None)
            await runner.setup()
            site = web.TCPSite(runner, self.host, self.port)
            try:
                await site.start()
            except BaseException:
                await runner.cleanup()
                raise
            self._runner = runner
            self._site = site
            addresses = runner.addresses
            if addresses and isinstance(addresses[0], tuple) and len(addresses[0]) >= 2:
                self.bound_port = int(addresses[0][1])
            else:
                self.bound_port = self.port
            self._started = True
            logger.info(
                "Hands server started",
                host=self.host,
                port=self.bound_port,
                dev_mode=self.dev_mode,
            )

    async def close(self) -> None:
        async with self._lifecycle_lock:
            if self._close_task is None:
                self._started = False
                self._close_task = asyncio.create_task(
                    self._close_resources(), name="hands-server-close"
                )
            close_task = self._close_task
        await asyncio.shield(close_task)

    async def _close_resources(self) -> None:
        site = self._site
        runner = self._runner
        self._site = None
        self._runner = None
        failures: list[BaseException] = []
        operations: list[Awaitable[object]] = []
        if site is not None:
            operations.append(site.stop())
        operations.extend((self.rooms.close(), self.auth.close()))
        if runner is not None:
            operations.append(runner.cleanup())
        for operation in operations:
            try:
                await operation
            except BaseException as exc:
                failures.append(exc)
        self._closed = True
        logger.info("Hands server stopped")
        if failures:
            raise failures[0]

    def _require_origin(self, request: web.Request) -> None:
        origin = request.headers.get("Origin")
        expected = f"https://{self.application_id}.discordsays.com"
        if origin == expected:
            return
        if self.dev_mode and origin is not None:
            parsed = urlsplit(origin)
            if (
                parsed.scheme in {"http", "https"}
                and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
                and parsed.username is None
                and parsed.password is None
                and parsed.path == ""
                and parsed.query == ""
                and parsed.fragment == ""
            ):
                return
        raise web.HTTPForbidden(text="origin not allowed")

    def _caller_key(self, request: web.Request) -> str:
        remote = request.remote
        try:
            peer = ip_address(remote) if remote is not None else None
        except ValueError:
            peer = None
        if peer is None or not self._is_trusted_proxy(peer):
            return peer.compressed if peer is not None else "unknown"
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded is None:
            return peer.compressed
        if len(forwarded) > 1024:
            raise web.HTTPBadRequest(text="invalid forwarded client chain")
        parts = [part.strip() for part in forwarded.split(",")]
        if not parts or len(parts) > 16 or any(not part for part in parts):
            raise web.HTTPBadRequest(text="invalid forwarded client chain")
        try:
            chain = [ip_address(part) for part in parts]
        except ValueError as exc:
            raise web.HTTPBadRequest(text="invalid forwarded client chain") from exc
        for address in reversed([*chain, peer]):
            if not self._is_trusted_proxy(address):
                return address.compressed
        return chain[0].compressed

    def _is_trusted_proxy(self, address: IPv4Address | IPv6Address) -> bool:
        return any(address in network for network in self._trusted_proxy_networks)

    @staticmethod
    async def _try_acquire(semaphore: asyncio.Semaphore) -> bool:
        if semaphore.locked():
            return False
        await semaphore.acquire()
        return True

    @staticmethod
    async def _admit_scoped(
        global_limit: _SlidingWindow,
        caller_limit: _KeyedSlidingWindow,
        caller: str,
    ) -> bool:
        if not await caller_limit.admit(caller):
            return False
        if await global_limit.admit():
            return True
        await caller_limit.refund(caller)
        return False

    @staticmethod
    async def _try_acquire_scoped(
        global_slots: asyncio.Semaphore,
        caller_slots: _KeyedConcurrency,
        caller: str,
    ) -> bool:
        if not await caller_slots.acquire(caller):
            return False
        if await HandsServer._try_acquire(global_slots):
            return True
        await caller_slots.release(caller)
        return False

    @staticmethod
    async def _release_scoped(
        global_slots: asyncio.Semaphore,
        caller_slots: _KeyedConcurrency,
        caller: str,
    ) -> None:
        global_slots.release()
        await caller_slots.release(caller)

    async def _health(self, _request: web.Request) -> web.Response:
        return web.json_response({"status": "ok"}, headers={"Cache-Control": "no-store"})

    async def _bootstrap(self, request: web.Request) -> web.Response:
        self._require_origin(request)
        caller = self._caller_key(request)
        if not await self._admit_scoped(
            self._bootstrap_limit, self._bootstrap_caller_limit, caller
        ):
            return _json_response({"error": "rate_limited"}, status=429)
        if request.content_type != "application/json":
            raise web.HTTPUnsupportedMediaType(text="application/json required")
        payload = _strict_object(await request.read(), fields={"instance_id"})
        if not await self._try_acquire_scoped(
            self._upstream_slots, self._upstream_caller_slots, caller
        ):
            return _json_response({"error": "service_busy"}, status=503)
        try:
            state, _activity = await self.auth.begin(payload["instance_id"])
        except HandsAuthError as exc:
            logger.warning("Hands OAuth bootstrap rejected", code=exc.code)
            status = 503 if exc.code == "service_busy" else 401
            return _json_response({"error": exc.code}, status=status)
        finally:
            await self._release_scoped(self._upstream_slots, self._upstream_caller_slots, caller)
        logger.info("Hands OAuth bootstrap completed")
        return _json_response(
            {
                "client_id": self.application_id,
                "state": state,
                "protocol": PROTOCOL_VERSION,
                "simulation": {
                    "tick_rate": TICKS_PER_SECOND,
                    "ring_half_width": RING_HALF_WIDTH,
                    "ring_half_height": RING_HALF_HEIGHT,
                },
            }
        )

    async def _token(self, request: web.Request) -> web.Response:
        self._require_origin(request)
        caller = self._caller_key(request)
        if not await self._admit_scoped(self._token_limit, self._token_caller_limit, caller):
            return _json_response({"error": "rate_limited"}, status=429)
        if request.content_type != "application/json":
            raise web.HTTPUnsupportedMediaType(text="application/json required")
        payload = _strict_object(await request.read(), fields={"code", "state"})
        logger.info("Hands OAuth token request received")
        if not await self._try_acquire_scoped(
            self._upstream_slots, self._upstream_caller_slots, caller
        ):
            return _json_response({"error": "service_busy"}, status=503)
        try:
            exchange = await self.auth.exchange(code=payload["code"], state=payload["state"])
            rating = await self.repository.get_or_create_hands_rating(
                exchange.player.guild_id, exchange.player.user_id
            )
        except HandsAuthError as exc:
            logger.warning("Hands OAuth exchange rejected", code=exc.code)
            status = 503 if exc.code == "service_busy" else 401
            return _json_response({"error": exc.code}, status=status)
        finally:
            await self._release_scoped(self._upstream_slots, self._upstream_caller_slots, caller)
        logger.info(
            "Hands OAuth exchange completed",
            guild_id=exchange.player.guild_id,
            user_id=exchange.player.user_id,
        )
        return _json_response(
            {
                "access_token": exchange.access_token,
                "ticket": exchange.ticket,
                "player": {
                    "id": exchange.player.user_id,
                    "name": exchange.player.display_name,
                    "avatar": exchange.player.avatar_hash,
                    "rating": rating.rating,
                },
            }
        )

    async def _websocket(self, request: web.Request) -> web.StreamResponse:
        self._require_origin(request)
        if request.query:
            raise web.HTTPBadRequest(text="WebSocket query parameters are not allowed")
        caller = self._caller_key(request)
        if not await self._try_acquire_scoped(
            self._ws_auth_slots, self._ws_auth_caller_slots, caller
        ):
            return _json_response({"error": "service_busy"}, status=503)
        websocket = web.WebSocketResponse(
            autoping=True,
            heartbeat=15.0,
            max_msg_size=MAX_FRAME_BYTES,
            compress=False,
        )
        try:
            await websocket.prepare(request)
        except BaseException:
            await self._release_scoped(self._ws_auth_slots, self._ws_auth_caller_slots, caller)
            raise
        membership: RoomMembership | None = None
        ticket_refresh_state: _TicketRefreshState | None = None
        ticket_refresh_task: asyncio.Task[None] | None = None
        try:
            try:
                async with asyncio.timeout(self.auth_timeout_seconds):
                    first = await websocket.receive()
                    if first.type not in (WSMsgType.TEXT, WSMsgType.BINARY):
                        raise HandsAuthError("authentication_required")
                    encoded = first.data.encode() if isinstance(first.data, str) else first.data
                    if not isinstance(encoded, bytes) or len(encoded) > MAX_AUTH_FRAME_BYTES:
                        raise HandsAuthError("authentication_required")
                    payload = _strict_object(encoded, fields={"version", "type", "ticket"})
                    if payload["version"] != PROTOCOL_VERSION or payload["type"] != "authenticate":
                        raise HandsAuthError("invalid_ticket")
                    player = self.auth.verify_ticket(payload["ticket"])
            except TimeoutError:
                await self._ws_error(websocket, "authentication_timeout", close_code=4003)
                return websocket
            except HandsAuthError as exc:
                await self._ws_error(websocket, exc.code, close_code=4003)
                return websocket
            except web.HTTPException:
                await self._ws_error(websocket, "invalid_request", close_code=4004)
                return websocket
            finally:
                await self._release_scoped(self._ws_auth_slots, self._ws_auth_caller_slots, caller)

            try:
                membership = await self.rooms.join(
                    player,
                    websocket,
                    reconnect_ticket_factory=lambda: self.auth.issue_ticket(player),
                )
            except (HandsAuthError, RoomError) as exc:
                close_code = 4003 if isinstance(exc, HandsAuthError) else 4004
                await self._ws_error(websocket, exc.code, close_code=close_code)
                return websocket
            if membership.reconnect_ticket is None:
                raise RuntimeError("room did not issue a reconnect ticket")
            ticket_refresh_state = _TicketRefreshState(membership.reconnect_ticket)
            ticket_refresh_task = asyncio.create_task(
                self._refresh_reconnect_ticket(player, membership, ticket_refresh_state),
                name=f"hands-ticket-refresh-{player.user_id}",
            )
            async for message in websocket:
                if message.type in (WSMsgType.TEXT, WSMsgType.BINARY):
                    try:
                        refresh_id = parse_ticket_ack(message.data)
                        if refresh_id is not None:
                            reconnect_ticket = ticket_refresh_state.ticket_for(refresh_id)
                            if reconnect_ticket is None:
                                raise ProtocolError("invalid ticket acknowledgement")
                            self.auth.activate_ticket(reconnect_ticket, player)
                            ticket_refresh_state.confirm()
                            continue
                        if membership.role == "spectator":
                            raise RoomError("spectator_read_only")
                        await membership.room.submit_frame(
                            membership.player_id,
                            membership.connection,
                            message.data,
                        )
                    except ProtocolError:
                        await self._ws_error(websocket, "invalid_input", close_code=4008)
                        break
                    except HandsAuthError as exc:
                        await self._ws_error(websocket, exc.code, close_code=4003)
                        break
                    except RoomError as exc:
                        await self._ws_error(websocket, exc.code, close_code=4008)
                        break
                elif message.type in (WSMsgType.ERROR, WSMsgType.CLOSE, WSMsgType.CLOSED):
                    break
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Hands WebSocket failed", error_type=type(exc).__name__)
            await self._ws_error(websocket, "internal_error", close_code=1011)
        finally:
            if ticket_refresh_task is not None:
                ticket_refresh_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await ticket_refresh_task
            if membership is not None:
                try:
                    await self.rooms.leave(membership)
                except Exception as exc:
                    logger.error("Hands WebSocket leave failed", error_type=type(exc).__name__)
        return websocket

    async def _refresh_reconnect_ticket(
        self,
        player: AuthenticatedPlayer,
        membership: RoomMembership,
        state: _TicketRefreshState,
    ) -> None:
        try:
            while True:
                await self._ticket_sleep(self.ticket_refresh_seconds)
                reconnect_ticket = self.auth.issue_ticket(player)
                refresh_id = secrets.token_urlsafe(16)
                state.begin(refresh_id, reconnect_ticket)
                await membership.room.refresh_ticket(
                    membership.player_id,
                    membership.connection,
                    reconnect_ticket,
                    refresh_id,
                )
                await state.acknowledged.wait()
        except asyncio.CancelledError:
            raise
        except (HandsAuthError, RoomError):
            return
        except Exception as exc:
            logger.error("Hands ticket refresh failed", error_type=type(exc).__name__)

    @staticmethod
    async def _ws_error(websocket: web.WebSocketResponse, code: str, *, close_code: int) -> None:
        if not websocket.closed:
            with contextlib.suppress(ConnectionError, RuntimeError):
                await websocket.send_str(
                    json.dumps(
                        {"version": PROTOCOL_VERSION, "type": "error", "code": code},
                        separators=(",", ":"),
                        sort_keys=True,
                    )
                )
                await websocket.close(code=close_code, message=code.encode()[:120])

    async def _index(self, _request: web.Request) -> web.Response:
        return self._static_response("index.html")

    async def _static(self, request: web.Request) -> web.Response:
        path = request.match_info.get("path", "")
        return self._static_response(path)

    def _static_response(self, raw_path: str) -> web.Response:
        if not raw_path or len(raw_path) > 512 or "\\" in raw_path:
            raise web.HTTPNotFound()
        path = PurePosixPath(raw_path)
        if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
            raise web.HTTPNotFound()
        resource: Traversable = self.static_root
        for part in path.parts:
            resource = resource.joinpath(part)
        if not resource.is_file():
            raise web.HTTPNotFound()
        content_type, _encoding = mimetypes.guess_type(path.name)
        response = web.Response(
            body=resource.read_bytes(),
            content_type=content_type or "application/octet-stream",
        )
        if path.name == "index.html":
            response.headers["Cache-Control"] = "no-store"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response
