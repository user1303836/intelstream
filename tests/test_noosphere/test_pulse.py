import pytest

from intelstream.noosphere.constants import PHI
from intelstream.noosphere.morphogenetic_field.pulse import (
    MorphogeneticPulseGenerator,
    Pulse,
    PulseType,
)


class TestMorphogeneticPulseGenerator:
    @pytest.fixture
    def generator(self) -> MorphogeneticPulseGenerator:
        return MorphogeneticPulseGenerator(base_interval_minutes=60.0)

    def test_phi_scaling_intervals(self, generator: MorphogeneticPulseGenerator) -> None:
        intervals = [generator.next_interval_minutes() for _ in range(8)]
        assert abs(intervals[0] - 60.0) < 0.01
        assert abs(intervals[1] - 60.0 * PHI) < 0.01
        assert abs(intervals[2] - 60.0 * PHI**2) < 0.01
        assert abs(intervals[3] - 60.0 * PHI**3) < 0.01
        assert abs(intervals[4] - 60.0) < 0.01

    def test_step_increments(self, generator: MorphogeneticPulseGenerator) -> None:
        assert generator.step == 0
        generator.next_interval_minutes()
        assert generator.step == 1

    def test_generate_pulse(self, generator: MorphogeneticPulseGenerator) -> None:
        pulse = generator.generate_pulse(2001)
        assert isinstance(pulse, Pulse)
        assert pulse.target_channel_id == 2001
        assert pulse.pulse_type in list(PulseType)
        assert len(pulse.content) > 0

    def test_generate_pulse_with_mode_weights(self, generator: MorphogeneticPulseGenerator) -> None:
        weights = {"crystal": 1.0, "attractor": 0.0, "quasicrystal": 0.0, "ghost": 0.0}
        pulse = generator.generate_pulse(2001, mode_weights=weights)
        assert isinstance(pulse, Pulse)

    def test_generate_pulse_with_topics(self, generator: MorphogeneticPulseGenerator) -> None:
        pulse = generator.generate_pulse(
            2001,
            available_topics=["quantum computing", "neural networks"],
        )
        assert isinstance(pulse, Pulse)

    def test_generate_pulse_with_questions(self, generator: MorphogeneticPulseGenerator) -> None:
        pulse = generator.generate_pulse(
            2001,
            recent_questions=["What about entropy?"],
        )
        assert isinstance(pulse, Pulse)

    def test_pulse_types_selected_by_weights(self, generator: MorphogeneticPulseGenerator) -> None:
        type_counts: dict[PulseType, int] = dict.fromkeys(PulseType, 0)
        for _ in range(100):
            pulse = generator.generate_pulse(2001)
            type_counts[pulse.pulse_type] += 1
        assert all(count > 0 for count in type_counts.values())
