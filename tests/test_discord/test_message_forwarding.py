from unittest.mock import AsyncMock, MagicMock

import discord
import pytest
from discord import app_commands

from intelstream.discord.cogs.message_forwarding import MessageForwarding, setup


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.repository = MagicMock()
    bot.guilds = []
    bot.user = MagicMock()
    bot.user.id = 999
    bot.get_channel = MagicMock(return_value=None)
    return bot


@pytest.fixture
def cog(mock_bot):
    return MessageForwarding(mock_bot)


def make_interaction(*, in_guild: bool = True) -> MagicMock:
    interaction = MagicMock(spec=discord.Interaction)
    interaction.response = MagicMock()
    interaction.response.defer = AsyncMock()
    interaction.response.send_message = AsyncMock()
    interaction.followup = MagicMock()
    interaction.followup.send = AsyncMock()
    interaction.user = MagicMock()
    interaction.user.id = 123
    interaction.guild_id = 456
    interaction.guild = MagicMock(spec=discord.Guild) if in_guild else None
    return interaction


def make_channel(channel_id: int, mention: str = "#channel") -> MagicMock:
    channel = MagicMock(spec=discord.TextChannel)
    channel.id = channel_id
    channel.mention = mention
    return channel


class TestForwardAdd:
    async def test_forward_add_success(self, cog, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        mock_member = MagicMock(spec=discord.Member)
        mock_member.id = 123
        interaction.user = mock_member
        interaction.guild_id = 456
        interaction.guild = MagicMock(spec=discord.Guild)
        interaction.guild.me = MagicMock()

        mock_source = MagicMock(spec=discord.TextChannel)
        mock_source.id = 111
        mock_source.mention = "#source"

        mock_dest = MagicMock(spec=discord.Thread)
        mock_dest.id = 222
        mock_dest.mention = "#dest"
        mock_permissions = MagicMock()
        mock_permissions.send_messages = True
        mock_dest.permissions_for = MagicMock(return_value=mock_permissions)

        mock_bot.repository.get_forwarding_rules_for_source = AsyncMock(return_value=[])
        mock_bot.repository.add_forwarding_rule = AsyncMock()
        mock_bot.repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[])

        await cog.forward_add.callback(cog, interaction, source=mock_source, destination=mock_dest)

        mock_bot.repository.add_forwarding_rule.assert_called_once_with(
            guild_id="456",
            source_channel_id="111",
            source_type="channel",
            destination_channel_id="222",
            destination_type="thread",
        )

        call_args = interaction.followup.send.call_args
        assert "Forwarding configured" in call_args[0][0]

    async def test_forward_add_duplicate_rule(self, cog, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.guild_id = 456
        interaction.guild = MagicMock(spec=discord.Guild)

        mock_source = MagicMock(spec=discord.TextChannel)
        mock_source.id = 111
        mock_source.mention = "#source"

        mock_dest = MagicMock(spec=discord.TextChannel)
        mock_dest.id = 222
        mock_dest.mention = "#dest"

        existing_rule = MagicMock()
        existing_rule.destination_channel_id = "222"
        mock_bot.repository.get_forwarding_rules_for_source = AsyncMock(
            return_value=[existing_rule]
        )

        await cog.forward_add.callback(cog, interaction, source=mock_source, destination=mock_dest)

        mock_bot.repository.add_forwarding_rule.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "already exists" in call_args[0][0]

    async def test_forward_add_bot_no_permission(self, cog, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.guild_id = 456
        interaction.guild = MagicMock(spec=discord.Guild)
        interaction.guild.me = MagicMock()

        mock_source = MagicMock(spec=discord.TextChannel)
        mock_source.id = 111

        mock_dest = MagicMock(spec=discord.TextChannel)
        mock_dest.id = 222
        mock_dest.mention = "#dest"
        mock_permissions = MagicMock()
        mock_permissions.send_messages = False
        mock_dest.permissions_for = MagicMock(return_value=mock_permissions)

        mock_bot.repository.get_forwarding_rules_for_source = AsyncMock(return_value=[])

        await cog.forward_add.callback(cog, interaction, source=mock_source, destination=mock_dest)

        mock_bot.repository.add_forwarding_rule.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "permission" in call_args[0][0].lower()
        assert "I don't" in call_args[0][0]

    async def test_forward_add_user_no_permission(self, cog, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.guild_id = 456
        interaction.guild = MagicMock(spec=discord.Guild)
        interaction.guild.me = MagicMock()

        mock_member = MagicMock(spec=discord.Member)
        mock_member.id = 123
        interaction.user = mock_member

        mock_source = MagicMock(spec=discord.TextChannel)
        mock_source.id = 111

        mock_dest = MagicMock(spec=discord.TextChannel)
        mock_dest.id = 222
        mock_dest.mention = "#dest"

        bot_permissions = MagicMock()
        bot_permissions.send_messages = True
        user_permissions = MagicMock()
        user_permissions.send_messages = False

        def permissions_for(entity):
            if entity == interaction.guild.me:
                return bot_permissions
            return user_permissions

        mock_dest.permissions_for = MagicMock(side_effect=permissions_for)

        mock_bot.repository.get_forwarding_rules_for_source = AsyncMock(return_value=[])

        await cog.forward_add.callback(cog, interaction, source=mock_source, destination=mock_dest)

        mock_bot.repository.add_forwarding_rule.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "permission" in call_args[0][0].lower()
        assert "You don't" in call_args[0][0]

    async def test_forward_add_not_in_guild(self, cog, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.guild = None

        mock_source = MagicMock(spec=discord.TextChannel)
        mock_dest = MagicMock(spec=discord.TextChannel)

        await cog.forward_add.callback(cog, interaction, source=mock_source, destination=mock_dest)

        mock_bot.repository.add_forwarding_rule.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "server" in call_args[0][0].lower()


class TestForwardList:
    async def test_forward_list_with_rules(self, cog, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.guild_id = 456
        interaction.guild = MagicMock(spec=discord.Guild)

        mock_rule = MagicMock()
        mock_rule.source_channel_id = "111"
        mock_rule.destination_channel_id = "222"
        mock_rule.is_active = True
        mock_rule.messages_forwarded = 42

        mock_source = MagicMock()
        mock_source.mention = "#source"

        mock_dest = MagicMock()
        mock_dest.mention = "#dest"

        mock_bot.repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[mock_rule])
        mock_bot.get_channel = MagicMock(
            side_effect=lambda x: mock_source if x == 111 else mock_dest
        )

        await cog.forward_list.callback(cog, interaction)

        call_args = interaction.followup.send.call_args
        message = call_args[0][0]
        assert "Forwarding Rules" in message
        assert "#source" in message
        assert "#dest" in message
        assert "42 forwarded" in message

    async def test_forward_list_no_rules(self, cog, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.guild_id = 456
        interaction.guild = MagicMock(spec=discord.Guild)

        mock_bot.repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[])

        await cog.forward_list.callback(cog, interaction)

        call_args = interaction.followup.send.call_args
        assert "No forwarding rules" in call_args[0][0]

    async def test_forward_list_not_in_guild(self, cog, mock_bot):
        interaction = make_interaction(in_guild=False)

        await cog.forward_list.callback(cog, interaction)

        mock_bot.repository.get_forwarding_rules_for_guild.assert_not_called()
        assert "server" in interaction.followup.send.call_args.args[0]

    async def test_forward_list_resolves_destination_thread_from_guilds(
        self, cog, mock_bot
    ):
        interaction = make_interaction()
        mock_rule = MagicMock()
        mock_rule.source_channel_id = "111"
        mock_rule.destination_channel_id = "222"
        mock_rule.is_active = False
        mock_rule.messages_forwarded = 7
        source = make_channel(111, "#source")
        thread = MagicMock(spec=discord.Thread)
        thread.mention = "#thread"
        guild = MagicMock()
        guild.get_thread = MagicMock(return_value=thread)
        mock_bot.guilds = [guild]
        mock_bot.repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[mock_rule])
        mock_bot.get_channel = MagicMock(side_effect=lambda channel_id: source if channel_id == 111 else None)

        await cog.forward_list.callback(cog, interaction)

        message = interaction.followup.send.call_args.args[0]
        assert "#source -> #thread" in message
        assert "paused" in message

    async def test_forward_list_uses_unknown_names_when_channels_missing(
        self, cog, mock_bot
    ):
        interaction = make_interaction()
        mock_rule = MagicMock()
        mock_rule.source_channel_id = "111"
        mock_rule.destination_channel_id = "222"
        mock_rule.is_active = True
        mock_rule.messages_forwarded = 0
        guild = MagicMock()
        guild.get_thread = MagicMock(return_value=None)
        mock_bot.guilds = [guild]
        mock_bot.repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[mock_rule])
        mock_bot.get_channel = MagicMock(return_value=None)

        await cog.forward_list.callback(cog, interaction)

        message = interaction.followup.send.call_args.args[0]
        assert "Unknown (111)" in message
        assert "Unknown (222)" in message


class TestForwardRemove:
    async def test_forward_remove_success(self, cog, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123
        interaction.guild_id = 456
        interaction.guild = MagicMock(spec=discord.Guild)

        mock_source = MagicMock(spec=discord.TextChannel)
        mock_source.id = 111
        mock_source.mention = "#source"

        mock_dest = MagicMock(spec=discord.Thread)
        mock_dest.id = 222
        mock_dest.mention = "#dest"

        mock_bot.repository.delete_forwarding_rule = AsyncMock(return_value=True)
        mock_bot.repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[])

        await cog.forward_remove.callback(
            cog, interaction, source=mock_source, destination=mock_dest
        )

        mock_bot.repository.delete_forwarding_rule.assert_called_once_with(
            guild_id="456",
            source_channel_id="111",
            destination_channel_id="222",
        )

        call_args = interaction.followup.send.call_args
        assert "removed" in call_args[0][0]

    async def test_forward_remove_not_found(self, cog, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.guild_id = 456
        interaction.guild = MagicMock(spec=discord.Guild)

        mock_source = MagicMock(spec=discord.TextChannel)
        mock_source.id = 999
        mock_source.mention = "#unknown"

        mock_dest = MagicMock(spec=discord.Thread)
        mock_dest.id = 888
        mock_dest.mention = "#dest"

        mock_bot.repository.delete_forwarding_rule = AsyncMock(return_value=False)

        await cog.forward_remove.callback(
            cog, interaction, source=mock_source, destination=mock_dest
        )

        call_args = interaction.followup.send.call_args
        assert "No forwarding rule found" in call_args[0][0]

    async def test_forward_remove_not_in_guild(self, cog, mock_bot):
        interaction = make_interaction(in_guild=False)
        source = make_channel(111, "#source")
        dest = make_channel(222, "#dest")

        await cog.forward_remove.callback(cog, interaction, source=source, destination=dest)

        mock_bot.repository.delete_forwarding_rule.assert_not_called()
        assert "server" in interaction.followup.send.call_args.args[0]


class TestForwardPauseResume:
    async def test_forward_pause_success(self, cog, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123
        interaction.guild_id = 456
        interaction.guild = MagicMock(spec=discord.Guild)

        mock_source = MagicMock(spec=discord.TextChannel)
        mock_source.id = 111
        mock_source.mention = "#source"

        mock_dest = MagicMock(spec=discord.Thread)
        mock_dest.id = 222
        mock_dest.mention = "#dest"

        mock_bot.repository.set_forwarding_rule_active = AsyncMock(return_value=True)
        mock_bot.repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[])

        await cog.forward_pause.callback(
            cog, interaction, source=mock_source, destination=mock_dest
        )

        mock_bot.repository.set_forwarding_rule_active.assert_called_once_with(
            guild_id="456",
            source_channel_id="111",
            destination_channel_id="222",
            is_active=False,
        )

        call_args = interaction.followup.send.call_args
        assert "paused" in call_args[0][0]

    async def test_forward_resume_success(self, cog, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123
        interaction.guild_id = 456
        interaction.guild = MagicMock(spec=discord.Guild)

        mock_source = MagicMock(spec=discord.TextChannel)
        mock_source.id = 111
        mock_source.mention = "#source"

        mock_dest = MagicMock(spec=discord.Thread)
        mock_dest.id = 222
        mock_dest.mention = "#dest"

        mock_bot.repository.set_forwarding_rule_active = AsyncMock(return_value=True)
        mock_bot.repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[])

        await cog.forward_resume.callback(
            cog, interaction, source=mock_source, destination=mock_dest
        )

        mock_bot.repository.set_forwarding_rule_active.assert_called_once_with(
            guild_id="456",
            source_channel_id="111",
            destination_channel_id="222",
            is_active=True,
        )

        call_args = interaction.followup.send.call_args
        assert "resumed" in call_args[0][0]

    async def test_forward_pause_not_found(self, cog, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.guild_id = 456
        interaction.guild = MagicMock(spec=discord.Guild)

        mock_source = MagicMock(spec=discord.TextChannel)
        mock_source.id = 999
        mock_source.mention = "#unknown"

        mock_dest = MagicMock(spec=discord.Thread)
        mock_dest.id = 888
        mock_dest.mention = "#dest"

        mock_bot.repository.set_forwarding_rule_active = AsyncMock(return_value=False)

        await cog.forward_pause.callback(
            cog, interaction, source=mock_source, destination=mock_dest
        )

        call_args = interaction.followup.send.call_args
        assert "No forwarding rule found" in call_args[0][0]

    async def test_forward_pause_not_in_guild(self, cog, mock_bot):
        interaction = make_interaction(in_guild=False)
        source = make_channel(111, "#source")
        dest = make_channel(222, "#dest")

        await cog.forward_pause.callback(cog, interaction, source=source, destination=dest)

        mock_bot.repository.set_forwarding_rule_active.assert_not_called()
        assert "server" in interaction.followup.send.call_args.args[0]

    async def test_forward_resume_not_in_guild(self, cog, mock_bot):
        interaction = make_interaction(in_guild=False)
        source = make_channel(111, "#source")
        dest = make_channel(222, "#dest")

        await cog.forward_resume.callback(cog, interaction, source=source, destination=dest)

        mock_bot.repository.set_forwarding_rule_active.assert_not_called()
        assert "server" in interaction.followup.send.call_args.args[0]

    async def test_forward_resume_not_found(self, cog, mock_bot):
        interaction = make_interaction()
        source = make_channel(111, "#source")
        dest = make_channel(222, "#dest")
        mock_bot.repository.set_forwarding_rule_active = AsyncMock(return_value=False)

        await cog.forward_resume.callback(cog, interaction, source=source, destination=dest)

        assert "No forwarding rule found" in interaction.followup.send.call_args.args[0]


class TestOnMessage:
    async def test_on_message_forwards_to_matching_rule(self, cog, mock_bot):
        mock_rule = MagicMock()
        mock_rule.id = "rule-123"
        mock_rule.destination_channel_id = "222"
        mock_rule.destination_type = "channel"
        mock_rule.is_active = True

        cog._rules_cache = {"111": [mock_rule]}

        mock_forwarded = MagicMock(spec=discord.Message)
        cog.forwarder.forward_message = AsyncMock(return_value=mock_forwarded)
        mock_bot.repository.increment_forwarding_count = AsyncMock()

        mock_other_user = MagicMock()
        mock_other_user.id = 123

        message = MagicMock(spec=discord.Message)
        message.author = mock_other_user
        message.guild = MagicMock()
        message.channel = MagicMock()
        message.channel.id = 111

        await cog.on_message(message)

        cog.forwarder.forward_message.assert_called_once_with(
            message=message,
            destination_id=222,
            destination_type="channel",
        )
        mock_bot.repository.increment_forwarding_count.assert_called_once_with("rule-123")

    async def test_on_message_ignores_bot_messages(self, cog, mock_bot):
        cog._rules_cache = {"111": [MagicMock()]}
        cog.forwarder.forward_message = AsyncMock()

        message = MagicMock(spec=discord.Message)
        message.author = mock_bot.user
        message.guild = MagicMock()
        message.channel = MagicMock()
        message.channel.id = 111

        await cog.on_message(message)

        cog.forwarder.forward_message.assert_not_called()

    async def test_on_message_ignores_dms(self, cog):
        cog._rules_cache = {"111": [MagicMock()]}
        cog.forwarder.forward_message = AsyncMock()

        message = MagicMock(spec=discord.Message)
        message.author = MagicMock()
        message.guild = None
        message.channel = MagicMock()
        message.channel.id = 111

        await cog.on_message(message)

        cog.forwarder.forward_message.assert_not_called()

    async def test_on_message_no_matching_rules(self, cog):
        cog._rules_cache = {}
        cog.forwarder.forward_message = AsyncMock()

        message = MagicMock(spec=discord.Message)
        message.author = MagicMock()
        message.guild = MagicMock()
        message.channel = MagicMock()
        message.channel.id = 999

        await cog.on_message(message)

        cog.forwarder.forward_message.assert_not_called()

    async def test_on_message_does_not_increment_on_failure(self, cog, mock_bot):
        mock_rule = MagicMock()
        mock_rule.id = "rule-123"
        mock_rule.destination_channel_id = "222"
        mock_rule.destination_type = "channel"

        cog._rules_cache = {"111": [mock_rule]}
        cog.forwarder.forward_message = AsyncMock(return_value=None)
        mock_bot.repository.increment_forwarding_count = AsyncMock()

        message = MagicMock(spec=discord.Message)
        message.author = MagicMock()
        message.guild = MagicMock()
        message.channel = MagicMock()
        message.channel.id = 111

        await cog.on_message(message)

        mock_bot.repository.increment_forwarding_count.assert_not_called()

    async def test_on_message_forwards_to_all_matching_rules(self, cog, mock_bot):
        rule_1 = MagicMock()
        rule_1.id = "rule-1"
        rule_1.destination_channel_id = "222"
        rule_1.destination_type = "channel"
        rule_2 = MagicMock()
        rule_2.id = "rule-2"
        rule_2.destination_channel_id = "333"
        rule_2.destination_type = "thread"
        cog._rules_cache = {"111": [rule_1, rule_2]}
        cog.forwarder.forward_message = AsyncMock(side_effect=[MagicMock(), MagicMock()])
        mock_bot.repository.increment_forwarding_count = AsyncMock()

        message = MagicMock(spec=discord.Message)
        message.author = MagicMock()
        message.guild = MagicMock()
        message.channel = MagicMock()
        message.channel.id = 111

        await cog.on_message(message)

        assert cog.forwarder.forward_message.await_count == 2
        mock_bot.repository.increment_forwarding_count.assert_any_await("rule-1")
        mock_bot.repository.increment_forwarding_count.assert_any_await("rule-2")


class TestCacheRefresh:
    async def test_on_ready_refreshes_cache(self, cog):
        cog._refresh_cache = AsyncMock()

        await cog.on_ready()

        cog._refresh_cache.assert_awaited_once()

    async def test_refresh_cache_loads_active_rules(self, cog, mock_bot):
        mock_rule = MagicMock()
        mock_rule.source_channel_id = "111"
        mock_rule.is_active = True

        mock_guild = MagicMock()
        mock_guild.id = 456
        mock_bot.guilds = [mock_guild]

        mock_bot.repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[mock_rule])

        await cog._refresh_cache()

        assert "111" in cog._rules_cache
        assert len(cog._rules_cache["111"]) == 1

    async def test_refresh_cache_excludes_inactive_rules(self, cog, mock_bot):
        mock_rule = MagicMock()
        mock_rule.source_channel_id = "111"
        mock_rule.is_active = False

        mock_guild = MagicMock()
        mock_guild.id = 456
        mock_bot.guilds = [mock_guild]

        mock_bot.repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[mock_rule])

        await cog._refresh_cache()

        assert "111" not in cog._rules_cache

    async def test_refresh_cache_groups_multiple_active_rules_for_same_source(
        self, cog, mock_bot
    ):
        rule_1 = MagicMock()
        rule_1.source_channel_id = "111"
        rule_1.is_active = True
        rule_2 = MagicMock()
        rule_2.source_channel_id = "111"
        rule_2.is_active = True
        mock_guild = MagicMock()
        mock_guild.id = 456
        mock_bot.guilds = [mock_guild]
        mock_bot.repository.get_forwarding_rules_for_guild = AsyncMock(
            return_value=[rule_1, rule_2]
        )

        await cog._refresh_cache()

        assert cog._rules_cache["111"] == [rule_1, rule_2]


class TestForwardingErrors:
    async def test_forward_add_missing_permissions_message(self, cog):
        interaction = make_interaction()

        await cog.forward_add_error(
            interaction,
            app_commands.MissingPermissions(["manage_guild"]),
        )

        assert "add forwarding rules" in interaction.response.send_message.call_args.args[0]

    async def test_forward_add_non_permission_error_is_reraised(self, cog):
        interaction = make_interaction()
        error = app_commands.AppCommandError("boom")

        with pytest.raises(app_commands.AppCommandError):
            await cog.forward_add_error(interaction, error)

    async def test_forward_remove_missing_permissions_message(self, cog):
        interaction = make_interaction()

        await cog.forward_remove_error(
            interaction,
            app_commands.MissingPermissions(["manage_guild"]),
        )

        assert "remove forwarding rules" in interaction.response.send_message.call_args.args[0]

    async def test_forward_remove_non_permission_error_is_reraised(self, cog):
        interaction = make_interaction()
        error = app_commands.AppCommandError("boom")

        with pytest.raises(app_commands.AppCommandError):
            await cog.forward_remove_error(interaction, error)

    async def test_forward_pause_missing_permissions_message(self, cog):
        interaction = make_interaction()

        await cog.forward_pause_error(
            interaction,
            app_commands.MissingPermissions(["manage_guild"]),
        )

        assert "pause forwarding rules" in interaction.response.send_message.call_args.args[0]

    async def test_forward_pause_non_permission_error_is_reraised(self, cog):
        interaction = make_interaction()
        error = app_commands.AppCommandError("boom")

        with pytest.raises(app_commands.AppCommandError):
            await cog.forward_pause_error(interaction, error)

    async def test_forward_resume_missing_permissions_message(self, cog):
        interaction = make_interaction()

        await cog.forward_resume_error(
            interaction,
            app_commands.MissingPermissions(["manage_guild"]),
        )

        assert "resume forwarding rules" in interaction.response.send_message.call_args.args[0]

    async def test_forward_resume_non_permission_error_is_reraised(self, cog):
        interaction = make_interaction()
        error = app_commands.AppCommandError("boom")

        with pytest.raises(app_commands.AppCommandError):
            await cog.forward_resume_error(interaction, error)


class TestSetup:
    async def test_setup_adds_message_forwarding_cog(self, mock_bot):
        mock_bot.add_cog = AsyncMock()

        await setup(mock_bot)

        mock_bot.add_cog.assert_awaited_once()
        assert isinstance(mock_bot.add_cog.call_args.args[0], MessageForwarding)
