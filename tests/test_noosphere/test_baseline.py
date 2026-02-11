from intelstream.noosphere.shared.baseline import WelfordAccumulator


class TestWelfordAccumulator:
    def test_empty(self) -> None:
        acc = WelfordAccumulator()
        assert acc.count == 0
        assert acc.mean == 0.0
        assert acc.variance == 0.0
        assert acc.std > 0  # sqrt(1e-12)

    def test_single_value(self) -> None:
        acc = WelfordAccumulator()
        acc.update(5.0)
        assert acc.count == 1
        assert acc.mean == 5.0
        assert acc.variance == 0.0

    def test_known_sequence(self) -> None:
        acc = WelfordAccumulator()
        values = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]
        for v in values:
            acc.update(v)
        assert acc.count == 8
        assert abs(acc.mean - 5.0) < 1e-10
        expected_var = sum((v - 5.0) ** 2 for v in values) / len(values)
        assert abs(acc.variance - expected_var) < 1e-10

    def test_z_score(self) -> None:
        acc = WelfordAccumulator()
        for v in [1.0, 2.0, 3.0, 4.0, 5.0]:
            acc.update(v)
        z = acc.z_score(3.0)
        assert abs(z) < 1e-10  # mean is 3.0

    def test_z_score_insufficient_data(self) -> None:
        acc = WelfordAccumulator()
        acc.update(1.0)
        assert acc.z_score(5.0) == 0.0

    def test_sigmoid(self) -> None:
        assert abs(WelfordAccumulator.sigmoid(0.0) - 0.5) < 1e-10
        assert WelfordAccumulator.sigmoid(10.0) > 0.99
        assert WelfordAccumulator.sigmoid(-10.0) < 0.01
        assert WelfordAccumulator.sigmoid(100) == 1.0
        assert WelfordAccumulator.sigmoid(-100) == 0.0

    def test_normalize(self) -> None:
        acc = WelfordAccumulator()
        for v in [0.0, 0.5, 1.0]:
            acc.update(v)
        result = acc.normalize(0.5)
        assert abs(result - 0.5) < 1e-10  # mean is 0.5, so z=0, sigmoid=0.5

    def test_init_with_existing_stats(self) -> None:
        acc = WelfordAccumulator(mean=5.0, variance=2.0, count=10)
        assert acc.count == 10
        assert acc.mean == 5.0
        assert abs(acc.variance - 2.0) < 1e-10
