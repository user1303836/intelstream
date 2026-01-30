from unittest.mock import AsyncMock, MagicMock

import discord
import pytest

from intelstream.services.message_forwarder import MessageForwarder


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.guilds = []
    bot.get_channel = MagicMock(return_value=None)
    return bot


@pytest.fixture
def forwarder(mock_bot):
    return MessageForwarder(mock_bot)


class TestBuildForwardedContent:
    def test_build_content_with_text(self, forwarder):
        message = MagicMock(spec=discord.Message)
        message.content = "Hello world!"

        content = forwarder._build_forwarded_content(message)

        assert content == "Hello world!"

    def test_build_content_with_bot_author(self, forwarder):
        message = MagicMock(spec=discord.Message)
        message.content = "Breaking news!"

        content = forwarder._build_forwarded_content(message)

        assert content == "Breaking news!"

    def test_build_content_without_text(self, forwarder):
        message = MagicMock(spec=discord.Message)
        message.content = ""

        content = forwarder._build_forwarded_content(message)

        assert content == ""


class TestGetDestination:
    async def test_get_channel_destination(self, forwarder, mock_bot):
        mock_channel = MagicMock(spec=discord.TextChannel)
        mock_bot.get_channel = MagicMock(return_value=mock_channel)

        result = await forwarder._get_destination(12345, "channel")

        assert result == mock_channel
        mock_bot.get_channel.assert_called_once_with(12345)

    async def test_get_thread_destination_from_channel(self, forwarder, mock_bot):
        mock_thread = MagicMock(spec=discord.Thread)
        mock_bot.get_channel = MagicMock(return_value=mock_thread)

        result = await forwarder._get_destination(12345, "thread")

        assert result == mock_thread

    async def test_get_thread_destination_from_guild(self, forwarder, mock_bot):
        mock_thread = MagicMock(spec=discord.Thread)
        mock_guild = MagicMock()
        mock_guild.get_thread = MagicMock(return_value=mock_thread)
        mock_bot.guilds = [mock_guild]
        mock_bot.get_channel = MagicMock(return_value=None)

        result = await forwarder._get_destination(12345, "thread")

        assert result == mock_thread
        mock_guild.get_thread.assert_called_once_with(12345)

    async def test_get_destination_not_found(self, forwarder, mock_bot):
        mock_guild = MagicMock()
        mock_guild.id = 123456
        mock_guild.get_thread = MagicMock(return_value=None)
        mock_guild.fetch_channel = AsyncMock(side_effect=discord.NotFound(MagicMock(), "Not found"))
        mock_bot.guilds = [mock_guild]
        mock_bot.get_channel = MagicMock(return_value=None)

        result = await forwarder._get_destination(99999, "thread")

        assert result is None

    async def test_get_thread_destination_via_api_fetch(self, forwarder, mock_bot):
        mock_thread = MagicMock(spec=discord.Thread)
        mock_thread.name = "test-thread"
        mock_thread.archived = False
        mock_guild = MagicMock()
        mock_guild.id = 123456
        mock_guild.get_thread = MagicMock(return_value=None)
        mock_guild.fetch_channel = AsyncMock(return_value=mock_thread)
        mock_bot.guilds = [mock_guild]
        mock_bot.get_channel = MagicMock(return_value=None)

        result = await forwarder._get_destination(12345, "thread")

        assert result == mock_thread
        mock_guild.fetch_channel.assert_called_once_with(12345)


