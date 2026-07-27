from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable

import httpx

MAX_INSTANCE_ID_LENGTH = 255
MAX_CODE_LENGTH = 2048
MAX_STATE_LENGTH = 128
MAX_DISPLAY_NAME_LENGTH = 80
MAX_AVATAR_HASH_LENGTH = 128
SNOWFLAKE_RE = re.compile(r"^[0-9]{1,36}$")
INSTANCE_RE = re.compile(r"^[A-Za-z0-9_-]{1,255}$")
AVATAR_RE = re.compile(r"^[A-Za-z0-9_]+$")


class HandsAuthError(Exception):
    """A safe authentication failure whose message may be returned to a client."""

    def __init__(self, code: str = "authentication_failed") -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class ActivityInstance:
    instance_id: str
    guild_id: str
    channel_id: str
    users: frozenset[str]


@dataclass(frozen=True, slots=True)
class AuthenticatedPlayer:
    user_id: str
    guild_id: str
    instance_id: str
    display_name: str
    avatar_hash: str | None


@dataclass(frozen=True, slots=True)
class AuthExchange:
    access_token: str
    ticket: str
    player: AuthenticatedPlayer


@dataclass(frozen=True, slots=True)
class _OAuthState:
    instance_id: str
    guild_id: str
    expires_at: float


@dataclass(frozen=True, slots=True)
class _ConsumedTicket:
    expires_at: int
    player_instance: tuple[str, str]


def validate_instance_id(value: object) -> str:
    if not isinstance(value, str) or not INSTANCE_RE.fullmatch(value):
        raise HandsAuthError("invalid_request")
    return value


def _bounded_string(value: object, *, maximum: int) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = "".join(character for character in value if character >= " " and character != "\x7f")
    return cleaned.strip()[:maximum]


def _json_object(response: httpx.Response) -> dict[str, Any]:
    try:
        value = response.json()
    except (ValueError, UnicodeDecodeError) as exc:
        raise HandsAuthError() from exc
    if not isinstance(value, dict):
        raise HandsAuthError()
    return value


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding)
    except (ValueError, UnicodeEncodeError) as exc:
        raise HandsAuthError() from exc


