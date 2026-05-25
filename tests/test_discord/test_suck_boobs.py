from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import discord

from intelstream.discord.cogs.suck_boobs import SuckBoobs, setup


def make_member(member_id: int, *, bot: bool = False, display_name: str | None = None):
    member = MagicMock(spec=discord.Member)
    member.id = member_id
    member.bot = bot
    member.display_name = display_name or f"User {member_id}"
    return member


def make_interaction():
    interaction = MagicMock(spec=discord.Interaction)
    interaction.guild = MagicMock(spec=discord.Guild)
    interaction.guild_id = 123
    interaction.user = make_member(1, display_name="Caller")
    interaction.response = MagicMock()
    interaction.response.send_message = AsyncMock()
    interaction.response.defer = AsyncMock()
    interaction.followup = MagicMock()
    interaction.followup.send = AsyncMock()
    return interaction


class TestRandomMemberSelection:
    def test_get_random_member_excludes_bots_and_requester(self):
        cog = SuckBoobs(MagicMock())
        target = make_member(3)
        members = [make_member(1), make_member(2, bot=True), target]

        with patch("intelstream.discord.cogs.suck_boobs.random.choice", return_value=target):
            assert cog._get_random_member(members, exclude_id=1) == target

    def test_get_random_member_returns_none_without_eligible_members(self):
        cog = SuckBoobs(MagicMock())

        assert cog._get_random_member([make_member(1), make_member(2, bot=True)], 1) is None


class TestCommand:
    async def test_rejects_dm_or_non_channel_interaction(self):
        cog = SuckBoobs(MagicMock())
        interaction = make_interaction()
        interaction.guild = None
        interaction.channel = MagicMock()

        await cog.suck_boobs.callback(cog, interaction)

        interaction.response.send_message.assert_awaited_once_with(
            "This command can only be used in a server channel.",
            ephemeral=True,
        )

    async def test_rejects_when_no_eligible_target(self):
        bot = MagicMock()
        bot.repository.record_suck_boobs_usage = AsyncMock()
        cog = SuckBoobs(bot)
        interaction = make_interaction()
        interaction.channel = MagicMock(spec=discord.TextChannel)
        interaction.channel.members = [interaction.user, make_member(2, bot=True)]

        await cog.suck_boobs.callback(cog, interaction)

        interaction.response.send_message.assert_awaited_once_with(
            "No eligible users found in this channel.",
            ephemeral=True,
        )
        bot.repository.record_suck_boobs_usage.assert_not_awaited()

    async def test_records_usage_and_sends_normal_response(self):
        bot = MagicMock()
        bot.repository.record_suck_boobs_usage = AsyncMock()
        cog = SuckBoobs(bot)
        interaction = make_interaction()
        target = make_member(2, display_name="Target")
        interaction.channel = MagicMock(spec=discord.TextChannel)
        interaction.channel.members = [interaction.user, target]

        with patch("intelstream.discord.cogs.suck_boobs.random.randint", return_value=2):
            await cog.suck_boobs.callback(cog, interaction)

        bot.repository.record_suck_boobs_usage.assert_awaited_once_with(
            guild_id="123",
            user_id="1",
            pinged_user_id="2",
        )
        message = interaction.response.send_message.await_args.args[0]
        assert "Caller" in message
        assert "<@2>" in message

    async def test_rare_response_still_records_usage(self):
        bot = MagicMock()
        bot.repository.record_suck_boobs_usage = AsyncMock()
        cog = SuckBoobs(bot)
        interaction = make_interaction()
        target = make_member(2)
        interaction.channel = MagicMock(spec=discord.Thread)
        interaction.channel.members = [interaction.user, target]

        with patch("intelstream.discord.cogs.suck_boobs.random.randint", return_value=1):
            await cog.suck_boobs.callback(cog, interaction)

        bot.repository.record_suck_boobs_usage.assert_awaited_once()
        assert "<@2>" in interaction.response.send_message.await_args.args[0]


class TestScoreCommand:
    async def test_score_rejects_dm_interaction(self):
        cog = SuckBoobs(MagicMock())
        interaction = make_interaction()
        interaction.guild = None

        await cog.suck_boobs_score.callback(cog, interaction)

        interaction.response.send_message.assert_awaited_once_with(
            "This command can only be used in a server.",
            ephemeral=True,
        )

    async def test_score_renders_empty_leaderboard(self):
        bot = MagicMock()
        bot.repository.get_suck_boobs_leaderboard = AsyncMock(return_value=([], []))
        cog = SuckBoobs(bot)
        interaction = make_interaction()

        await cog.suck_boobs_score.callback(cog, interaction)

        interaction.response.defer.assert_awaited_once()
        embed = interaction.followup.send.await_args.kwargs["embed"]
        assert embed.title
        assert [field.value.startswith("No data yet") for field in embed.fields] == [True, True]

    async def test_score_renders_known_and_unknown_members(self):
        bot = MagicMock()
        bot.repository.get_suck_boobs_leaderboard = AsyncMock(
            return_value=(
                [SimpleNamespace(user_id="10", times_used=4)],
                [SimpleNamespace(user_id="20", times_pinged=7)],
            )
        )
        cog = SuckBoobs(bot)
        interaction = make_interaction()
        member = MagicMock(spec=discord.Member)
        member.display_name = "Known User"
        interaction.guild.fetch_member = AsyncMock(
            side_effect=[member, discord.DiscordException("missing")]
        )

        await cog.suck_boobs_score.callback(cog, interaction)

        embed = interaction.followup.send.await_args.kwargs["embed"]
        assert "Known User: 4" in embed.fields[0].value
        assert "Unknown (20): 7" in embed.fields[1].value


class TestSetup:
    async def test_setup_registers_cog(self):
        bot = MagicMock()
        bot.add_cog = AsyncMock()

        await setup(bot)

        [cog] = bot.add_cog.await_args.args
        assert isinstance(cog, SuckBoobs)
        assert cog.bot == bot
