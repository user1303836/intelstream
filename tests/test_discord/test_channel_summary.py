from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import discord
import pytest
from discord import MessageType

from intelstream.discord.cogs.channel_summary import ChannelSummary
from intelstream.services.summarizer import SummarizationError


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.settings = MagicMock()
    bot.settings.llm_provider = "anthropic"
    bot.settings.llm_api_key = "test-api-key"
    bot.settings.summary_model_interactive = "claude-sonnet-4-20250514"
    bot.settings.summary_max_tokens = 2048
    bot.settings.summary_max_input_length = 100000
    return bot


@pytest.fixture
def cog(mock_bot):
    cog = ChannelSummary(mock_bot)
    cog._summarizer = MagicMock()
    cog._summarizer.summarize_chat = AsyncMock(
        return_value=(
            "**Key Topics**\n"
            "- **Testing:** The team discussed testing strategies.\n\n"
            "**Notable Highlights**\n"
            "- Decision to use pytest\n\n"
            "**Active Participants:** alice, bob"
        )
    )
    return cog


def _make_message(
    content: str = "Hello",
    author_name: str = "alice",
    is_bot: bool = False,
    msg_type: MessageType = MessageType.default,
    created_at: datetime | None = None,
    attachments: list | None = None,
    embeds: list | None = None,
) -> MagicMock:
    msg = MagicMock(spec=discord.Message)
    msg.content = content
    msg.author = MagicMock()
    msg.author.display_name = author_name
    msg.author.bot = is_bot
    msg.type = msg_type
    msg.created_at = created_at or datetime(2025, 1, 15, 12, 0, tzinfo=UTC)
    msg.attachments = attachments or []
    msg.embeds = embeds or []
    return msg


@pytest.fixture
def mock_interaction():
    interaction = MagicMock(spec=discord.Interaction)
    interaction.response = MagicMock()
    interaction.response.defer = AsyncMock()
    interaction.followup = MagicMock()
    interaction.followup.send = AsyncMock()
    interaction.user = MagicMock()
    interaction.user.id = 12345
    interaction.channel = MagicMock(spec=discord.TextChannel)
    interaction.channel.id = 99999
    interaction.channel_id = 99999
    return interaction


