from __future__ import annotations

import asyncio
import json
from urllib.parse import parse_qs

import aiohttp
import httpx

from intelstream.database.repository import Repository
from intelstream.hands.auth import HandsAuth
from intelstream.hands.engine import EngineConfig
from intelstream.hands.protocol import encode_client_input
from intelstream.hands.rooms import HandsRoomManager, RoomConfig
from intelstream.hands.server import HandsServer
from intelstream.hands.types import Hand, InputCommand, PunchAction, PunchClass, Target

APP = "123456789"
GUILD = "987654321"
CHANNEL = "456789123"
ONE = "111222333"
TWO = "444555666"
THREE = "777888999"
INSTANCE = "bout"
ORIGIN = f"https://{APP}.discordsays.com"


def discord_handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path == "/api/v10/oauth2/token":
        form = parse_qs(request.content.decode())
        code = form["code"][0]
        assert form["client_id"] == [APP]
        assert form["client_secret"] == ["secret"]
        if code not in {"code-one", "code-two", "code-three"}:
            return httpx.Response(401, json={})
        return httpx.Response(
            200,
            json={"access_token": f"access-{code.removeprefix('code-')}"},
        )
    if path == "/api/v10/users/@me":
        token = request.headers["authorization"]
        user_id, name = {
            "Bearer access-one": (ONE, "One"),
            "Bearer access-two": (TWO, "Two"),
            "Bearer access-three": (THREE, "Three"),
        }[token]
        return httpx.Response(
            200,
            json={"id": user_id, "username": name, "global_name": name, "avatar": None},
        )
    if path == f"/api/v10/users/@me/guilds/{GUILD}/member":
        token = request.headers["authorization"]
        user_id = {
            "Bearer access-one": ONE,
            "Bearer access-two": TWO,
            "Bearer access-three": THREE,
        }[token]
        return httpx.Response(200, json={"nick": None, "user": {"id": user_id}})
    if path == f"/api/v10/applications/{APP}/activity-instances/{INSTANCE}":
        assert request.headers["authorization"] == "Bot bot"
        return httpx.Response(
            200,
            json={
                "application_id": APP,
                "instance_id": INSTANCE,
                "location": {
                    "kind": "gc",
                    "guild_id": GUILD,
                    "channel_id": CHANNEL,
                },
                "users": [ONE, TWO, THREE],
            },
        )
    return httpx.Response(404, json={})


async def wait_for_type(socket: aiohttp.ClientWebSocketResponse, kind: str) -> dict[str, object]:
    async with asyncio.timeout(3):
        while True:
            message = await socket.receive()
            if message.type == aiohttp.WSMsgType.TEXT:
                payload = json.loads(message.data)
                if payload["type"] == kind:
                    return payload


