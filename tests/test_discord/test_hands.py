from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import discord
from pydantic import SecretStr

from intelstream.discord.cogs.hands import Hands, setup


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
    value.response.launch_activity = AsyncMock()
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
    return value


async def test_hands_rejects_dm_wrong_guild_disabled_and_unavailable() -> None:
    for guild_id, enabled, expected in (
        (None, True, "configured server"),
        (999, True, "configured server"),
        (123, False, "not enabled"),
        (123, True, "unavailable"),
    ):
        mock_bot = bot(enabled=enabled)
        cog = Hands(mock_bot)
        value = interaction(guild_id=guild_id)

        await cog.hands.callback(cog, value)

        message = value.response.send_message.await_args.args[0]
        assert expected in message
        value.response.launch_activity.assert_not_awaited()
        mock_bot.repository.get_or_create_hands_rating.assert_not_awaited()


async def test_hands_materializes_rating_then_launches_exactly_once() -> None:
    mock_bot = bot()
    cog = Hands(mock_bot)
    cog.server = MagicMock()
    cog.server.running = True
    value = interaction()

    await cog.hands.callback(cog, value)

    mock_bot.repository.get_or_create_hands_rating.assert_awaited_once_with("123", "10")
    value.response.launch_activity.assert_awaited_once_with()
    value.response.send_message.assert_not_awaited()
    value.response.defer.assert_not_awaited()


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


async def test_cog_load_disabled_is_noop_and_start_failure_closes_server() -> None:
    disabled = Hands(bot(enabled=False))
    await disabled.cog_load()
    assert disabled.server is None

    mock_bot = bot()
    server = MagicMock()
    server.start = AsyncMock(side_effect=OSError("bind failed"))
    server.close = AsyncMock()
    with patch("intelstream.discord.cogs.hands.HandsServer", return_value=server):
        failed = Hands(mock_bot)
        try:
            await failed.cog_load()
        except OSError:
            pass
        else:
            raise AssertionError("expected startup failure")
    server.close.assert_awaited_once()
    assert failed.server is None


async def test_setup_registers_cog() -> None:
    mock_bot = bot()
    mock_bot.add_cog = AsyncMock()

    await setup(mock_bot)

    [cog] = mock_bot.add_cog.await_args.args
    assert isinstance(cog, Hands)
