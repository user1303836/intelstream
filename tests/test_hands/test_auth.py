from __future__ import annotations

import asyncio
from dataclasses import replace
from urllib.parse import parse_qs

import httpx
import pytest

from intelstream.hands.auth import AuthenticatedPlayer, HandsAuth, HandsAuthError

APP = "123456789"
GUILD = "987654321"
CHANNEL = "456789123"
USER = "111222333"
INSTANCE = "i-valid-instance"


class Clock:
    def __init__(self, value: float = 1000.0) -> None:
        self.value = value

    def __call__(self) -> float:
        return self.value


def discord_handler(
    request: httpx.Request,
    *,
    activity_overrides: dict[str, object] | None = None,
    user_overrides: dict[str, object] | None = None,
    member_status: int = 200,
    token_status: int = 200,
) -> httpx.Response:
    path = request.url.path
    if path == "/api/v10/oauth2/token":
        assert request.url.query == b""
        form = parse_qs(request.content.decode())
        assert form["client_id"] == [APP]
        assert form["client_secret"] == ["client-secret"]
        assert form["code"] == ["sdk-code"]
        return httpx.Response(token_status, json={"access_token": "trusted-access"})
    if path == "/api/v10/users/@me":
        assert request.headers["authorization"] == "Bearer trusted-access"
        payload: dict[str, object] = {
            "id": USER,
            "username": "Canonical",
            "global_name": "Global Name",
            "avatar": "avatar_hash",
        }
        payload.update(user_overrides or {})
        return httpx.Response(200, json=payload)
    if path == f"/api/v10/users/@me/guilds/{GUILD}/member":
        return httpx.Response(member_status, json={"nick": " Ring\x00 Name ", "user": {"id": USER}})
    if path == f"/api/v10/applications/{APP}/activity-instances/{INSTANCE}":
        assert request.headers["authorization"] == "Bot bot-token"
        payload = {
            "application_id": APP,
            "instance_id": INSTANCE,
            "location": {
                "kind": "gc",
                "guild_id": GUILD,
                "channel_id": CHANNEL,
            },
            "users": [USER],
        }
        payload.update(activity_overrides or {})
        return httpx.Response(200, json=payload)
    return httpx.Response(404, json={})


def make_auth(
    monotonic: Clock,
    wall: Clock,
    *,
    handler=discord_handler,
    max_states: int = 8,
    max_consumed_tickets: int = 32,
    max_consumed_tickets_per_player_instance: int = 8,
) -> HandsAuth:
    client = httpx.AsyncClient(
        base_url="https://discord.test/api/v10",
        transport=httpx.MockTransport(handler),
    )
    return HandsAuth(
        application_id=APP,
        guild_id=GUILD,
        client_secret="client-secret",
        bot_token="bot-token",
        client=client,
        close_client=True,
        monotonic_clock=monotonic,
        wall_clock=wall,
        state_ttl_seconds=10,
        ticket_ttl_seconds=30,
        max_states=max_states,
        max_consumed_tickets=max_consumed_tickets,
        max_consumed_tickets_per_player_instance=(max_consumed_tickets_per_player_instance),
        ticket_secret=b"x" * 32,
    )


async def test_trusted_exchange_uses_canonical_discord_data_and_one_use_ticket() -> None:
    monotonic = Clock()
    wall = Clock(5000)
    auth = make_auth(monotonic, wall)

    state, activity = await auth.begin(INSTANCE)
    exchange = await auth.exchange(code="sdk-code", state=state)

    assert activity.instance_id == INSTANCE
    assert activity.guild_id == GUILD
    assert exchange.access_token == "trusted-access"
    assert auth.ticket_ttl_seconds == 30
    assert exchange.player == AuthenticatedPlayer(
        user_id=USER,
        guild_id=GUILD,
        instance_id=INSTANCE,
        display_name="Ring Name",
        avatar_hash="avatar_hash",
    )
    assert auth.verify_ticket(exchange.ticket) == exchange.player
    with pytest.raises(HandsAuthError, match="invalid_ticket"):
        auth.verify_ticket(exchange.ticket)
    await auth.close()
    await auth.close()


