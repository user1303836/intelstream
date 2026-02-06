import math

from intelstream.noosphere.shared.phi_parameter import PhiParameter


class TestPhiParameter:
    def test_initial_phase(self) -> None:
        phi = PhiParameter()
        assert phi.phase == 0.0

    def test_advance_changes_phase(self) -> None:
        phi = PhiParameter()
        phi.advance()
        assert phi.phase > 0.0

    def test_phase_stays_in_range(self) -> None:
        phi = PhiParameter()
        for _ in range(1000):
            phi.advance()
        assert 0.0 <= phi.phase < 2 * math.pi

    def test_mode_weights_sum_to_one(self) -> None:
        phi = PhiParameter()
        for _ in range(20):
            phi.advance()
            weights = phi.mode_weights()
            total = sum(weights.values())
            assert abs(total - 1.0) < 1e-10

    def test_mode_weights_keys(self) -> None:
        phi = PhiParameter()
        weights = phi.mode_weights()
        assert set(weights.keys()) == {"crystal", "attractor", "quasicrystal", "ghost"}

    def test_mode_weights_non_negative(self) -> None:
        phi = PhiParameter()
        for _ in range(50):
            phi.advance()
            weights = phi.mode_weights()
            for w in weights.values():
                assert w >= 0.0

    def test_never_repeats_exactly(self) -> None:
        phi = PhiParameter()
        phases = []
        for _ in range(100):
            phi.advance()
            phases.append(phi.phase)
        assert len({round(p, 10) for p in phases}) == 100
