from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import discord
import pytest
from discord import app_commands
from discord.ext import commands

from intelstream.bot import CoreCommands, IntelStreamBot, RestrictedCommandTree, create_bot, run_bot
from intelstream.config import Settings
from intelstream.database.models import PauseReason, SourceType


@pytest.fixture
def mock_settings() -> Settings:
    with patch.dict(
        "os.environ",
        {
            "DISCORD_BOT_TOKEN": "test_token",
            "DISCORD_GUILD_ID": "123456789",
            "DISCORD_CHANNEL_ID": "987654321",
            "DISCORD_OWNER_ID": "111222333",
            "ANTHROPIC_API_KEY": "sk-ant-test",
            "DATABASE_URL": "sqlite+aiosqlite:///:memory:",
        },
    ):
        return Settings()


def make_command_interaction(guild_id: int | None = 123456789) -> MagicMock:
    interaction = MagicMock(spec=discord.Interaction)
    interaction.user = MagicMock()
    interaction.user.id = 12345
    interaction.guild_id = guild_id
    interaction.response = MagicMock()
    interaction.response.defer = AsyncMock()
    interaction.response.send_message = AsyncMock()
    interaction.followup = MagicMock()
    interaction.followup.send = AsyncMock()
    return interaction


class TestIntelStreamBot:
    async def test_create_bot(self, mock_settings: Settings) -> None:
        bot = await create_bot(mock_settings)

        assert isinstance(bot, IntelStreamBot)
        assert bot.settings == mock_settings
        assert bot.repository is not None

        await bot.repository.close()

    async def test_bot_has_correct_intents(self, mock_settings: Settings) -> None:
        bot = await create_bot(mock_settings)

        assert bot.intents.message_content is True
        assert bot.allowed_mentions.to_dict() == discord.AllowedMentions.none().to_dict()

        await bot.repository.close()

    async def test_notify_owner_without_owner_set(self, mock_settings: Settings) -> None:
        bot = await create_bot(mock_settings)
        bot._owner = None

        mock_response = AsyncMock()
        mock_response.status = 404
        error = discord.NotFound(mock_response, "User not found")
        bot.fetch_user = AsyncMock(side_effect=error)

        await bot.notify_owner("Test message")

        await bot.repository.close()

    async def test_notify_owner_fetches_owner_and_sends_alert(
        self, mock_settings: Settings
    ) -> None:
        bot = await create_bot(mock_settings)
        mock_owner = MagicMock(spec=discord.User)
        mock_owner.send = AsyncMock()
        bot.fetch_user = AsyncMock(return_value=mock_owner)

        await bot.notify_owner("Important message")

        bot.fetch_user.assert_awaited_once_with(mock_settings.discord_owner_id)
        mock_owner.send.assert_awaited_once_with("**IntelStream Alert**\nImportant message")

        await bot.repository.close()

    async def test_notify_owner_truncates_long_message(self, mock_settings: Settings) -> None:
        bot = await create_bot(mock_settings)
        mock_owner = MagicMock(spec=discord.User)
        mock_owner.send = AsyncMock()
        bot._owner = mock_owner

        await bot.notify_owner("x" * 2500)

        sent_message = mock_owner.send.await_args.args[0]
        assert sent_message.startswith("**IntelStream Alert**\n")
        assert sent_message.endswith("... (truncated)")
        assert len(sent_message) < 2000

        await bot.repository.close()

    async def test_notify_owner_resets_cached_owner_on_not_found(
        self, mock_settings: Settings
    ) -> None:
        bot = await create_bot(mock_settings)
        mock_owner = MagicMock(spec=discord.User)
        mock_response = MagicMock()
        mock_response.status = 404
        mock_owner.send = AsyncMock(side_effect=discord.NotFound(mock_response, "missing"))
        bot._owner = mock_owner

        await bot.notify_owner("hello")

        assert bot._owner is None

        await bot.repository.close()

    async def test_notify_owner_handles_forbidden_and_http_exception(
        self, mock_settings: Settings
    ) -> None:
        bot = await create_bot(mock_settings)
        mock_response = MagicMock()
        mock_response.status = 403

        forbidden_owner = MagicMock(spec=discord.User)
        forbidden_owner.send = AsyncMock(side_effect=discord.Forbidden(mock_response, "forbidden"))
        bot._owner = forbidden_owner
        await bot.notify_owner("forbidden")

        http_owner = MagicMock(spec=discord.User)
        mock_response.status = 500
        http_owner.send = AsyncMock(side_effect=discord.HTTPException(mock_response, "http"))
        bot._owner = http_owner
        await bot.notify_owner("http")

        forbidden_owner.send.assert_awaited_once()
        http_owner.send.assert_awaited_once()

        await bot.repository.close()

    async def test_setup_search_initializes_search_services(self, mock_settings: Settings) -> None:
        bot = await create_bot(mock_settings)
        bot.add_cog = AsyncMock()

        with (
            patch("intelstream.services.embedding_service.EmbeddingService") as embedding_cls,
            patch("intelstream.database.vector_store.VectorStore") as vector_store_cls,
            patch("intelstream.discord.cogs.search.Search", return_value="search-cog"),
            patch("intelstream.discord.cogs.lore.Lore", return_value="lore-cog"),
        ):
            embedding = embedding_cls.return_value
            embedding.initialize = AsyncMock()
            vector_store = vector_store_cls.return_value
            vector_store.initialize = AsyncMock()

            await bot._setup_search()

        assert bot.embedding_service == embedding
        assert bot.vector_store == vector_store
        embedding.initialize.assert_awaited_once()
        vector_store.initialize.assert_awaited_once()
        assert [call.args[0] for call in bot.add_cog.await_args_list] == [
            "search-cog",
            "lore-cog",
        ]

        await bot.repository.close()

    async def test_setup_search_clears_services_when_initialization_fails(
        self, mock_settings: Settings
    ) -> None:
        bot = await create_bot(mock_settings)
        bot.add_cog = AsyncMock()

        with patch("intelstream.services.embedding_service.EmbeddingService") as embedding_cls:
            embedding_cls.return_value.initialize = AsyncMock(side_effect=RuntimeError("boom"))

            await bot._setup_search()

        assert bot.embedding_service is None
        assert bot.vector_store is None
        bot.add_cog.assert_not_awaited()

        await bot.repository.close()

    async def test_setup_hook_initializes_repository_registers_cogs_and_syncs(
        self, mock_settings: Settings, tmp_path
    ) -> None:
        repository = MagicMock()
        repository.initialize = AsyncMock()
        repository.migrate_sources_to_channel = AsyncMock(return_value=2)
        bot = IntelStreamBot(mock_settings, repository)
        bot.add_cog = AsyncMock()
        bot._setup_search = AsyncMock()
        bot.tree.copy_global_to = MagicMock()
        bot.tree.sync = AsyncMock()

        with (
            patch("intelstream.bot.get_database_directory", return_value=tmp_path / "db"),
            patch("intelstream.discord.cogs.Hands", return_value="hands-cog"),
            patch("intelstream.discord.cogs.SourceManagement", return_value="source-cog"),
            patch("intelstream.discord.cogs.ConfigManagement", return_value="config-cog"),
            patch("intelstream.discord.cogs.ContentPosting", return_value="posting-cog"),
            patch("intelstream.discord.cogs.Summarize", return_value="summarize-cog"),
            patch("intelstream.discord.cogs.ChannelSummary", return_value="summary-cog"),
            patch("intelstream.discord.cogs.SuckBoobs", return_value="suck-cog"),
            patch("intelstream.discord.cogs.github.GitHubCommands", return_value="github-cog"),
            patch(
                "intelstream.discord.cogs.github_polling.GitHubPolling",
                return_value="github-polling-cog",
            ),
            patch(
                "intelstream.discord.cogs.message_forwarding.MessageForwarding",
                return_value="forward-cog",
            ),
        ):
            await bot.setup_hook()

        repository.initialize.assert_awaited_once()
        repository.migrate_sources_to_channel.assert_awaited_once_with(
            guild_id=str(mock_settings.discord_guild_id),
            channel_id=str(mock_settings.discord_channel_id),
        )
        bot._setup_search.assert_awaited_once()
        assert len(bot.add_cog.await_args_list) == 11
        assert isinstance(bot.add_cog.await_args_list[0].args[0], CoreCommands)
        assert bot.add_cog.await_args_list[1].args[0] == "hands-cog"
        assert (tmp_path / "db").exists()
        bot.tree.copy_global_to.assert_called_once()
        bot.tree.sync.assert_awaited_once()

        await commands.Bot.close(bot)

    async def test_setup_hook_skips_migration_and_search_when_disabled(
        self, mock_settings: Settings
    ) -> None:
        settings = mock_settings.model_copy(
            update={"discord_channel_id": None, "search_enabled": False}
        )
        repository = MagicMock()
        repository.initialize = AsyncMock()
        repository.migrate_sources_to_channel = AsyncMock()
        bot = IntelStreamBot(settings, repository)
        bot.add_cog = AsyncMock()
        bot._setup_search = AsyncMock()
        bot.tree.copy_global_to = MagicMock()
        bot.tree.sync = AsyncMock()

        with (
            patch("intelstream.bot.get_database_directory", return_value=None),
            patch("intelstream.discord.cogs.Hands", return_value="hands-cog"),
            patch("intelstream.discord.cogs.SourceManagement", return_value="source-cog"),
            patch("intelstream.discord.cogs.ConfigManagement", return_value="config-cog"),
            patch("intelstream.discord.cogs.ContentPosting", return_value="posting-cog"),
            patch("intelstream.discord.cogs.Summarize", return_value="summarize-cog"),
            patch("intelstream.discord.cogs.ChannelSummary", return_value="summary-cog"),
            patch("intelstream.discord.cogs.SuckBoobs", return_value="suck-cog"),
            patch("intelstream.discord.cogs.github.GitHubCommands", return_value="github-cog"),
            patch(
                "intelstream.discord.cogs.github_polling.GitHubPolling",
                return_value="github-polling-cog",
            ),
            patch(
                "intelstream.discord.cogs.message_forwarding.MessageForwarding",
                return_value="forward-cog",
            ),
        ):
            await bot.setup_hook()

        repository.migrate_sources_to_channel.assert_not_called()
        bot._setup_search.assert_not_called()

        await commands.Bot.close(bot)

    async def test_setup_hook_migrates_zero_sources_without_logging_branch(
        self, mock_settings: Settings
    ) -> None:
        repository = MagicMock()
        repository.initialize = AsyncMock()
        repository.migrate_sources_to_channel = AsyncMock(return_value=0)
        bot = IntelStreamBot(mock_settings, repository)
        bot.add_cog = AsyncMock()
        bot._setup_search = AsyncMock()
        bot.tree.copy_global_to = MagicMock()
        bot.tree.sync = AsyncMock()

        with (
            patch("intelstream.bot.get_database_directory", return_value=None),
            patch("intelstream.discord.cogs.Hands", return_value="hands-cog"),
            patch("intelstream.discord.cogs.SourceManagement", return_value="source-cog"),
            patch("intelstream.discord.cogs.ConfigManagement", return_value="config-cog"),
            patch("intelstream.discord.cogs.ContentPosting", return_value="posting-cog"),
            patch("intelstream.discord.cogs.Summarize", return_value="summarize-cog"),
            patch("intelstream.discord.cogs.ChannelSummary", return_value="summary-cog"),
            patch("intelstream.discord.cogs.SuckBoobs", return_value="suck-cog"),
            patch("intelstream.discord.cogs.github.GitHubCommands", return_value="github-cog"),
            patch(
                "intelstream.discord.cogs.github_polling.GitHubPolling",
                return_value="github-polling-cog",
            ),
            patch(
                "intelstream.discord.cogs.message_forwarding.MessageForwarding",
                return_value="forward-cog",
            ),
        ):
            await bot.setup_hook()

        repository.migrate_sources_to_channel.assert_awaited_once()
        bot._setup_search.assert_awaited_once()

        await commands.Bot.close(bot)

    async def test_on_ready_sets_owner_and_starts_lore_ingestion(
        self, mock_settings: Settings
    ) -> None:
        bot = MagicMock()
        bot.user = MagicMock()
        bot.user.id = 555
        bot.settings = mock_settings
        owner = MagicMock(spec=discord.User)
        bot.fetch_user = AsyncMock(return_value=owner)
        lore_cog = MagicMock()
        lore_cog.auto_start_ingestion = AsyncMock()
        bot.cogs = {"Lore": lore_cog}
        bot._owner = None
        bot.start_time = None

        await IntelStreamBot.on_ready(bot)
        first_start_time = bot.start_time
        await IntelStreamBot.on_ready(bot)

        assert bot.start_time is first_start_time
        assert bot._owner is owner
        assert lore_cog.auto_start_ingestion.await_count == 2
        bot.fetch_user.assert_awaited_once_with(mock_settings.discord_owner_id)

    async def test_on_ready_handles_missing_owner_and_lore_start_failure(
        self, mock_settings: Settings
    ) -> None:
        bot = MagicMock()
        bot.user = None
        bot.settings = mock_settings
        response = MagicMock()
        response.status = 404
        bot.fetch_user = AsyncMock(side_effect=discord.NotFound(response, "missing"))
        lore_cog = MagicMock()
        lore_cog.auto_start_ingestion = AsyncMock(side_effect=RuntimeError("boom"))
        bot.cogs = {"Lore": lore_cog}
        bot._owner = None
        bot.start_time = None

        await IntelStreamBot.on_ready(bot)

        assert bot.start_time is not None
        assert bot._owner is None
        lore_cog.auto_start_ingestion.assert_awaited_once()

    async def test_on_ready_without_lore_cog_only_sets_owner(self, mock_settings: Settings) -> None:
        bot = MagicMock()
        bot.user = MagicMock()
        bot.user.id = 555
        bot.settings = mock_settings
        owner = MagicMock(spec=discord.User)
        bot.fetch_user = AsyncMock(return_value=owner)
        bot.cogs = {}
        bot._owner = None
        bot.start_time = None

        await IntelStreamBot.on_ready(bot)

        assert bot.start_time is not None
        assert bot._owner is owner

    async def test_on_ready_retries_lore_start_after_transient_failure(
        self, mock_settings: Settings
    ) -> None:
        bot = MagicMock()
        bot.user = None
        bot.settings = mock_settings
        bot.fetch_user = AsyncMock(return_value=MagicMock(spec=discord.User))
        lore_cog = MagicMock()
        lore_cog.auto_start_ingestion = AsyncMock(
            side_effect=[RuntimeError("temporary failure"), None]
        )
        bot.cogs = {"Lore": lore_cog}
        bot._owner = MagicMock(spec=discord.User)
        bot.start_time = None

        await IntelStreamBot.on_ready(bot)
        await IntelStreamBot.on_ready(bot)

        assert lore_cog.auto_start_ingestion.await_count == 2

    async def test_on_error_notifies_owner(self) -> None:
        bot = MagicMock()
        bot.notify_owner = AsyncMock()

        await IntelStreamBot.on_error(bot, "on_message")

        bot.notify_owner.assert_awaited_once_with("Error in on_message. Check logs for details.")

    async def test_close_unloads_cogs_and_closes_resources(self, mock_settings: Settings) -> None:
        repository = MagicMock()
        repository.close = AsyncMock(side_effect=RuntimeError("repo close failed"))
        bot = IntelStreamBot(mock_settings, repository)
        bot.remove_cog = AsyncMock(
            side_effect=[None, TimeoutError(), RuntimeError("remove failed")]
        )
        bot.vector_store = MagicMock()
        bot.vector_store.close = AsyncMock(side_effect=TimeoutError())

        with (
            patch.object(
                IntelStreamBot,
                "cogs",
                new_callable=PropertyMock,
                return_value={"a": object(), "b": object(), "c": object()},
            ),
            patch.object(commands.Bot, "close", AsyncMock()) as super_close,
        ):
            await bot.close()

        assert bot.remove_cog.await_count == 3
        bot.vector_store.close.assert_awaited_once()
        repository.close.assert_awaited_once()
        super_close.assert_awaited_once()

    async def test_close_continues_when_total_cog_unload_times_out(
        self, mock_settings: Settings
    ) -> None:
        repository = MagicMock()
        repository.close = AsyncMock()
        bot = IntelStreamBot(mock_settings, repository)
        bot.vector_store = None

        async def fake_wait_for(awaitable, **kwargs):
            timeout = kwargs["timeout"]
            if timeout == 30.0:
                awaitable.close()
                raise TimeoutError
            return await awaitable

        with (
            patch("intelstream.bot.asyncio.wait_for", side_effect=fake_wait_for),
            patch.object(commands.Bot, "close", AsyncMock()) as super_close,
        ):
            await bot.close()

        repository.close.assert_awaited_once()
        super_close.assert_awaited_once()

    async def test_close_logs_vector_error_and_repository_timeout(
        self, mock_settings: Settings
    ) -> None:
        repository = MagicMock()
        repository.close = AsyncMock(side_effect=TimeoutError())
        bot = IntelStreamBot(mock_settings, repository)
        bot.vector_store = MagicMock()
        bot.vector_store.close = AsyncMock(side_effect=RuntimeError("vector failed"))

        with patch.object(commands.Bot, "close", AsyncMock()) as super_close:
            await bot.close()

        bot.vector_store.close.assert_awaited_once()
        repository.close.assert_awaited_once()
        super_close.assert_awaited_once()

    async def test_run_bot_starts_and_closes_bot(self, mock_settings: Settings) -> None:
        bot = MagicMock()
        bot.start = AsyncMock()
        bot.close = AsyncMock()

        with patch("intelstream.bot.create_bot", AsyncMock(return_value=bot)):
            await run_bot(mock_settings)

        bot.start.assert_awaited_once_with(mock_settings.discord_token)
        bot.close.assert_awaited_once()

    async def test_run_bot_closes_bot_when_start_fails(self, mock_settings: Settings) -> None:
        bot = MagicMock()
        bot.start = AsyncMock(side_effect=RuntimeError("login failed"))
        bot.close = AsyncMock()

        with (
            patch("intelstream.bot.create_bot", AsyncMock(return_value=bot)),
            pytest.raises(RuntimeError, match="login failed"),
        ):
            await run_bot(mock_settings)

        bot.close.assert_awaited_once()