class TestDownloadAttachments:
    async def test_download_attachments_success(self, forwarder):
        mock_file = MagicMock(spec=discord.File)
        mock_attachment = MagicMock()
        mock_attachment.size = 1000
        mock_attachment.to_file = AsyncMock(return_value=mock_file)

        message = MagicMock(spec=discord.Message)
        message.attachments = [mock_attachment]

        destination = MagicMock(spec=discord.TextChannel)
        destination.guild = MagicMock()
        destination.guild.filesize_limit = 8_000_000

        files = await forwarder._download_attachments(message, destination)

        assert len(files) == 1
        assert files[0] == mock_file

    async def test_download_attachments_too_large(self, forwarder):
        mock_attachment = MagicMock()
        mock_attachment.size = 10_000_000
        mock_attachment.id = 123

        message = MagicMock(spec=discord.Message)
        message.attachments = [mock_attachment]

        destination = MagicMock(spec=discord.TextChannel)
        destination.guild = MagicMock()
        destination.guild.filesize_limit = 8_000_000

        files = await forwarder._download_attachments(message, destination)

        assert len(files) == 0
        mock_attachment.to_file.assert_not_called()

    async def test_download_attachments_http_error(self, forwarder):
        mock_attachment = MagicMock()
        mock_attachment.size = 1000
        mock_attachment.id = 456
        mock_attachment.to_file = AsyncMock(side_effect=discord.HTTPException(MagicMock(), "error"))

        message = MagicMock(spec=discord.Message)
        message.attachments = [mock_attachment]

        destination = MagicMock(spec=discord.TextChannel)
        destination.guild = MagicMock()
        destination.guild.filesize_limit = 8_000_000

        files = await forwarder._download_attachments(message, destination)

        assert len(files) == 0

    async def test_download_attachments_closes_files_on_unexpected_error(self, forwarder):
        mock_file1 = MagicMock(spec=discord.File)
        mock_file2 = MagicMock(spec=discord.File)
        mock_attachment1 = MagicMock()
        mock_attachment1.size = 1000
        mock_attachment1.to_file = AsyncMock(return_value=mock_file1)
        mock_attachment2 = MagicMock()
        mock_attachment2.size = 1000
        mock_attachment2.to_file = AsyncMock(return_value=mock_file2)
        mock_attachment3 = MagicMock()
        mock_attachment3.size = 1000
        mock_attachment3.to_file = AsyncMock(side_effect=RuntimeError("Unexpected"))

        message = MagicMock(spec=discord.Message)
        message.attachments = [mock_attachment1, mock_attachment2, mock_attachment3]

        destination = MagicMock(spec=discord.TextChannel)
        destination.guild = MagicMock()
        destination.guild.filesize_limit = 8_000_000

        with pytest.raises(RuntimeError):
            await forwarder._download_attachments(message, destination)

        mock_file1.close.assert_called_once()
        mock_file2.close.assert_called_once()


