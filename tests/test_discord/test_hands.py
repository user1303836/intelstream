from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import discord
import pytest
from pydantic import SecretStr

from intelstream.discord.cogs.hands import (
    HANDS_ENTRY_POINT_DESCRIPTION,
    HANDS_ENTRY_POINT_HANDLER,
    HANDS_ENTRY_POINT_NAME,
    HANDS_ENTRY_POINT_TYPE,
    Hands,
    setup,
)


def settings(*, enabled: bool = True):
    secret = SecretStr("client-secret")
    return SimpleNamespace(
        hands_enabled=enabled,
        discord_guild_id=123,
        discord_client_secret=secret if enabled else None,
        discord_token="bot-token",
        hands_host="127.0.0.1",
        hands_port=8080,
        hands_dev_mode=False,
        hands_trusted_proxies=("127.0.0.1/32",),
    )


def interaction(*, guild_id: int | None = 123):
    value = MagicMock(spec=discord.Interaction)
    value.guild_id = guild_id
    value.guild = MagicMock(spec=discord.Guild) if guild_id is not None else None
    if value.guild is not None:
        value.guild.fetch_member = AsyncMock(return_value=None)
    value.user = MagicMock(spec=discord.Member)
    value.user.id = 10
    value.response = MagicMock()
    value.response.send_message = AsyncMock()
    value.response.defer = AsyncMock()
    value.followup = MagicMock()
    value.followup.send = AsyncMock()
    return value


def bot(*, enabled: bool = True):
    value = MagicMock()
    value.settings = settings(enabled=enabled)
    value.application_id = 999
    value.repository = MagicMock()
    value.repository.get_or_create_hands_rating = AsyncMock(
        return_value=SimpleNamespace(
            user_id="10",
            rating=1000,
            bouts=0,
            wins=0,
            losses=0,
            draws=0,
            knockouts=0,
            current_streak=0,
        )
    )
    value.repository.get_hands_leaderboard = AsyncMock(return_value=[])
    value.repository.get_hands_rank = AsyncMock(return_value=1)
    value.http = MagicMock()
    value.http.get_global_commands = AsyncMock(
        return_value=[
            {
                "id": "1234",
                "name": "launch",
                "description": "Launch an activity",
                "type": HANDS_ENTRY_POINT_TYPE,
                "handler": HANDS_ENTRY_POINT_HANDLER,
                "integration_types": [0, 1],
                "contexts": [0, 1, 2],
            }
        ]
    )
    value.http.request = AsyncMock(
        return_value={
            "id": "1234",
            "name": HANDS_ENTRY_POINT_NAME,
            "description": HANDS_ENTRY_POINT_DESCRIPTION,
            "type": HANDS_ENTRY_POINT_TYPE,
            "handler": HANDS_ENTRY_POINT_HANDLER,
            "integration_types": [0],
            "contexts": [0],
        }
    )
    return value


def test_hands_uses_discord_managed_entry_point_instead_of_bot_launch_command() -> None:
    assert [command.name for command in Hands.__cog_app_commands__] == ["hands_scoreboard"]


async def test_scoreboard_renders_top_ten_and_caller_record_with_safe_names() -> None:
    mock_bot = bot()
    known = MagicMock(spec=discord.Member)
    known.display_name = "Known Fighter"
    value = interaction()
    assert value.guild is not None
    value.guild.get_member.side_effect = lambda user_id: known if user_id == 20 else None
    ratings = [
        SimpleNamespace(
            user_id="20",
            rating=1100,
            bouts=4,
            wins=3,
            losses=1,
            draws=0,
            knockouts=2,
            current_streak=2,
        ),
        SimpleNamespace(
            user_id="30",
            rating=1050,
            bouts=2,
            wins=1,
            losses=0,
            draws=1,
            knockouts=0,
            current_streak=0,
        ),
    ]
    mock_bot.repository.get_hands_leaderboard.return_value = ratings
    mock_bot.repository.get_hands_rank.return_value = 8
    cog = Hands(mock_bot)

    await cog.hands_scoreboard.callback(cog, value)

    value.response.defer.assert_awaited_once_with()
    embed = value.followup.send.await_args.kwargs["embed"]
    assert embed.title == "Hands ELO Scoreboard"
    assert "Known Fighter" in embed.fields[0].value
    assert "Departed member" in embed.fields[0].value
    assert "1100 ELO" in embed.fields[0].value
    assert "#8" in embed.fields[1].value
    assert "1000 ELO" in embed.fields[1].value
    assert all(len(field.value) <= 1024 for field in embed.fields)


