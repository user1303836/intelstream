from intelstream.noosphere.shared.fibonacci import FibonacciScheduler


class TestFibonacciScheduler:
    def test_first_interval(self) -> None:
        scheduler = FibonacciScheduler(base_interval_minutes=1.0)
        interval = scheduler.next_interval()
        assert interval >= 0.5

    def test_intervals_increase(self) -> None:
        scheduler = FibonacciScheduler(base_interval_minutes=1.0)
        intervals = [scheduler.next_interval() for _ in range(10)]
        for i in range(1, 8):
            assert intervals[i] > 0

    def test_index_advances(self) -> None:
        scheduler = FibonacciScheduler()
        assert scheduler.index == 0
        scheduler.next_interval()
        assert scheduler.index == 1

    def test_phase_advances(self) -> None:
        scheduler = FibonacciScheduler()
        assert scheduler.phase == 0.0
        scheduler.next_interval()
        assert scheduler.phase > 0.0

    def test_minimum_interval(self) -> None:
        scheduler = FibonacciScheduler(base_interval_minutes=0.01)
        for _ in range(20):
            interval = scheduler.next_interval()
            assert interval >= 0.5

    def test_base_interval_scaling(self) -> None:
        slow = FibonacciScheduler(base_interval_minutes=10.0)
        fast = FibonacciScheduler(base_interval_minutes=1.0)
        slow_first = slow.next_interval()
        fast_first = fast.next_interval()
        assert slow_first > fast_first

    def test_wraps_around_sequence(self) -> None:
        scheduler = FibonacciScheduler(base_interval_minutes=1.0)
        for _ in range(15):
            interval = scheduler.next_interval()
            assert interval > 0
