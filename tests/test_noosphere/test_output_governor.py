from intelstream.noosphere.shared.output_governor import OutputGovernor


class TestOutputGovernor:
    def test_gain_defaults_to_one(self) -> None:
        gov = OutputGovernor()
        assert gov.get_gain("ch1") == 1.0

    def test_gain_stays_one_below_threshold(self) -> None:
        gov = OutputGovernor(min_msg_threshold=5)
        for _ in range(3):
            gov.record_message("ch1", is_bot=False)
        gov.record_message("ch1", is_bot=True)
        assert gov.get_gain("ch1") == 1.0

    def test_gain_reduces_when_bot_dominates(self) -> None:
        gov = OutputGovernor(min_msg_threshold=5, gain_recompute_interval=0)
        for _ in range(5):
            gov.record_message("ch1", is_bot=True)
        for _ in range(5):
            gov.record_message("ch1", is_bot=False)
        gain = gov.get_gain("ch1")
        assert gain < 1.0

    def test_gain_minimum_floor(self) -> None:
        gov = OutputGovernor(min_msg_threshold=5, gain_recompute_interval=0)
        for _ in range(50):
            gov.record_message("ch1", is_bot=True)
        gain = gov.get_gain("ch1")
        assert gain >= 0.1

    def test_should_send_respects_cooldown(self) -> None:
        gov = OutputGovernor(cooldown_seconds=10.0)
        gov.record_response("ch1")
        assert gov.should_send("ch1") is False

    def test_should_send_after_cooldown(self) -> None:
        gov = OutputGovernor(cooldown_seconds=0.0)
        gov.record_response("ch1")
        assert gov.should_send("ch1") is True

    def test_reset_channel(self) -> None:
        gov = OutputGovernor(min_msg_threshold=5, gain_recompute_interval=0)
        for _ in range(10):
            gov.record_message("ch1", is_bot=True)
        gov.reset_channel("ch1")
        assert gov.get_gain("ch1") == 1.0

    def test_gain_cached_within_interval(self) -> None:
        gov = OutputGovernor(min_msg_threshold=5, gain_recompute_interval=300)
        for _ in range(20):
            gov.record_message("ch1", is_bot=False)
        gain1 = gov.get_gain("ch1")
        for _ in range(20):
            gov.record_message("ch1", is_bot=True)
        gain2 = gov.get_gain("ch1")
        assert gain1 == gain2

    def test_independent_channels(self) -> None:
        gov = OutputGovernor(min_msg_threshold=5, gain_recompute_interval=0)
        for _ in range(10):
            gov.record_message("ch1", is_bot=True)
        for _ in range(10):
            gov.record_message("ch2", is_bot=False)
        assert gov.get_gain("ch1") < gov.get_gain("ch2")