async def test_scoreboard_fetches_cache_misses_with_bound_and_escapes_markdown() -> None:
    mock_bot = bot()
    value = interaction()
    assert value.guild is not None
    value.guild.get_member.return_value = None
    fetched = MagicMock(spec=discord.Member)
    fetched.display_name = "**bad_name** [link](url) @everyone"
    value.guild.fetch_member = AsyncMock(
        side_effect=[fetched, discord.DiscordException("member unavailable")]
    )
    ratings = [
        SimpleNamespace(
            user_id=user_id,
            rating=1000,
            bouts=1,
            wins=0,
            losses=0,
            draws=1,
            knockouts=0,
            current_streak=0,
        )
        for user_id in ("20", "30")
    ]
    mock_bot.repository.get_hands_leaderboard.return_value = ratings
    cog = Hands(mock_bot)

    await cog.hands_scoreboard.callback(cog, value)

    assert value.guild.fetch_member.await_count == 2
    embed = value.followup.send.await_args.kwargs["embed"]
    top = embed.fields[0].value
    assert r"\*\*bad\_name\*\*" in top
    assert "Departed member" in top
    assert "@everyone" in top


async def test_scoreboard_keeps_ten_long_rows_complete_across_embed_fields() -> None:
    mock_bot = bot()
    value = interaction()
    assert value.guild is not None
    members: dict[int, MagicMock] = {}
    ratings = []
    for rank in range(1, 11):
        user_id = str(100 + rank)
        member = MagicMock(spec=discord.Member)
        member.display_name = f"Fighter_{rank}_" + "x" * 40
        members[int(user_id)] = member
        ratings.append(
            SimpleNamespace(
                user_id=user_id,
                rating=9_999_999_999 + rank,
                bouts=9_999_999_999,
                wins=9_999_999_999,
                losses=9_999_999_999,
                draws=9_999_999_999,
                knockouts=9_999_999_999,
                current_streak=9_999_999_999,
            )
        )
    value.guild.get_member.side_effect = members.get
    mock_bot.repository.get_hands_leaderboard.return_value = ratings
    cog = Hands(mock_bot)

    await cog.hands_scoreboard.callback(cog, value)

    embed = value.followup.send.await_args.kwargs["embed"]
    top_fields = [field for field in embed.fields if field.name.startswith("Top fighters")]
    assert len(top_fields) >= 2
    assert all(len(field.value) <= 1024 for field in top_fields)
    rendered_lines = [
        line for field in top_fields for line in field.value.splitlines() if line.strip()
    ]
    expected_lines = [
        cog._rating_line(
            rank,
            rating,
            discord.utils.escape_markdown(members[int(rating.user_id)].display_name[:40]),
        )
        for rank, rating in enumerate(ratings, start=1)
    ]
    assert rendered_lines == expected_lines


async def test_scoreboard_rejects_wrong_guild_without_defer() -> None:
    cog = Hands(bot())
    value = interaction(guild_id=None)

    await cog.hands_scoreboard.callback(cog, value)

    value.response.send_message.assert_awaited_once()
    value.response.defer.assert_not_awaited()


async def test_cog_lifecycle_starts_enabled_server_and_close_is_awaited() -> None:
    mock_bot = bot()
    server = MagicMock()
    server.start = AsyncMock()
    server.close = AsyncMock()
    server.running = True
    with patch("intelstream.discord.cogs.hands.HandsServer", return_value=server) as factory:
        cog = Hands(mock_bot)
        await cog.cog_load()
        await cog.cog_unload()
        await cog.cog_unload()

    factory.assert_called_once()
    kwargs = factory.call_args.kwargs
    assert kwargs["application_id"] == "999"
    assert kwargs["guild_id"] == "123"
    assert kwargs["client_secret"] == "client-secret"
    assert kwargs["admission"].trusted_proxy_cidrs == ("127.0.0.1/32",)
    server.start.assert_awaited_once()
    server.close.assert_awaited_once()
    mock_bot.http.get_global_commands.assert_awaited_once_with(999)
    route = mock_bot.http.request.await_args.args[0]
    assert route.method == "PATCH"
    assert route.url.endswith("/applications/999/commands/1234")
    assert mock_bot.http.request.await_args.kwargs["json"] == {
        "name": HANDS_ENTRY_POINT_NAME,
        "description": HANDS_ENTRY_POINT_DESCRIPTION,
        "handler": HANDS_ENTRY_POINT_HANDLER,
        "integration_types": [0],
        "contexts": [0],
    }


