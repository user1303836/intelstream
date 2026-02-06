from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import structlog

from intelstream.noosphere.constants import MessageClassification

if TYPE_CHECKING:
    from intelstream.noosphere.shared.data_models import ProcessedMessage

logger = structlog.get_logger(__name__)


@dataclass
class SoundscapeState:
    total: int = 0
    biophony: int = 0
    anthrophony: int = 0
    geophony: int = 0
    bot_anthrophony: int = 0
    unique_human_authors: set[int] | None = None

    def __post_init__(self) -> None:
        if self.unique_human_authors is None:
            self.unique_human_authors = set()

    @property
    def biophony_ratio(self) -> float:
        return self.biophony / self.total if self.total > 0 else 0.0

    @property
    def anthrophony_ratio(self) -> float:
        return self.anthrophony / self.total if self.total > 0 else 0.0

    @property
    def geophony_ratio(self) -> float:
        return self.geophony / self.total if self.total > 0 else 0.0

    @property
    def health_score(self) -> float:
        denominator = self.biophony + self.anthrophony
        if denominator == 0:
            return 1.0
        return self.biophony / denominator

    @property
    def voice_count(self) -> int:
        return len(self.unique_human_authors) if self.unique_human_authors else 0


class SoundscapeMonitor:
    """Classifies messages and tracks acoustic ecology per guild."""

    def __init__(self, bot_user_id: int | None = None) -> None:
        self._bot_user_id = bot_user_id
        self._states: dict[int, SoundscapeState] = {}

    def classify_message(self, message: ProcessedMessage) -> MessageClassification:
        if message.is_bot:
            return MessageClassification.ANTHROPHONY
        return MessageClassification.BIOPHONY

    def classify_system_event(self) -> MessageClassification:
        return MessageClassification.GEOPHONY

    def record_message(self, message: ProcessedMessage) -> None:
        guild_id = message.guild_id
        state = self._states.setdefault(guild_id, SoundscapeState())
        state.total += 1

        classification = message.classification
        if classification == MessageClassification.BIOPHONY:
            state.biophony += 1
            if state.unique_human_authors is not None:
                state.unique_human_authors.add(message.user_id)
        elif classification == MessageClassification.ANTHROPHONY:
            state.anthrophony += 1
            if self._bot_user_id and message.user_id == self._bot_user_id:
                state.bot_anthrophony += 1
        elif classification == MessageClassification.GEOPHONY:
            state.geophony += 1

    def record_system_event(self, guild_id: int) -> None:
        state = self._states.setdefault(guild_id, SoundscapeState())
        state.total += 1
        state.geophony += 1

    def get_state(self, guild_id: int) -> SoundscapeState:
        return self._states.get(guild_id, SoundscapeState())

    def reset(self, guild_id: int) -> None:
        self._states.pop(guild_id, None)
