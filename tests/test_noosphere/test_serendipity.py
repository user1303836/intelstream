import pytest

from intelstream.noosphere.morphogenetic_field.serendipity import (
    SerendipityBridge,
    SerendipityInjector,
)


class TestSerendipityInjector:
    @pytest.fixture
    def injector(self) -> SerendipityInjector:
        return SerendipityInjector(
            noise_sigma=0.2,
            similarity_min=0.3,
            similarity_max=0.6,
        )

    def test_find_bridges_empty(self, injector: SerendipityInjector) -> None:
        assert injector.find_bridges([], []) == []
        assert injector.find_bridges(["topic"], []) == []
        assert injector.find_bridges([], ["topic"]) == []

    def test_find_bridges_with_similarities(self, injector: SerendipityInjector) -> None:
        similarities = {
            ("current", "archived"): 0.45,
        }
        bridges = injector.find_bridges(["current"], ["archived"], similarities=similarities)
        assert len(bridges) <= 3

    def test_find_bridges_filters_same_topic(self, injector: SerendipityInjector) -> None:
        similarities = {("topic", "topic"): 1.0}
        bridges = injector.find_bridges(["topic"], ["topic"], similarities=similarities)
        assert len(bridges) == 0

    def test_find_bridges_limits_to_three(self, injector: SerendipityInjector) -> None:
        current = ["a", "b", "c", "d"]
        archived = ["x", "y", "z", "w"]
        similarities = {}
        for c in current:
            for a in archived:
                similarities[(c, a)] = 0.45
        bridges = injector.find_bridges(current, archived, similarities=similarities)
        assert len(bridges) <= 3

    def test_find_bridges_respects_range(self) -> None:
        noiseless = SerendipityInjector(noise_sigma=0.0, similarity_min=0.3, similarity_max=0.6)

        too_similar = {("a", "b"): 0.9}
        bridges = noiseless.find_bridges(["a"], ["b"], similarities=too_similar)
        assert len(bridges) == 0

        too_different = {("a", "b"): 0.05}
        bridges = noiseless.find_bridges(["a"], ["b"], similarities=too_different)
        assert len(bridges) == 0

    def test_select_injection(self, injector: SerendipityInjector) -> None:
        similarities = {("current", "archived"): 0.45}
        bridge = injector.select_injection(["current"], ["archived"], similarities=similarities)
        if bridge is not None:
            assert isinstance(bridge, SerendipityBridge)
            assert len(bridge.message) > 0

    def test_select_injection_empty(self, injector: SerendipityInjector) -> None:
        result = injector.select_injection([], [])
        assert result is None

    def test_bridge_message_generated(self, injector: SerendipityInjector) -> None:
        msg = injector._generate_bridge_message("quantum", "biology")
        assert "quantum" in msg
        assert "biology" in msg

    def test_estimate_similarity(self, injector: SerendipityInjector) -> None:
        sim = injector._estimate_similarity("machine learning", "deep learning")
        assert 0 <= sim <= 1
        assert sim > 0

        sim_different = injector._estimate_similarity("cats", "quantum physics")
        assert sim_different == 0.0