class TestForwardMessage:
    async def test_forward_message_success(self, forwarder, mock_bot):
        mock_destination = MagicMock(spec=discord.TextChannel)
        mock_destination.guild = MagicMock()
        mock_destination.guild.filesize_limit = 8_000_000
        mock_forwarded = MagicMock(spec=discord.Message)
        mock_destination.send = AsyncMock(return_value=mock_forwarded)

        mock_bot.get_channel = MagicMock(return_value=mock_destination)

        message = MagicMock(spec=discord.Message)
        message.channel = MagicMock()
        message.channel.id = 111
        message.channel.name = "source"
        message.id = 222
        message.author = MagicMock()
        message.author.bot = False
        message.content = "Test message"
        message.embeds = []
        message.attachments = []

        result = await forwarder.forward_message(message, 333, "channel")

        assert result == mock_forwarded
        mock_destination.send.assert_called_once()

    async def test_forward_message_destination_not_found(self, forwarder, mock_bot):
        mock_bot.get_channel = MagicMock(return_value=None)
        mock_bot.guilds = []

        message = MagicMock(spec=discord.Message)

        result = await forwarder.forward_message(message, 12345, "channel")

        assert result is None

    async def test_forward_message_forbidden(self, forwarder, mock_bot):
        mock_destination = MagicMock(spec=discord.TextChannel)
        mock_destination.guild = MagicMock()
        mock_destination.guild.filesize_limit = 8_000_000
        mock_destination.send = AsyncMock(
            side_effect=discord.Forbidden(MagicMock(), "No permission")
        )

        mock_bot.get_channel = MagicMock(return_value=mock_destination)

        message = MagicMock(spec=discord.Message)
        message.channel = MagicMock()
        message.channel.name = "source"
        message.author = MagicMock()
        message.author.bot = False
        message.content = "Test"
        message.embeds = []
        message.attachments = []

        result = await forwarder.forward_message(message, 333, "channel")

        assert result is None

    async def test_forward_message_unarchives_thread(self, forwarder, mock_bot):
        mock_destination = MagicMock(spec=discord.Thread)
        mock_destination.archived = True
        mock_destination.guild = MagicMock()
        mock_destination.guild.filesize_limit = 8_000_000
        mock_destination.edit = AsyncMock()
        mock_forwarded = MagicMock(spec=discord.Message)
        mock_destination.send = AsyncMock(return_value=mock_forwarded)

        mock_bot.get_channel = MagicMock(return_value=mock_destination)

        message = MagicMock(spec=discord.Message)
        message.channel = MagicMock()
        message.channel.id = 111
        message.channel.name = "source"
        message.id = 222
        message.author = MagicMock()
        message.author.bot = False
        message.content = "Test"
        message.embeds = []
        message.attachments = []

        result = await forwarder.forward_message(message, 333, "thread")

        assert result == mock_forwarded
        mock_destination.edit.assert_called_once_with(archived=False)

    async def test_forward_message_with_embeds(self, forwarder, mock_bot):
        mock_destination = MagicMock(spec=discord.TextChannel)
        mock_destination.guild = MagicMock()
        mock_destination.guild.filesize_limit = 8_000_000
        mock_forwarded = MagicMock(spec=discord.Message)
        mock_destination.send = AsyncMock(return_value=mock_forwarded)

        mock_bot.get_channel = MagicMock(return_value=mock_destination)

        mock_embed = MagicMock(spec=discord.Embed)
        message = MagicMock(spec=discord.Message)
        message.channel = MagicMock()
        message.channel.id = 111
        message.channel.name = "source"
        message.id = 222
        message.author = MagicMock()
        message.author.bot = False
        message.content = "Test"
        message.embeds = [mock_embed]
        message.attachments = []

        result = await forwarder.forward_message(message, 333, "channel")

        assert result == mock_forwarded
        call_kwargs = mock_destination.send.call_args.kwargs
        assert call_kwargs["embeds"] == [mock_embed]

    async def test_forward_message_closes_files_on_send_failure(self, forwarder, mock_bot):
        mock_file = MagicMock(spec=discord.File)
        mock_attachment = MagicMock()
        mock_attachment.size = 1000
        mock_attachment.to_file = AsyncMock(return_value=mock_file)

        mock_destination = MagicMock(spec=discord.TextChannel)
        mock_destination.guild = MagicMock()
        mock_destination.guild.filesize_limit = 8_000_000
        mock_destination.send = AsyncMock(
            side_effect=discord.HTTPException(MagicMock(), "Failed to send")
        )

        mock_bot.get_channel = MagicMock(return_value=mock_destination)

        message = MagicMock(spec=discord.Message)
        message.channel = MagicMock()
        message.channel.name = "source"
        message.author = MagicMock()
        message.author.bot = False
        message.content = "Test"
        message.embeds = []
        message.attachments = [mock_attachment]

        result = await forwarder.forward_message(message, 333, "channel")

        assert result is None
        mock_file.close.assert_called_once()


class TestCloseFiles:
    def test_close_files_closes_all_files(self, forwarder):
        mock_file1 = MagicMock(spec=discord.File)
        mock_file2 = MagicMock(spec=discord.File)

        forwarder._close_files([mock_file1, mock_file2])

        mock_file1.close.assert_called_once()
        mock_file2.close.assert_called_once()

    def test_close_files_handles_exceptions(self, forwarder):
        mock_file1 = MagicMock(spec=discord.File)
        mock_file1.close.side_effect = Exception("Close error")
        mock_file2 = MagicMock(spec=discord.File)

        forwarder._close_files([mock_file1, mock_file2])

        mock_file1.close.assert_called_once()
        mock_file2.close.assert_called_once()

    def test_close_files_empty_list(self, forwarder):
        forwarder._close_files([])
