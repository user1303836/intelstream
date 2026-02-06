from __future__ import annotations

import random
import time

import structlog

from intelstream.noosphere.constants import (
    DEFAULT_ANTHROPHONY_THRESHOLD,
    DEFAULT_GAIN_RATIO,
    HARD_COOLDOWN_SECONDS,
    MIN_MSG_THRESHOLD,
    OUTPUT_GAIN_RECOMPUTE_INTERVAL,
)

logger = structlog.get_logger(__name__)


class OutputGovernor:
    """Controls all unprompted bot output via O(1) gain computation.

    Uses in-memory counters only -- no DB queries in the hot path.
    Gain is recomputed every GAIN_RECOMPUTE_INTERVAL seconds from
    cached message counts.
    """

    def __init__(
        self,
        threshold: float = DEFAULT_ANTHROPHONY_THRESHOLD,
        gain_ratio: float = DEFAULT_GAIN_RATIO,
        min_msg_threshold: int = MIN_MSG_THRESHOLD,
        cooldown_seconds: float = HARD_COOLDOWN_SECONDS,
        gain_recompute_interval: float = OUTPUT_GAIN_RECOMPUTE_INTERVAL,
    ) -> None:
        self._threshold = threshold
        self._gain_ratio = gain_ratio
        self._min_msg_threshold = min_msg_threshold
        self._cooldown_seconds = cooldown_seconds
        self._gain_recompute_interval = gain_recompute_interval

        self._bot_counts: dict[int, int] = {}
        self._total_counts: dict[int, int] = {}
        self._last_gain: dict[int, float] = {}
        self._gain_updated: dict[int, float] = {}
        self._last_response_time: dict[int, float] = {}

    def record_message(self, channel_id: int, *, is_bot: bool) -> None:
        self._total_counts[channel_id] = self._total_counts.get(channel_id, 0) + 1
        if is_bot:
            self._bot_counts[channel_id] = self._bot_counts.get(channel_id, 0) + 1

    def get_gain(self, channel_id: int) -> float:
        now = time.monotonic()
        last_updated = self._gain_updated.get(channel_id, 0.0)
        if now - last_updated < self._gain_recompute_interval:
            return self._last_gain.get(channel_id, 1.0)

        total = self._total_counts.get(channel_id, 0)
        if total < self._min_msg_threshold:
            self._last_gain[channel_id] = 1.0
            self._gain_updated[channel_id] = now
            return 1.0

        bot = self._bot_counts.get(channel_id, 0)
        ratio = bot / total
        excess = max(0.0, ratio - self._threshold)
        gain = max(0.1, 1.0 / (1.0 + excess * self._gain_ratio))

        self._last_gain[channel_id] = gain
        self._gain_updated[channel_id] = now
        return gain

    def should_send(self, channel_id: int) -> bool:
        now = time.monotonic()
        last_response = self._last_response_time.get(channel_id, 0.0)
        if now - last_response < self._cooldown_seconds:
            return False

        gain = self.get_gain(channel_id)
        if gain >= 1.0:
            return True

        return random.random() < gain

    def record_response(self, channel_id: int) -> None:
        self._last_response_time[channel_id] = time.monotonic()

    def reset_channel(self, channel_id: int) -> None:
        self._bot_counts.pop(channel_id, None)
        self._total_counts.pop(channel_id, None)
        self._last_gain.pop(channel_id, None)
        self._gain_updated.pop(channel_id, None)
        self._last_response_time.pop(channel_id, None)
