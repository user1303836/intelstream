from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum

import structlog

from intelstream.noosphere.constants import PHI

logger = structlog.get_logger(__name__)


class PulseType(str, Enum):
    QUESTION = "question"
    CROSS_REFERENCE = "cross_reference"
    RESURFACED_THREAD = "resurfaced_thread"
    THEMATIC_PROMPT = "thematic_prompt"


@dataclass
class Pulse:
    pulse_type: PulseType
    content: str
    target_channel_id: int
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))


class MorphogeneticPulseGenerator:
    """Generates Socratic prompts on phi-timed schedule.

    Pulse intervals follow: B, B*phi, B*phi^2, B*phi^3, then reset.
    Content type is selected by mode weights from the phi oscillator.
    """

    def __init__(self, base_interval_minutes: float = 60.0):
        self._base_interval = base_interval_minutes
        self._step = 0
        self._last_pulse_time: datetime | None = None

    @property
    def step(self) -> int:
        return self._step

    def next_interval_minutes(self) -> float:
        """Get next pulse interval using phi-scaling. Resets after 4 steps."""
        phase = self._step % 4
        interval = self._base_interval * (PHI**phase)
        self._step += 1
        return interval

    def generate_pulse(
        self,
        channel_id: int,
        mode_weights: dict[str, float] | None = None,
        available_topics: list[str] | None = None,
        recent_questions: list[str] | None = None,
    ) -> Pulse:
        """Generate a pulse based on mode weights and available content."""
        pulse_type = self._select_pulse_type(mode_weights)
        content = self._generate_content(pulse_type, available_topics, recent_questions)

        self._last_pulse_time = datetime.now(UTC)

        logger.info(
            "Pulse generated",
            pulse_type=pulse_type.value,
            channel_id=channel_id,
            step=self._step,
        )

        return Pulse(
            pulse_type=pulse_type,
            content=content,
            target_channel_id=channel_id,
        )

    def _select_pulse_type(self, mode_weights: dict[str, float] | None) -> PulseType:
        if mode_weights is None:
            return random.choice(list(PulseType))

        crystal_w = mode_weights.get("crystal", 0.25)
        attractor_w = mode_weights.get("attractor", 0.25)
        quasicrystal_w = mode_weights.get("quasicrystal", 0.25)
        ghost_w = mode_weights.get("ghost", 0.25)

        weights = [
            (PulseType.QUESTION, attractor_w + quasicrystal_w),
            (PulseType.CROSS_REFERENCE, crystal_w),
            (PulseType.RESURFACED_THREAD, quasicrystal_w),
            (PulseType.THEMATIC_PROMPT, ghost_w + attractor_w),
        ]

        pulse_types = [w[0] for w in weights]
        probs = [w[1] for w in weights]
        total = sum(probs)
        if total <= 0:
            return random.choice(list(PulseType))
        normalized = [p / total for p in probs]

        r = random.random()
        cumulative = 0.0
        for t, p in zip(pulse_types, normalized, strict=True):
            cumulative += p
            if r <= cumulative:
                return t
        return pulse_types[-1]

    def _generate_content(
        self,
        pulse_type: PulseType,
        topics: list[str] | None,
        questions: list[str] | None,
    ) -> str:
        if pulse_type == PulseType.QUESTION:
            if topics:
                topic = random.choice(topics)
                return f"Has anyone explored {topic} from a different angle recently?"
            return "What assumptions are we making that we haven't examined?"

        if pulse_type == PulseType.CROSS_REFERENCE:
            if topics and len(topics) >= 2:
                t1, t2 = random.sample(topics, 2)
                return f"There might be an interesting connection between {t1} and {t2}."
            return "Some of the recent threads seem to be converging on a shared theme."

        if pulse_type == PulseType.RESURFACED_THREAD:
            if questions:
                q = random.choice(questions)
                return f"An earlier question went unanswered: {q}"
            return "There are threads from before that might be worth revisiting."

        if topics:
            topic = random.choice(topics)
            return f"Consider this from the perspective of {topic}."
        return "What would change if we looked at this from the opposite direction?"