async def test_state_capacity_is_reserved_before_concurrent_upstream_fetch() -> None:
    monotonic = Clock()
    wall = Clock()
    entered = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        if "/activity-instances/" in request.url.path:
            calls += 1
            entered.set()
            await release.wait()
        return discord_handler(request)

    auth = make_auth(monotonic, wall, handler=handler, max_states=1)
    first = asyncio.create_task(auth.begin(INSTANCE))
    await entered.wait()
    with pytest.raises(HandsAuthError, match="service_busy"):
        await auth.begin(INSTANCE)
    assert calls == 1
    release.set()
    await first
    await auth.close()


async def test_failed_activity_validation_releases_reserved_state() -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(404, json={})

    auth = make_auth(Clock(), Clock(), handler=handler, max_states=1)
    for _ in range(2):
        with pytest.raises(HandsAuthError, match="invalid_activity"):
            await auth.begin(INSTANCE)
    assert calls == 2
    await auth.close()


async def test_state_is_one_use_expiring_bounded_and_instance_bound() -> None:
    monotonic = Clock()
    wall = Clock()
    auth = make_auth(monotonic, wall, max_states=1)
    state, _ = await auth.begin(INSTANCE)

    with pytest.raises(HandsAuthError, match="service_busy"):
        await auth.begin(INSTANCE)

    await auth.exchange(code="sdk-code", state=state)
    with pytest.raises(HandsAuthError, match="invalid_state"):
        await auth.exchange(code="sdk-code", state=state)

    state, _ = await auth.begin(INSTANCE)
    monotonic.value += 11
    with pytest.raises(HandsAuthError, match="invalid_state"):
        await auth.exchange(code="sdk-code", state=state)
    await auth.close()


@pytest.mark.parametrize(
    "overrides",
    [
        {"application_id": "999"},
        {"instance_id": "different"},
        {"location": {"kind": "pc", "guild_id": GUILD, "channel_id": CHANNEL}},
        {"location": {"kind": "gc", "guild_id": "999", "channel_id": CHANNEL}},
        {"users": ["not-a-snowflake"]},
    ],
)
async def test_rejects_mismatched_or_malformed_activity(overrides: dict[str, object]) -> None:
    monotonic = Clock()
    wall = Clock()

    def handler(request: httpx.Request) -> httpx.Response:
        return discord_handler(request, activity_overrides=overrides)

    auth = make_auth(monotonic, wall, handler=handler)
    with pytest.raises(HandsAuthError, match="invalid_activity"):
        await auth.begin(INSTANCE)
    await auth.close()


async def test_rejects_user_absent_from_instance_and_member_failure() -> None:
    monotonic = Clock()
    wall = Clock()

    def absent(request: httpx.Request) -> httpx.Response:
        return discord_handler(request, activity_overrides={"users": []})

    auth = make_auth(monotonic, wall, handler=absent)
    state, _ = await auth.begin(INSTANCE)
    with pytest.raises(HandsAuthError, match="not_in_activity"):
        await auth.exchange(code="sdk-code", state=state)
    await auth.close()

    def no_member(request: httpx.Request) -> httpx.Response:
        return discord_handler(request, member_status=404)

    auth = make_auth(monotonic, wall, handler=no_member)
    state, _ = await auth.begin(INSTANCE)
    with pytest.raises(HandsAuthError, match="authentication_failed"):
        await auth.exchange(code="sdk-code", state=state)
    await auth.close()


