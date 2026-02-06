import math

import pytest

from intelstream.noosphere.constants import GOLDEN_ANGLE
from intelstream.noosphere.shared.phi_parameter import PhiParameter


class TestPhiParameter:
    @pytest.fixture
    def phi(self) -> PhiParameter:
        return PhiParameter()

    def test_initial_state(self, phi: PhiParameter) -> None:
        assert phi.phase == 0.0
        assert phi.tick_count == 0

    def test_advance(self, phi: PhiParameter) -> None:
        phi.advance()
        assert abs(phi.phase - GOLDEN_ANGLE) < 1e-10
        assert phi.tick_count == 1

    def test_phase_wraps(self, phi: PhiParameter) -> None:
        for _ in range(100):
            phi.advance()
        assert 0 <= phi.phase < 2 * math.pi

    def test_mode_weights_sum_to_one(self, phi: PhiParameter) -> None:
        for _ in range(20):
            phi.advance()
            weights = phi.mode_weights()
            total = sum(weights.values())
            assert abs(total - 1.0) < 1e-10

    def test_mode_weights_keys(self, phi: PhiParameter) -> None:
        weights = phi.mode_weights()
        assert set(weights.keys()) == {"crystal", "attractor", "quasicrystal", "ghost"}

    def test_mode_weights_all_positive(self, phi: PhiParameter) -> None:
        for _ in range(50):
            phi.advance()
            weights = phi.mode_weights()
            for w in weights.values():
                assert w >= 0

    def test_set_phase(self, phi: PhiParameter) -> None:
        phi.set_phase(math.pi)
        assert abs(phi.phase - math.pi) < 1e-10

    def test_set_phase_wraps(self, phi: PhiParameter) -> None:
        phi.set_phase(3 * math.pi)
        assert phi.phase < 2 * math.pi

    def test_fibonacci_proximity_near_fraction(self, phi: PhiParameter) -> None:
        phi.set_phase(0.0)
        proximity = phi._fibonacci_proximity()
        assert proximity > 0.5

    def test_weights_vary_with_phase(self, phi: PhiParameter) -> None:
        phi.set_phase(0.0)
        w1 = phi.mode_weights()
        phi.set_phase(math.pi / 3)
        w2 = phi.mode_weights()
        assert w1 != w2
