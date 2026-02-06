from intelstream.noosphere.shared.archive_decay import compute_fidelity, relevance_score


class TestRelevanceScore:
    def test_brand_new_entry(self) -> None:
        score = relevance_score(entry_age_hours=0.0, reference_count=0)
        assert abs(score - 1.0) < 1e-10

    def test_one_half_life(self) -> None:
        score = relevance_score(entry_age_hours=168.0, reference_count=0)
        assert abs(score - 0.5) < 1e-5

    def test_references_extend_half_life(self) -> None:
        no_refs = relevance_score(entry_age_hours=168.0, reference_count=0)
        with_refs = relevance_score(entry_age_hours=168.0, reference_count=3)
        assert with_refs > no_refs

    def test_floor(self) -> None:
        score = relevance_score(entry_age_hours=100000.0, reference_count=0)
        assert score >= 0.01

    def test_custom_half_life(self) -> None:
        score = relevance_score(entry_age_hours=24.0, reference_count=0, base_half_life=24.0)
        assert abs(score - 0.5) < 1e-5


class TestComputeFidelity:
    def test_new_entry_no_interactions(self) -> None:
        fidelity = compute_fidelity(
            created_hours_ago=0.0,
            interaction_timestamps_hours_ago=[],
            reference_count=0,
        )
        assert abs(fidelity - 1.0) < 1e-5

    def test_decays_over_time(self) -> None:
        new = compute_fidelity(0.0, [], 0)
        old = compute_fidelity(500.0, [], 0)
        assert new > old

    def test_interactions_boost_fidelity(self) -> None:
        without = compute_fidelity(200.0, [], 0)
        with_interaction = compute_fidelity(200.0, [1.0, 5.0], 0)
        assert with_interaction > without

    def test_references_slow_decay(self) -> None:
        no_refs = compute_fidelity(300.0, [], 0)
        with_refs = compute_fidelity(300.0, [], 5)
        assert with_refs > no_refs

    def test_fidelity_capped_at_one(self) -> None:
        fidelity = compute_fidelity(
            created_hours_ago=0.0,
            interaction_timestamps_hours_ago=[0.0, 0.0, 0.0, 0.0, 0.0],
            reference_count=0,
        )
        assert fidelity <= 1.0

    def test_fidelity_floor(self) -> None:
        fidelity = compute_fidelity(
            created_hours_ago=1e6,
            interaction_timestamps_hours_ago=[],
            reference_count=0,
        )
        assert fidelity >= 0.01