class TestRestrictedCommandTreeInteractionCheck:
    async def test_rejects_when_client_is_not_intelstream_bot(self) -> None:
        tree = MagicMock()
        tree.client = object()

        assert await RestrictedCommandTree.interaction_check(tree, MagicMock()) is False

    async def test_rejects_commands_outside_allowed_channel(self, mock_settings: Settings) -> None:
        bot = await create_bot(mock_settings)
        interaction = MagicMock(spec=discord.Interaction)
        interaction.channel_id = mock_settings.discord_channel_id + 1
        interaction.response.send_message = AsyncMock()

        allowed = await bot.tree.interaction_check(interaction)

        assert allowed is False
        interaction.response.send_message.assert_awaited_once_with(
            f"Commands can only be used in <#{mock_settings.discord_channel_id}>",
            ephemeral=True,
        )

        await bot.repository.close()

    @pytest.mark.parametrize("command_name", ["hands", "hands_scoreboard"])
    async def test_hands_commands_bypass_legacy_channel_restriction(
        self, mock_settings: Settings, command_name: str
    ) -> None:
        bot = await create_bot(mock_settings)
        interaction = MagicMock(spec=discord.Interaction)
        interaction.command = MagicMock()
        interaction.command.name = command_name
        interaction.channel_id = mock_settings.discord_channel_id + 1
        interaction.response.send_message = AsyncMock()

        allowed = await bot.tree.interaction_check(interaction)

        assert allowed is True
        interaction.response.send_message.assert_not_awaited()
        await bot.repository.close()

    async def test_allows_commands_in_allowed_channel(self, mock_settings: Settings) -> None:
        bot = await create_bot(mock_settings)
        interaction = MagicMock(spec=discord.Interaction)
        interaction.channel_id = mock_settings.discord_channel_id
        interaction.response.send_message = AsyncMock()

        allowed = await bot.tree.interaction_check(interaction)

        assert allowed is True
        interaction.response.send_message.assert_not_called()

        await bot.repository.close()

    async def test_allows_commands_in_thread_under_allowed_channel(
        self, mock_settings: Settings
    ) -> None:
        bot = await create_bot(mock_settings)
        interaction = MagicMock(spec=discord.Interaction)
        interaction.channel_id = mock_settings.discord_channel_id + 1
        interaction.channel = MagicMock(spec=discord.Thread)
        interaction.channel.parent_id = mock_settings.discord_channel_id
        interaction.response.send_message = AsyncMock()

        allowed = await bot.tree.interaction_check(interaction)

        assert allowed is True
        interaction.response.send_message.assert_not_awaited()

        await bot.repository.close()