class TestSummaryCommand:
    async def test_summary_success(self, cog, mock_interaction):
        messages = [_make_message(f"msg {i}", f"user{i}") for i in range(10)]

        channel = mock_interaction.channel
        channel.history = MagicMock(return_value=_async_iter(messages))

        await cog.summary.callback(cog, mock_interaction, count=200, channel=None)

        mock_interaction.response.defer.assert_called_once()
        cog._summarizer.summarize_chat.assert_called_once()
        call_kwargs = cog._summarizer.summarize_chat.call_args.kwargs
        assert call_kwargs["message_count"] == 10
        mock_interaction.followup.send.assert_called_once()
        sent_text = mock_interaction.followup.send.call_args.args[0]
        assert "Channel Summary" in sent_text
        assert "10 messages" in sent_text

    async def test_summary_filters_bot_messages(self, cog, mock_interaction):
        messages = [
            _make_message("human msg 1", "alice"),
            _make_message("bot msg", "bot-user", is_bot=True),
            _make_message("human msg 2", "bob"),
            _make_message("human msg 3", "carol"),
            _make_message("human msg 4", "dave"),
            _make_message("human msg 5", "eve"),
        ]

        channel = mock_interaction.channel
        channel.history = MagicMock(return_value=_async_iter(messages))

        await cog.summary.callback(cog, mock_interaction, count=200, channel=None)

        call_kwargs = cog._summarizer.summarize_chat.call_args.kwargs
        assert call_kwargs["message_count"] == 5
        assert "bot-user" not in call_kwargs["messages_text"]

    async def test_summary_filters_system_messages(self, cog, mock_interaction):
        messages = [
            _make_message("hello", "alice"),
            _make_message("joined", "bob", msg_type=MessageType.new_member),
            _make_message("world", "carol"),
            _make_message("test1", "dave"),
            _make_message("test2", "eve"),
            _make_message("test3", "frank"),
        ]

        channel = mock_interaction.channel
        channel.history = MagicMock(return_value=_async_iter(messages))

        await cog.summary.callback(cog, mock_interaction, count=200, channel=None)

        call_kwargs = cog._summarizer.summarize_chat.call_args.kwargs
        assert call_kwargs["message_count"] == 5

    async def test_summary_allows_reply_messages(self, cog, mock_interaction):
        messages = [
            _make_message("hello", "alice"),
            _make_message("reply to hello", "bob", msg_type=MessageType.reply),
            _make_message("msg3", "carol"),
            _make_message("msg4", "dave"),
            _make_message("msg5", "eve"),
        ]

        channel = mock_interaction.channel
        channel.history = MagicMock(return_value=_async_iter(messages))

        await cog.summary.callback(cog, mock_interaction, count=200, channel=None)

        call_kwargs = cog._summarizer.summarize_chat.call_args.kwargs
        assert call_kwargs["message_count"] == 5
        assert "reply to hello" in call_kwargs["messages_text"]

    async def test_summary_too_few_messages(self, cog, mock_interaction):
        messages = [_make_message("only msg", "alice")]

        channel = mock_interaction.channel
        channel.history = MagicMock(return_value=_async_iter(messages))

        await cog.summary.callback(cog, mock_interaction, count=200, channel=None)

        cog._summarizer.summarize_chat.assert_not_called()
        mock_interaction.followup.send.assert_called_once()
        sent_kwargs = mock_interaction.followup.send.call_args.kwargs
        assert sent_kwargs.get("ephemeral") is True
        assert "Not enough messages" in mock_interaction.followup.send.call_args.args[0]

    async def test_summary_with_different_channel(self, cog, mock_interaction):
        target_channel = MagicMock(spec=discord.TextChannel)
        target_channel.id = 88888
        target_channel.mention = "<#88888>"
        messages = [_make_message(f"msg {i}", f"user{i}") for i in range(6)]
        target_channel.history = MagicMock(return_value=_async_iter(messages))

        await cog.summary.callback(cog, mock_interaction, count=200, channel=target_channel)

        target_channel.history.assert_called_once()
        sent_text = mock_interaction.followup.send.call_args.args[0]
        assert "<#88888>" in sent_text

    async def test_summary_handles_summarization_failure(self, cog, mock_interaction):
        messages = [_make_message(f"msg {i}", f"user{i}") for i in range(10)]
        channel = mock_interaction.channel
        channel.history = MagicMock(return_value=_async_iter(messages))

        cog._summarizer.summarize_chat = AsyncMock(side_effect=SummarizationError("API error"))

        await cog.summary.callback(cog, mock_interaction, count=200, channel=None)

        mock_interaction.followup.send.assert_called_once()
        sent_kwargs = mock_interaction.followup.send.call_args.kwargs
        assert sent_kwargs.get("ephemeral") is True
        assert "Failed to generate summary" in mock_interaction.followup.send.call_args.args[0]

    async def test_summary_filters_empty_messages(self, cog, mock_interaction):
        messages = [
            _make_message("hello", "alice"),
            _make_message("", "bob"),
            _make_message("world", "carol"),
            _make_message("test1", "dave"),
            _make_message("test2", "eve"),
            _make_message("test3", "frank"),
        ]

        channel = mock_interaction.channel
        channel.history = MagicMock(return_value=_async_iter(messages))

        await cog.summary.callback(cog, mock_interaction, count=200, channel=None)

        call_kwargs = cog._summarizer.summarize_chat.call_args.kwargs
        assert call_kwargs["message_count"] == 5
        assert "bob" not in call_kwargs["messages_text"]

    async def test_summary_includes_attachment_info(self, cog, mock_interaction):
        attachment = MagicMock()
        attachment.filename = "screenshot.png"
        messages = [
            _make_message("check this out", "alice", attachments=[attachment]),
            _make_message("msg2", "bob"),
            _make_message("msg3", "carol"),
            _make_message("msg4", "dave"),
            _make_message("msg5", "eve"),
        ]

        channel = mock_interaction.channel
        channel.history = MagicMock(return_value=_async_iter(messages))

        await cog.summary.callback(cog, mock_interaction, count=200, channel=None)

        call_kwargs = cog._summarizer.summarize_chat.call_args.kwargs
        assert "screenshot.png" in call_kwargs["messages_text"]

    async def test_summary_truncates_long_output(self, cog, mock_interaction):
        messages = [_make_message(f"msg {i}", f"user{i}") for i in range(10)]
        channel = mock_interaction.channel
        channel.history = MagicMock(return_value=_async_iter(messages))

        cog._summarizer.summarize_chat = AsyncMock(return_value="x" * 2500)

        await cog.summary.callback(cog, mock_interaction, count=200, channel=None)

        sent_text = mock_interaction.followup.send.call_args.args[0]
        assert len(sent_text) <= 2000
        assert sent_text.endswith("...")


class TestFormatMessages:
    def test_format_basic_messages(self, cog):
        messages = [
            _make_message(
                "Hello world",
                "alice",
                created_at=datetime(2025, 1, 15, 12, 30, tzinfo=UTC),
            ),
            _make_message(
                "Hi there",
                "bob",
                created_at=datetime(2025, 1, 15, 12, 31, tzinfo=UTC),
            ),
        ]

        result = cog._format_messages(messages)
        assert "[2025-01-15 12:30] alice: Hello world" in result
        assert "[2025-01-15 12:31] bob: Hi there" in result

    def test_format_with_attachments(self, cog):
        attachment = MagicMock()
        attachment.filename = "image.png"
        msg = _make_message("Look at this", "alice", attachments=[attachment])

        result = cog._format_messages([msg])
        assert "image.png" in result
        assert "1 attachment(s)" in result

    def test_format_with_embeds(self, cog):
        embed = MagicMock()
        msg = _make_message("Check this link", "alice", embeds=[embed])

        result = cog._format_messages([msg])
        assert "1 embed(s)" in result


class TestCogLoad:
    async def test_cog_load_creates_summarizer(self, mock_bot):
        cog = ChannelSummary(mock_bot)
        assert cog._summarizer is None

        await cog.cog_load()

        assert cog._summarizer is not None


class _async_iter:
    def __init__(self, items: list):
        self._items = items
        self._index = 0

    def __aiter__(self):
        self._index = 0
        return self

    async def __anext__(self):
        if self._index >= len(self._items):
            raise StopAsyncIteration
        item = self._items[self._index]
        self._index += 1
        return item