async def test_rejected_code_timeout_and_malformed_upstream_are_generic() -> None:
    monotonic = Clock()
    wall = Clock()

    def rejected(request: httpx.Request) -> httpx.Response:
        return discord_handler(request, token_status=401)

    auth = make_auth(monotonic, wall, handler=rejected)
    state, _ = await auth.begin(INSTANCE)
    with pytest.raises(HandsAuthError) as caught:
        await auth.exchange(code="sdk-code", state=state)
    assert caught.value.code == "authentication_failed"
    assert "sdk-code" not in str(caught.value)
    await auth.close()

    def timeout(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth2/token"):
            raise httpx.ReadTimeout("secret upstream detail", request=request)
        return discord_handler(request)

    auth = make_auth(monotonic, wall, handler=timeout)
    state, _ = await auth.begin(INSTANCE)
    with pytest.raises(HandsAuthError, match="upstream_unavailable"):
        await auth.exchange(code="sdk-code", state=state)
    await auth.close()


async def test_ticket_tamper_expiry_and_payload_binding_are_rejected() -> None:
    monotonic = Clock()
    wall = Clock(2000)
    auth = make_auth(monotonic, wall)
    player = AuthenticatedPlayer(USER, GUILD, INSTANCE, "Fighter", None)
    ticket = auth.issue_ticket(player)

    with pytest.raises(HandsAuthError, match="invalid_ticket"):
        auth.verify_ticket(ticket[:-1] + ("A" if ticket[-1] != "A" else "B"))
    with pytest.raises(HandsAuthError, match="invalid_ticket"):
        auth.verify_ticket(ticket + ".extra")
    wall.value += 31
    with pytest.raises(HandsAuthError, match="invalid_ticket"):
        auth.verify_ticket(ticket)
    with pytest.raises(HandsAuthError, match="invalid_ticket"):
        auth.verify_ticket({"ticket": ticket})
    await auth.close()


async def test_activating_new_ticket_generation_invalidates_older_unconsumed_ticket() -> None:
    auth = make_auth(Clock(), Clock(2000))
    player = AuthenticatedPlayer(USER, GUILD, INSTANCE, "One", None)
    old = auth.issue_ticket(player)
    refreshed = auth.issue_ticket(player)

    auth.activate_ticket(refreshed, player)
    with pytest.raises(HandsAuthError, match="invalid_ticket"):
        auth.verify_ticket(old)
    assert auth.verify_ticket(refreshed) == player
    with pytest.raises(HandsAuthError, match="invalid_ticket"):
        auth.activate_ticket(
            auth.issue_ticket(player),
            AuthenticatedPlayer("444555666", GUILD, INSTANCE, "Other", None),
        )
    await auth.close()


async def test_consumed_ticket_registry_is_bounded_and_purges_expiry() -> None:
    wall = Clock(2000)
    auth = make_auth(Clock(), wall, max_consumed_tickets=1)
    first = auth.issue_ticket(AuthenticatedPlayer(USER, GUILD, INSTANCE, "One", None))
    assert auth.verify_ticket(first).user_id == USER
    second = auth.issue_ticket(AuthenticatedPlayer("444555666", GUILD, INSTANCE, "Two", None))
    with pytest.raises(HandsAuthError, match="service_busy"):
        auth.verify_ticket(second)
    wall.value += 31
    fresh = auth.issue_ticket(AuthenticatedPlayer("444555666", GUILD, INSTANCE, "Two", None))
    assert auth.verify_ticket(fresh).user_id == "444555666"
    await auth.close()


async def test_consumed_ticket_per_player_instance_cap_purge_and_isolation() -> None:
    wall = Clock(2000)
    auth = make_auth(
        Clock(),
        wall,
        max_consumed_tickets=10,
        max_consumed_tickets_per_player_instance=2,
    )
    same_player = AuthenticatedPlayer(USER, GUILD, INSTANCE, "One", None)
    consumed = [auth.issue_ticket(same_player) for _ in range(3)]
    assert auth.verify_ticket(consumed[0]) == same_player
    assert auth.verify_ticket(consumed[1]) == same_player
    with pytest.raises(HandsAuthError, match="invalid_ticket"):
        auth.verify_ticket(consumed[0])
    with pytest.raises(HandsAuthError, match="rate_limited"):
        auth.verify_ticket(consumed[2])

    other_player = AuthenticatedPlayer("444555666", GUILD, INSTANCE, "Two", None)
    other_instance = replace(same_player, instance_id="another-instance")
    assert auth.verify_ticket(auth.issue_ticket(other_player)) == other_player
    assert auth.verify_ticket(auth.issue_ticket(other_instance)) == other_instance

    wall.value += 31
    fresh = auth.issue_ticket(same_player)
    assert auth.verify_ticket(fresh) == same_player
    await auth.close()


async def test_invalid_avatar_is_dropped_and_display_name_is_bounded() -> None:
    monotonic = Clock()
    wall = Clock()

    def handler(request: httpx.Request) -> httpx.Response:
        response = discord_handler(
            request,
            user_overrides={"global_name": "x" * 200, "avatar": "bad/avatar"},
        )
        if request.url.path.endswith(f"guilds/{GUILD}/member"):
            return httpx.Response(200, json={"nick": None, "user": {"id": USER}})
        return response

    auth = make_auth(monotonic, wall, handler=handler)
    state, _ = await auth.begin(INSTANCE)
    exchange = await auth.exchange(code="sdk-code", state=state)
    assert exchange.player.display_name == "x" * 80
    assert exchange.player.avatar_hash is None
    assert replace(exchange.player, display_name="safe").user_id == USER
    await auth.close()