class TestRestrictedCommandTreeErrorHandler:
    @pytest.fixture
    def mock_interaction(self) -> MagicMock:
        interaction = MagicMock(spec=discord.Interaction)
        interaction.user = MagicMock()
        interaction.user.id = 123456
        interaction.channel_id = 789012
        interaction.command = MagicMock()
        interaction.command.name = "test_command"
        interaction.response = MagicMock()
        interaction.response.is_done = MagicMock(return_value=False)
        interaction.response.send_message = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        return interaction

    async def test_handles_forbidden_error(self, mock_interaction: MagicMock) -> None:
        mock_response = MagicMock()
        mock_response.status = 403
        error = app_commands.CommandInvokeError(
            mock_interaction.command,
            discord.Forbidden(mock_response, "Missing permissions"),
        )

        await RestrictedCommandTree.on_error(MagicMock(), mock_interaction, error)

        mock_interaction.response.send_message.assert_not_called()
        mock_interaction.followup.send.assert_not_called()

    async def test_handles_not_found_error(self, mock_interaction: MagicMock) -> None:
        mock_response = MagicMock()
        mock_response.status = 404
        error = app_commands.CommandInvokeError(
            mock_interaction.command,
            discord.NotFound(mock_response, "Interaction expired"),
        )

        await RestrictedCommandTree.on_error(MagicMock(), mock_interaction, error)

        mock_interaction.response.send_message.assert_not_called()
        mock_interaction.followup.send.assert_not_called()

    async def test_handles_http_exception_with_response(self, mock_interaction: MagicMock) -> None:
        mock_response = MagicMock()
        mock_response.status = 500
        error = app_commands.CommandInvokeError(
            mock_interaction.command,
            discord.HTTPException(mock_response, "Server error"),
        )

        mock_self = MagicMock()
        mock_self._send_error_response = AsyncMock()

        await RestrictedCommandTree.on_error(mock_self, mock_interaction, error)

        mock_self._send_error_response.assert_called_once()
        args = mock_self._send_error_response.call_args[0]
        assert args[0] == mock_interaction
        assert "Discord error" in args[1]

    async def test_handles_generic_exception(self, mock_interaction: MagicMock) -> None:
        error = app_commands.CommandInvokeError(
            mock_interaction.command,
            ValueError("Something went wrong"),
        )

        mock_self = MagicMock()
        mock_self._send_error_response = AsyncMock()

        await RestrictedCommandTree.on_error(mock_self, mock_interaction, error)

        mock_self._send_error_response.assert_called_once()
        args = mock_self._send_error_response.call_args[0]
        assert args[0] == mock_interaction
        assert "unexpected error" in args[1]

    async def test_handles_direct_app_command_error(self, mock_interaction: MagicMock) -> None:
        error = app_commands.AppCommandError("direct error")
        mock_self = MagicMock()
        mock_self._send_error_response = AsyncMock()

        await RestrictedCommandTree.on_error(mock_self, mock_interaction, error)

        args = mock_self._send_error_response.call_args.args
        assert args[0] == mock_interaction
        assert "unexpected error" in args[1]

    async def test_send_error_response_uses_followup_when_response_done(
        self, mock_interaction: MagicMock
    ) -> None:
        mock_interaction.response.is_done = MagicMock(return_value=True)

        await RestrictedCommandTree._send_error_response(
            MagicMock(), mock_interaction, "Test error message"
        )

        mock_interaction.followup.send.assert_called_once_with("Test error message", ephemeral=True)
        mock_interaction.response.send_message.assert_not_called()

    async def test_send_error_response_uses_response_when_not_done(
        self, mock_interaction: MagicMock
    ) -> None:
        mock_interaction.response.is_done = MagicMock(return_value=False)

        await RestrictedCommandTree._send_error_response(
            MagicMock(), mock_interaction, "Test error message"
        )

        mock_interaction.response.send_message.assert_called_once_with(
            "Test error message", ephemeral=True
        )
        mock_interaction.followup.send.assert_not_called()

    async def test_send_error_response_swallows_http_exception(
        self, mock_interaction: MagicMock
    ) -> None:
        mock_response = MagicMock()
        mock_response.status = 500
        mock_interaction.response.send_message = AsyncMock(
            side_effect=discord.HTTPException(mock_response, "send failed")
        )

        await RestrictedCommandTree._send_error_response(
            MagicMock(), mock_interaction, "Test error message"
        )

        mock_interaction.response.send_message.assert_awaited_once()


