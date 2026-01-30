from unittest.mock import AsyncMock, MagicMock

import discord
import pytest

from intelstream.discord.cogs.message_forwarding import MessageForwarding


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


class TestCacheRefresh:
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
