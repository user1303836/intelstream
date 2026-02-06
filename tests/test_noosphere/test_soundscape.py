from datetime import datetime

from intelstream.noosphere.constants import MessageClassification
from intelstream.noosphere.shared.data_models import ProcessedMessage
from intelstream.noosphere.shared.soundscape import SoundscapeMonitor, SoundscapeState


def _make_message(
    guild_id: int = 1,
    user_id: int = 100,
    is_bot: bool = False,
    classification: MessageClassification = MessageClassification.BIOPHONY,
) -> ProcessedMessage:
    return ProcessedMessage(
        guild_id=guild_id,
        channel_id=10,
        user_id=user_id,
        message_id=999,
        content="hello",
        timestamp=datetime.utcnow(),
        is_bot=is_bot,
        classification=classification,
    )


class TestSoundscapeState:
    def test_empty_state(self) -> None:
        state = SoundscapeState()
        assert state.biophony_ratio == 0.0
        assert state.anthrophony_ratio == 0.0
        assert state.health_score == 1.0
        assert state.voice_count == 0

    def test_health_score_all_human(self) -> None:
        state = SoundscapeState(total=10, biophony=10)
        assert state.health_score == 1.0

    def test_health_score_mixed(self) -> None:
        state = SoundscapeState(total=10, biophony=7, anthrophony=3)
        assert abs(state.health_score - 0.7) < 1e-10


class TestSoundscapeMonitor:
    def test_classify_human_message(self) -> None:
        monitor = SoundscapeMonitor()
        msg = _make_message(is_bot=False)
        assert monitor.classify_message(msg) == MessageClassification.BIOPHONY

    def test_classify_bot_message(self) -> None:
        monitor = SoundscapeMonitor()
        msg = _make_message(is_bot=True)
        assert monitor.classify_message(msg) == MessageClassification.ANTHROPHONY

    def test_record_human_messages(self) -> None:
        monitor = SoundscapeMonitor()
        for i in range(5):
            msg = _make_message(user_id=100 + i)
            monitor.record_message(msg)

        state = monitor.get_state(1)
        assert state.total == 5
        assert state.biophony == 5
        assert state.voice_count == 5

    def test_record_bot_messages(self) -> None:
        monitor = SoundscapeMonitor(bot_user_id=200)
        msg = _make_message(
            user_id=200,
            is_bot=True,
            classification=MessageClassification.ANTHROPHONY,
        )
        monitor.record_message(msg)

        state = monitor.get_state(1)
        assert state.anthrophony == 1
        assert state.bot_anthrophony == 1

    def test_record_system_event(self) -> None:
        monitor = SoundscapeMonitor()
        monitor.record_system_event(1)
        state = monitor.get_state(1)
        assert state.geophony == 1
        assert state.total == 1

    def test_reset(self) -> None:
        monitor = SoundscapeMonitor()
        monitor.record_message(_make_message())
        monitor.reset(1)
        state = monitor.get_state(1)
        assert state.total == 0

    def test_separate_guilds(self) -> None:
        monitor = SoundscapeMonitor()
        monitor.record_message(_make_message(guild_id=1))
        monitor.record_message(_make_message(guild_id=2))
        assert monitor.get_state(1).total == 1
        assert monitor.get_state(2).total == 1