class TestCoreCommandsHelpers:
    def test_format_uptime_unknown_without_start_time(self) -> None:
        bot = MagicMock()
        bot.start_time = None
        core = CoreCommands(bot)

        assert core._format_uptime() == "Unknown"

    def test_format_uptime_uses_elapsed_time(self) -> None:
        bot = MagicMock()
        bot.start_time = datetime.now(UTC) - timedelta(hours=1, minutes=2, seconds=3)
        core = CoreCommands(bot)

        assert core._format_uptime().startswith("1h 2m")

    def test_format_relative_time_handles_naive_datetime(self) -> None:
        bot = MagicMock(spec=IntelStreamBot)
        core = CoreCommands(bot)

        assert core._format_relative_time(discord.utils.utcnow().replace(tzinfo=None)) == "just now"

    @pytest.mark.parametrize(
        ("delta", "expected_suffix"),
        [
            (timedelta(minutes=5), "m ago"),
            (timedelta(hours=2), "h ago"),
            (timedelta(days=3), "d ago"),
        ],
    )
    def test_format_relative_time_ranges(self, delta: timedelta, expected_suffix: str) -> None:
        bot = MagicMock(spec=IntelStreamBot)
        core = CoreCommands(bot)

        assert core._format_relative_time(datetime.now(UTC) - delta).endswith(expected_suffix)

    @pytest.mark.parametrize(
        ("is_active", "pause_reason", "failures", "expected"),
        [
            (True, PauseReason.NONE.value, 0, "+"),
            (True, PauseReason.NONE.value, 2, "!"),
            (False, PauseReason.CONSECUTIVE_FAILURES.value, 5, "X"),
            (False, PauseReason.USER_PAUSED.value, 0, "-"),
        ],
    )
    def test_source_status_icons(
        self,
        is_active: bool,
        pause_reason: str,
        failures: int,
        expected: str,
    ) -> None:
        bot = MagicMock(spec=IntelStreamBot)
        core = CoreCommands(bot)
        source = MagicMock()
        source.is_active = is_active
        source.pause_reason = pause_reason
        source.consecutive_failures = failures
        source.type = SourceType.RSS

        assert core._get_source_status_icon(source) == expected