async def test_real_auth_spectator_reconnect_and_authoritative_elo(tmp_path) -> None:
    repository = Repository(f"sqlite+aiosqlite:///{tmp_path / 'hands.db'}")
    await repository.initialize()
    rooms = HandsRoomManager(
        repository,
        config=RoomConfig(
            tick_interval_seconds=0.001,
            broadcast_every_ticks=1,
            reconnect_grace_seconds=0.2,
            result_hold_seconds=0.02,
            max_inputs_per_second=30,
            engine_config=EngineConfig(
                rounds=1,
                round_ticks=300,
                rest_ticks=0,
                countdown_ticks=2,
                flash_ko_enabled=False,
                doctor_cut_threshold=5000,
                doctor_swelling_threshold=5000,
            ),
        ),
        match_id_factory=lambda: "integration-match",
        seed_factory=lambda: 42,
    )
    http_client = httpx.AsyncClient(
        base_url="https://discord.test/api/v10",
        transport=httpx.MockTransport(discord_handler),
    )
    auth = HandsAuth(
        application_id=APP,
        guild_id=GUILD,
        client_secret="secret",
        bot_token="bot",
        client=http_client,
        close_client=True,
        ticket_secret=b"integration-secret" * 2,
    )
    server = HandsServer(
        repository=repository,
        application_id=APP,
        guild_id=GUILD,
        client_secret="secret",
        bot_token="bot",
        host="127.0.0.1",
        port=0,
        auth=auth,
        rooms=rooms,
    )
    await server.start()
    assert server.bound_port is not None
    base = f"http://127.0.0.1:{server.bound_port}"
    headers = {"Origin": ORIGIN}

    try:
        async with aiohttp.ClientSession() as client:
            credentials: dict[str, dict[str, object]] = {}
            for label in ("one", "two", "three"):
                bootstrap = await client.post(
                    f"{base}/api/hands/bootstrap",
                    json={"instance_id": INSTANCE},
                    headers=headers,
                )
                bootstrap_payload = await bootstrap.json()
                assert bootstrap_payload["simulation"]["tick_rate"] == 30
                token = await client.post(
                    f"{base}/api/hands/token",
                    json={"code": f"code-{label}", "state": bootstrap_payload["state"]},
                    headers=headers,
                )
                assert token.status == 200
                credentials[label] = await token.json()

            one = await client.ws_connect(f"{base}/api/hands/ws", headers=headers)
            two = await client.ws_connect(f"{base}/api/hands/ws", headers=headers)
            await one.send_json(
                {
                    "version": 1,
                    "type": "authenticate",
                    "ticket": credentials["one"]["ticket"],
                }
            )
            welcome_one = await wait_for_type(one, "welcome")
            await two.send_json(
                {
                    "version": 1,
                    "type": "authenticate",
                    "ticket": credentials["two"]["ticket"],
                }
            )
            await wait_for_type(two, "welcome")
            await wait_for_type(one, "ready")

            spectator = await client.ws_connect(f"{base}/api/hands/ws", headers=headers)
            await spectator.send_json(
                {
                    "version": 1,
                    "type": "authenticate",
                    "ticket": credentials["three"]["ticket"],
                }
            )
            spectator_welcome = await wait_for_type(spectator, "welcome")
            assert spectator_welcome["role"] == "spectator"
            assert "seat" not in spectator_welcome
            spectator_snapshot = await wait_for_type(spectator, "snapshot")
            assert all(
                fighter["get_up_prompt"] is None and fighter["queued_actions"] == 0
                for fighter in spectator_snapshot["payload"]["fighters"]
            )

            await one.close()
            replacement = await client.ws_connect(f"{base}/api/hands/ws", headers=headers)
            await replacement.send_json(
                {
                    "version": 1,
                    "type": "authenticate",
                    "ticket": welcome_one["reconnect_ticket"],
                }
            )
            reconnect_welcome = await wait_for_type(replacement, "welcome")
            assert reconnect_welcome["reconnect_ticket"] != welcome_one["reconnect_ticket"]
            assert reconnect_welcome["next_sequence"] == 0
            snapshot = await wait_for_type(replacement, "snapshot")
            assert snapshot["payload"]["tick"] >= reconnect_welcome["server_tick"]
            await wait_for_type(replacement, "resumed")

            await replacement.send_str(
                encode_client_input(
                    InputCommand(
                        sequence=0,
                        client_tick=int(snapshot["payload"]["tick"]),
                        actions=(
                            PunchAction(
                                hand=Hand.LEFT,
                                punch_class=PunchClass.JAB,
                                target=Target.HEAD,
                            ),
                        ),
                    )
                )
            )
            final_one, final_two, final_spectator = await asyncio.gather(
                wait_for_type(replacement, "final"),
                wait_for_type(two, "final"),
                wait_for_type(spectator, "final"),
            )
            assert final_one == final_two == final_spectator
            assert final_one["match_id"] == "integration-match"
            assert set(final_one["ratings"]) == {ONE, TWO}
            await replacement.close()
            await two.close()
            await spectator.close()

        match = await repository.get_hands_match("integration-match")
        one_rating = await repository.get_hands_rating(GUILD, ONE)
        two_rating = await repository.get_hands_rating(GUILD, TWO)
        spectator_rating = await repository.get_hands_rating(GUILD, THREE)
        assert match is not None
        assert one_rating is not None and two_rating is not None
        assert spectator_rating is not None and spectator_rating.bouts == 0
        assert one_rating.bouts == two_rating.bouts == 1
        assert one_rating.rating + two_rating.rating == 2000
        assert match.player_one_rating_after == one_rating.rating
        assert match.player_two_rating_after == two_rating.rating
    finally:
        await server.close()
        await repository.close()
    assert http_client.is_closed