async def test_entry_point_configuration_is_idempotent_and_can_create_default() -> None:
    configured = {
        "id": "1234",
        "name": HANDS_ENTRY_POINT_NAME,
        "description": HANDS_ENTRY_POINT_DESCRIPTION,
        "type": HANDS_ENTRY_POINT_TYPE,
        "handler": HANDS_ENTRY_POINT_HANDLER,
        "integration_types": [0],
        "contexts": [0],
    }
    existing_bot = bot()
    existing_bot.http.get_global_commands.return_value = [configured]
    await Hands(existing_bot)._configure_entry_point(999)
    existing_bot.http.request.assert_not_awaited()

    new_bot = bot()
    new_bot.http.get_global_commands.return_value = []
    new_bot.http.request.return_value = configured
    await Hands(new_bot)._configure_entry_point(999)
    route = new_bot.http.request.await_args.args[0]
    assert route.method == "POST"
    assert route.url.endswith("/applications/999/commands")
    assert new_bot.http.request.await_args.kwargs["json"] == {
        "name": HANDS_ENTRY_POINT_NAME,
        "description": HANDS_ENTRY_POINT_DESCRIPTION,
        "handler": HANDS_ENTRY_POINT_HANDLER,
        "integration_types": [0],
        "contexts": [0],
        "type": HANDS_ENTRY_POINT_TYPE,
    }


@pytest.mark.parametrize(
    "commands",
    [
        [{"id": "1", "type": 4}, {"id": "2", "type": 4}],
        [{"id": "1", "name": "hands", "type": 1}],
        [{"id": "invalid", "type": 4}],
    ],
)
async def test_entry_point_configuration_rejects_ambiguous_commands(
    commands: list[dict[str, object]],
) -> None:
    mock_bot = bot()
    mock_bot.http.get_global_commands.return_value = commands

    with pytest.raises(RuntimeError):
        await Hands(mock_bot)._configure_entry_point(999)

    mock_bot.http.request.assert_not_awaited()


async def test_disabled_entry_point_cleanup_is_idempotent() -> None:
    disabled_bot = bot(enabled=False)

    await Hands(disabled_bot).cog_load()

    disabled_bot.http.get_global_commands.assert_awaited_once_with(999)
    disabled_bot.http.request.assert_not_awaited()


async def test_cog_load_disabled_removes_entry_point_and_failures_close_server() -> None:
    disabled_bot = bot(enabled=False)
    disabled_bot.http.get_global_commands.return_value[0]["name"] = HANDS_ENTRY_POINT_NAME
    disabled = Hands(disabled_bot)
    await disabled.cog_load()
    assert disabled.server is None
    disabled_bot.http.get_global_commands.assert_awaited_once_with(999)
    route = disabled_bot.http.request.await_args.args[0]
    assert route.method == "DELETE"
    assert route.url.endswith("/applications/999/commands/1234")

    for failure in (OSError("bind failed"), RuntimeError("entry point failed")):
        mock_bot = bot()
        server = MagicMock()
        server.start = AsyncMock(side_effect=failure if isinstance(failure, OSError) else None)
        server.close = AsyncMock()
        if isinstance(failure, RuntimeError):
            mock_bot.http.get_global_commands.side_effect = failure
        with patch("intelstream.discord.cogs.hands.HandsServer", return_value=server):
            failed = Hands(mock_bot)
            with pytest.raises(type(failure), match=str(failure)):
                await failed.cog_load()
        server.close.assert_awaited_once()
        assert failed.server is None


async def test_setup_registers_cog() -> None:
    mock_bot = bot()
    mock_bot.add_cog = AsyncMock()

    await setup(mock_bot)

    [cog] = mock_bot.add_cog.await_args.args
    assert isinstance(cog, Hands)