class TestCoreCommandsCommands:
    def _make_source(
        self,
        index: int,
        *,
        is_active: bool = True,
        failures: int = 0,
        channel_id: str | None = "222",
        guild_id: str = "123456789",
    ) -> MagicMock:
        source = MagicMock()
        source.name = f"Source {index}"
        source.type = SourceType.RSS
        source.channel_id = channel_id
        source.guild_id = guild_id
        source.is_active = is_active
        source.consecutive_failures = failures
        source.pause_reason = PauseReason.NONE.value
        return source

    def _make_rule(self, index: int, *, is_active: bool = True) -> MagicMock:
        rule = MagicMock()
        rule.is_active = is_active
        rule.source_channel_id = str(100 + index)
        rule.destination_channel_id = str(200 + index)
        rule.messages_forwarded = index
        return rule

    async def test_status_builds_full_embed_with_sources_rules_and_default_config(self) -> None:
        bot = MagicMock()
        bot.latency = 0.123
        bot.start_time = datetime.now(UTC) - timedelta(minutes=5)
        bot.settings.content_poll_interval_minutes = 7
        repository = AsyncMock()
        sources = [self._make_source(i, failures=1 if i == 0 else 0) for i in range(9)]
        sources[1].is_active = False
        sources[1].pause_reason = PauseReason.USER_PAUSED.value
        repository.get_all_sources = AsyncMock(return_value=sources)
        repository.get_content_stats = AsyncMock(
            return_value={"total_fetched": 12, "total_posted": 8}
        )
        repository.get_last_posted_content = AsyncMock(
            return_value=MagicMock(created_at=datetime.now(UTC) - timedelta(hours=2))
        )
        repository.get_forwarding_rules_for_guild = AsyncMock(
            return_value=[self._make_rule(i, is_active=i % 2 == 0) for i in range(6)]
        )
        repository.get_discord_config = AsyncMock(return_value=MagicMock(channel_id="999"))
        bot.repository = repository
        core = CoreCommands(bot)
        interaction = make_command_interaction()

        await core.status.callback(core, interaction)

        interaction.response.defer.assert_awaited_once_with()
        embed = interaction.followup.send.await_args.kwargs["embed"]
        assert embed.title == "IntelStream Status"
        field_names = [field.name for field in embed.fields]
        assert "System" in field_names
        assert "Content" in field_names
        assert "Configured Sources" in field_names
        assert "Forwarding Rules (3 active)" in field_names
        assert "Default Output" in field_names
        configured = next(
            field.value for field in embed.fields if field.name == "Configured Sources"
        )
        assert "*... and 1 more*" in configured
        forwarding = next(
            field.value for field in embed.fields if field.name.startswith("Forwarding")
        )
        assert "*... and 1 more*" in forwarding
        repository.get_content_stats.assert_awaited_once_with(str(interaction.guild_id))

    async def test_status_handles_dm_with_no_optional_sections(self) -> None:
        bot = MagicMock()
        bot.latency = 0
        bot.start_time = None
        bot.settings.content_poll_interval_minutes = 5
        repository = AsyncMock()
        repository.get_all_sources = AsyncMock(return_value=[])
        repository.get_content_stats = AsyncMock(
            return_value={"total_fetched": 0, "total_posted": 0}
        )
        repository.get_last_posted_content = AsyncMock(return_value=None)
        repository.get_forwarding_rules_for_guild = AsyncMock()
        repository.get_discord_config = AsyncMock()
        bot.repository = repository
        core = CoreCommands(bot)
        interaction = make_command_interaction(guild_id=None)

        await core.status.callback(core, interaction)

        interaction.response.defer.assert_awaited_once_with()
        embed = interaction.followup.send.await_args.kwargs["embed"]
        assert embed.title == "IntelStream Status"
        assert all(field.name != "Configured Sources" for field in embed.fields)
        repository.get_forwarding_rules_for_guild.assert_not_called()
        repository.get_discord_config.assert_not_called()

    async def test_status_single_source_and_rule_has_no_overflow_rows(self) -> None:
        bot = MagicMock()
        bot.latency = 0
        bot.start_time = datetime.now(UTC)
        bot.settings.content_poll_interval_minutes = 5
        repository = AsyncMock()
        repository.get_all_sources = AsyncMock(return_value=[self._make_source(1)])
        repository.get_content_stats = AsyncMock(
            return_value={"total_fetched": 1, "total_posted": 1}
        )
        repository.get_last_posted_content = AsyncMock(return_value=None)
        repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[self._make_rule(1)])
        repository.get_discord_config = AsyncMock(return_value=None)
        bot.repository = repository
        core = CoreCommands(bot)
        interaction = make_command_interaction()

        await core.status.callback(core, interaction)

        embed = interaction.followup.send.await_args.kwargs["embed"]
        configured = next(
            field.value for field in embed.fields if field.name == "Configured Sources"
        )
        forwarding = next(
            field.value for field in embed.fields if field.name.startswith("Forwarding")
        )
        assert "*... and" not in configured
        assert "*... and" not in forwarding

    async def test_status_filters_sources_to_interaction_guild(self) -> None:
        bot = MagicMock()
        bot.latency = 0
        bot.start_time = datetime.now(UTC)
        bot.settings.content_poll_interval_minutes = 5
        repository = AsyncMock()
        repository.get_all_sources = AsyncMock(
            return_value=[self._make_source(1), self._make_source(2, guild_id="other-guild")]
        )
        repository.get_content_stats = AsyncMock(
            return_value={"total_fetched": 1, "total_posted": 1}
        )
        repository.get_last_posted_content = AsyncMock(return_value=None)
        repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[])
        repository.get_discord_config = AsyncMock(return_value=None)
        bot.repository = repository
        core = CoreCommands(bot)
        interaction = make_command_interaction()

        await core.status.callback(core, interaction)

        embed = interaction.followup.send.await_args.kwargs["embed"]
        configured = next(
            field.value for field in embed.fields if field.name == "Configured Sources"
        )
        assert "Source 1" in configured
        assert "Source 2" not in configured

    async def test_status_bounds_long_source_field(self) -> None:
        bot = MagicMock()
        bot.latency = 0
        bot.start_time = datetime.now(UTC)
        bot.settings.content_poll_interval_minutes = 5
        repository = AsyncMock()
        sources = [self._make_source(i) for i in range(8)]
        for source in sources:
            source.name = "x" * 255
        repository.get_all_sources = AsyncMock(return_value=sources)
        repository.get_content_stats = AsyncMock(
            return_value={"total_fetched": 1, "total_posted": 1}
        )
        repository.get_last_posted_content = AsyncMock(return_value=None)
        repository.get_forwarding_rules_for_guild = AsyncMock(return_value=[])
        repository.get_discord_config = AsyncMock(return_value=None)
        bot.repository = repository
        core = CoreCommands(bot)
        interaction = make_command_interaction()

        await core.status.callback(core, interaction)

        embed = interaction.followup.send.await_args.kwargs["embed"]
        configured = next(
            field.value for field in embed.fields if field.name == "Configured Sources"
        )
        assert len(configured) <= 1024
        assert "more" in configured

    async def test_ping_sends_latency(self) -> None:
        bot = MagicMock(spec=IntelStreamBot)
        bot.latency = 0.045
        core = CoreCommands(bot)
        interaction = make_command_interaction()

        await core.ping.callback(core, interaction)

        interaction.response.send_message.assert_awaited_once_with("Pong! Latency: 45ms")
