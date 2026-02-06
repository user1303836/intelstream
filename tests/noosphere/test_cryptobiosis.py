from unittest.mock import patch

from intelstream.noosphere.cryptobiosis import CryptobiosisMonitor, CryptobiosisState


class TestCryptobiosisMonitor:
    def test_initial_state_is_active(self) -> None:
        monitor = CryptobiosisMonitor()
        assert monitor.state == CryptobiosisState.ACTIVE

    def test_enters_entering_after_threshold(self) -> None:
        monitor = CryptobiosisMonitor(
            entering_threshold_minutes=0.01,
            dormancy_threshold_minutes=0.02,
        )
        with patch("intelstream.noosphere.cryptobiosis.time.monotonic") as mock_time:
            mock_time.return_value = 0.0
            monitor.record_activity()

            mock_time.return_value = 2.0
            state = monitor.tick()
            assert state == CryptobiosisState.ENTERING

    def test_enters_cryptobiotic_after_dormancy(self) -> None:
        monitor = CryptobiosisMonitor(
            entering_threshold_minutes=0.01,
            dormancy_threshold_minutes=0.02,
        )
        with patch("intelstream.noosphere.cryptobiosis.time.monotonic") as mock_time:
            mock_time.return_value = 0.0
            monitor.record_activity()

            mock_time.return_value = 2.0
            monitor.tick()
            assert monitor.state == CryptobiosisState.ENTERING

            mock_time.return_value = 3.0
            monitor.tick()
            assert monitor.state == CryptobiosisState.CRYPTOBIOTIC

    def test_wakes_from_entering_on_activity(self) -> None:
        monitor = CryptobiosisMonitor(
            entering_threshold_minutes=0.01,
            dormancy_threshold_minutes=10.0,
            wakeup_threshold_minutes=0.01,
        )
        with patch("intelstream.noosphere.cryptobiosis.time.monotonic") as mock_time:
            mock_time.return_value = 0.0
            monitor.record_activity()

            mock_time.return_value = 2.0
            monitor.tick()
            assert monitor.state == CryptobiosisState.ENTERING

            mock_time.return_value = 2.5
            monitor.record_activity()

            mock_time.return_value = 3.5
            state = monitor.tick()
            assert state == CryptobiosisState.ACTIVE

    def test_wakes_from_cryptobiotic_on_activity(self) -> None:
        monitor = CryptobiosisMonitor(
            entering_threshold_minutes=0.01,
            dormancy_threshold_minutes=0.02,
            wakeup_threshold_minutes=0.01,
        )
        with patch("intelstream.noosphere.cryptobiosis.time.monotonic") as mock_time:
            mock_time.return_value = 0.0
            monitor.record_activity()

            mock_time.return_value = 2.0
            monitor.tick()

            mock_time.return_value = 3.0
            monitor.tick()
            assert monitor.state == CryptobiosisState.CRYPTOBIOTIC

            mock_time.return_value = 4.0
            monitor.record_activity()

            mock_time.return_value = 5.0
            state = monitor.tick()
            assert state == CryptobiosisState.ACTIVE

    def test_stays_active_with_regular_activity(self) -> None:
        monitor = CryptobiosisMonitor(
            entering_threshold_minutes=1.0,
        )
        with patch("intelstream.noosphere.cryptobiosis.time.monotonic") as mock_time:
            for t in range(0, 20):
                mock_time.return_value = float(t)
                monitor.record_activity()
                state = monitor.tick()
                assert state == CryptobiosisState.ACTIVE