class HandsAuth:
    def __init__(
        self,
        *,
        application_id: str,
        guild_id: str,
        client_secret: str,
        bot_token: str,
        client: httpx.AsyncClient | None = None,
        close_client: bool = False,
        api_base: str = "https://discord.com/api/v10",
        monotonic_clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
        state_ttl_seconds: float = 180.0,
        ticket_ttl_seconds: int = 300,
        max_states: int = 1024,
        max_consumed_tickets: int = 4096,
        max_consumed_tickets_per_player_instance: int = 64,
        ticket_secret: bytes | None = None,
    ) -> None:
        if not SNOWFLAKE_RE.fullmatch(application_id) or not SNOWFLAKE_RE.fullmatch(guild_id):
            raise ValueError("application_id and guild_id must be Discord snowflakes")
        if not client_secret or not bot_token:
            raise ValueError("Discord credentials must be nonblank")
        if (
            state_ttl_seconds <= 0
            or ticket_ttl_seconds <= 0
            or max_states < 1
            or max_consumed_tickets < 1
            or max_consumed_tickets_per_player_instance < 1
        ):
            raise ValueError("authentication bounds must be positive")
        self.application_id = application_id
        self.guild_id = guild_id
        self._client_secret = client_secret
        self._bot_token = bot_token
        self._monotonic = monotonic_clock
        self._wall = wall_clock
        self._state_ttl = state_ttl_seconds
        self._ticket_ttl = ticket_ttl_seconds
        self._max_states = max_states
        self._max_consumed_tickets = max_consumed_tickets
        self._max_consumed_tickets_per_player_instance = max_consumed_tickets_per_player_instance
        self._states: dict[str, _OAuthState] = {}
        self._state_lock = asyncio.Lock()
        self._consumed_tickets: dict[str, _ConsumedTicket] = {}
        self._consumed_ticket_counts: dict[tuple[str, str], int] = {}
        self._ticket_secret = ticket_secret or secrets.token_bytes(32)
        self._owns_client = client is None or close_client
        self._client = client or httpx.AsyncClient(
            base_url=api_base.rstrip("/"),
            timeout=httpx.Timeout(5.0),
            follow_redirects=False,
        )
        self._closed = False

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        async with self._state_lock:
            self._states.clear()
        self._consumed_tickets.clear()
        self._consumed_ticket_counts.clear()
        if self._owns_client:
            await self._client.aclose()

    def _ensure_open(self) -> None:
        if self._closed:
            raise HandsAuthError("service_unavailable")

    def _purge_states(self) -> None:
        now = self._monotonic()
        expired = [state for state, record in self._states.items() if record.expires_at <= now]
        for state in expired:
            self._states.pop(state, None)

    async def begin(self, instance_id: object) -> tuple[str, ActivityInstance]:
        self._ensure_open()
        instance = validate_instance_id(instance_id)
        state = secrets.token_urlsafe(32)
        async with self._state_lock:
            self._purge_states()
            if len(self._states) >= self._max_states:
                raise HandsAuthError("service_busy")
            self._states[state] = _OAuthState(
                instance_id=instance,
                guild_id=self.guild_id,
                expires_at=self._monotonic() + self._state_ttl,
            )
        try:
            validated = await self._fetch_activity_instance(instance)
        except BaseException:
            async with self._state_lock:
                self._states.pop(state, None)
            raise
        async with self._state_lock:
            if self._closed:
                self._states.pop(state, None)
                raise HandsAuthError("service_unavailable")
        return state, validated

    async def exchange(self, *, code: object, state: object) -> AuthExchange:
        self._ensure_open()
        if not isinstance(code, str) or not 1 <= len(code) <= MAX_CODE_LENGTH:
            raise HandsAuthError("invalid_request")
        if not isinstance(state, str) or not 1 <= len(state) <= MAX_STATE_LENGTH:
            raise HandsAuthError("invalid_request")
        async with self._state_lock:
            self._purge_states()
            record = self._states.pop(state, None)
            if record is None or record.expires_at <= self._monotonic():
                raise HandsAuthError("invalid_state")

        token = await self._exchange_code(code)
        user = await self._fetch_bearer("/users/@me", token)
        user_id = user.get("id")
        if not isinstance(user_id, str) or not SNOWFLAKE_RE.fullmatch(user_id):
            raise HandsAuthError()
        member = await self._fetch_bearer(
            f"/users/@me/guilds/{record.guild_id}/member",
            token,
        )
        activity = await self._fetch_activity_instance(record.instance_id)
        if user_id not in activity.users:
            raise HandsAuthError("not_in_activity")

        member_user = member.get("user")
        canonical_member_user = member_user if isinstance(member_user, dict) else {}
        if canonical_member_user.get("id") not in (None, user_id):
            raise HandsAuthError()
        nickname = _bounded_string(member.get("nick"), maximum=MAX_DISPLAY_NAME_LENGTH)
        global_name = _bounded_string(user.get("global_name"), maximum=MAX_DISPLAY_NAME_LENGTH)
        username = _bounded_string(user.get("username"), maximum=MAX_DISPLAY_NAME_LENGTH)
        display_name = nickname or global_name or username or f"Member {user_id[-6:]}"
        avatar_value = user.get("avatar")
        avatar_hash = (
            avatar_value[:MAX_AVATAR_HASH_LENGTH]
            if isinstance(avatar_value, str)
            and 1 <= len(avatar_value) <= MAX_AVATAR_HASH_LENGTH
            and AVATAR_RE.fullmatch(avatar_value)
            else None
        )
        player = AuthenticatedPlayer(
            user_id=user_id,
            guild_id=record.guild_id,
            instance_id=record.instance_id,
            display_name=display_name,
            avatar_hash=avatar_hash,
        )
        return AuthExchange(access_token=token, ticket=self.issue_ticket(player), player=player)

    async def _exchange_code(self, code: str) -> str:
        try:
            response = await self._client.post(
                "/oauth2/token",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "client_id": self.application_id,
                    "client_secret": self._client_secret,
                    "grant_type": "authorization_code",
                    "code": code,
                },
            )
        except httpx.HTTPError as exc:
            raise HandsAuthError("upstream_unavailable") from exc
        if response.status_code != 200:
            raise HandsAuthError()
        payload = _json_object(response)
        token = payload.get("access_token")
        if not isinstance(token, str) or not 1 <= len(token) <= 4096:
            raise HandsAuthError()
        return token

    async def _fetch_bearer(self, path: str, token: str) -> dict[str, Any]:
        try:
            response = await self._client.get(path, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:
            raise HandsAuthError("upstream_unavailable") from exc
        if response.status_code != 200:
            raise HandsAuthError()
        return _json_object(response)

    async def _fetch_activity_instance(self, instance_id: str) -> ActivityInstance:
        try:
            response = await self._client.get(
                f"/applications/{self.application_id}/activity-instances/{instance_id}",
                headers={"Authorization": f"Bot {self._bot_token}"},
            )
        except httpx.HTTPError as exc:
            raise HandsAuthError("upstream_unavailable") from exc
        if response.status_code != 200:
            raise HandsAuthError("invalid_activity")
        payload = _json_object(response)
        location = payload.get("location")
        users = payload.get("users")
        if not isinstance(location, dict) or not isinstance(users, list):
            raise HandsAuthError("invalid_activity")
        application_id = payload.get("application_id")
        returned_instance = payload.get("instance_id")
        guild_id = location.get("guild_id")
        channel_id = location.get("channel_id")
        kind = location.get("kind")
        if (
            application_id != self.application_id
            or returned_instance != instance_id
            or guild_id != self.guild_id
            or kind != "gc"
            or not isinstance(channel_id, str)
            or not SNOWFLAKE_RE.fullmatch(channel_id)
        ):
            raise HandsAuthError("invalid_activity")
        canonical_users = frozenset(
            user for user in users if isinstance(user, str) and SNOWFLAKE_RE.fullmatch(user)
        )
        if len(canonical_users) != len(users):
            raise HandsAuthError("invalid_activity")
        return ActivityInstance(instance_id, guild_id, channel_id, canonical_users)

    def issue_ticket(self, player: AuthenticatedPlayer) -> str:
        self._ensure_open()
        now = int(self._wall())
        payload = {
            "v": 1,
            "sub": player.user_id,
            "guild": player.guild_id,
            "instance": player.instance_id,
            "name": player.display_name,
            "avatar": player.avatar_hash,
            "nonce": secrets.token_urlsafe(12),
            "iat": now,
            "exp": now + self._ticket_ttl,
        }
        encoded = _b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
        signature = _b64encode(hmac.digest(self._ticket_secret, encoded.encode(), "sha256"))
        return f"{encoded}.{signature}"

    def verify_ticket(self, ticket: object) -> AuthenticatedPlayer:
        self._ensure_open()
        if not isinstance(ticket, str) or not 1 <= len(ticket) <= 4096 or ticket.count(".") != 1:
            raise HandsAuthError("invalid_ticket")
        encoded, supplied_signature = ticket.split(".", 1)
        expected_signature = _b64encode(
            hmac.digest(self._ticket_secret, encoded.encode(), hashlib.sha256)
        )
        if not hmac.compare_digest(supplied_signature, expected_signature):
            raise HandsAuthError("invalid_ticket")
        try:
            payload = json.loads(_b64decode(encoded))
        except (json.JSONDecodeError, UnicodeDecodeError, HandsAuthError) as exc:
            raise HandsAuthError("invalid_ticket") from exc
        if not isinstance(payload, dict) or set(payload) != {
            "v",
            "sub",
            "guild",
            "instance",
            "name",
            "avatar",
            "nonce",
            "iat",
            "exp",
        }:
            raise HandsAuthError("invalid_ticket")
        now = int(self._wall())
        issued = payload.get("iat")
        expires = payload.get("exp")
        if (
            payload.get("v") != 1
            or not isinstance(issued, int)
            or isinstance(issued, bool)
            or not isinstance(expires, int)
            or isinstance(expires, bool)
            or issued > now + 30
            or expires <= now
            or expires - issued > self._ticket_ttl
            or payload.get("guild") != self.guild_id
        ):
            raise HandsAuthError("invalid_ticket")
        user_id = payload.get("sub")
        instance_id = payload.get("instance")
        nonce = payload.get("nonce")
        if (
            not isinstance(user_id, str)
            or not SNOWFLAKE_RE.fullmatch(user_id)
            or not isinstance(instance_id, str)
            or not INSTANCE_RE.fullmatch(instance_id)
            or not isinstance(nonce, str)
            or not 8 <= len(nonce) <= 64
        ):
            raise HandsAuthError("invalid_ticket")
        name = _bounded_string(payload.get("name"), maximum=MAX_DISPLAY_NAME_LENGTH)
        if not name:
            raise HandsAuthError("invalid_ticket")
        avatar = payload.get("avatar")
        if avatar is not None and (
            not isinstance(avatar, str)
            or len(avatar) > MAX_AVATAR_HASH_LENGTH
            or not AVATAR_RE.fullmatch(avatar)
        ):
            raise HandsAuthError("invalid_ticket")
        self._purge_consumed_tickets(now)
        if nonce in self._consumed_tickets:
            raise HandsAuthError("invalid_ticket")
        player_instance = (user_id, instance_id)
        if (
            self._consumed_ticket_counts.get(player_instance, 0)
            >= self._max_consumed_tickets_per_player_instance
        ):
            raise HandsAuthError("rate_limited")
        if len(self._consumed_tickets) >= self._max_consumed_tickets:
            raise HandsAuthError("service_busy")
        self._consumed_tickets[nonce] = _ConsumedTicket(expires, player_instance)
        self._consumed_ticket_counts[player_instance] = (
            self._consumed_ticket_counts.get(player_instance, 0) + 1
        )
        return AuthenticatedPlayer(user_id, self.guild_id, instance_id, name, avatar)

    def _purge_consumed_tickets(self, now: int) -> None:
        expired = [
            nonce
            for nonce, consumed in self._consumed_tickets.items()
            if consumed.expires_at <= now
        ]
        for nonce in expired:
            consumed = self._consumed_tickets.pop(nonce)
            remaining = self._consumed_ticket_counts[consumed.player_instance] - 1
            if remaining:
                self._consumed_ticket_counts[consumed.player_instance] = remaining
            else:
                self._consumed_ticket_counts.pop(consumed.player_instance)
