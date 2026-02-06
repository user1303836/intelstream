from datetime import UTC, datetime

from intelstream.noosphere.morphogenetic_field.field import (
    CouplingResult,
    MorphogeneticField,
    UserState,
)


def _ts(day: int = 1) -> datetime:
    return datetime(2025, 1, day, tzinfo=UTC)


class TestUserState:
    def test_mean_embedding_single(self) -> None:
        import numpy as np

        state = UserState(
            user_id=1,
            guild_id=1,
            embedding_sum=np.array([1.0, 0.0, 0.0]),
            message_count=1,
        )
        np.testing.assert_array_equal(state.mean_embedding, [1.0, 0.0, 0.0])

    def test_mean_embedding_multiple(self) -> None:
        import numpy as np

        state = UserState(
            user_id=1,
            guild_id=1,
            embedding_sum=np.array([2.0, 4.0, 6.0]),
            message_count=2,
        )
        np.testing.assert_array_almost_equal(state.mean_embedding, [1.0, 2.0, 3.0])

    def test_mean_embedding_zero_count(self) -> None:
        import numpy as np

        state = UserState(
            user_id=1,
            guild_id=1,
            embedding_sum=np.array([1.0, 2.0]),
            message_count=0,
        )
        np.testing.assert_array_equal(state.mean_embedding, [1.0, 2.0])


class TestMorphogeneticField:
    def test_update_user_creates_state(self) -> None:
        mf = MorphogeneticField(guild_id=1)
        mf.update_user(42, [1.0, 0.0, 0.0], _ts())
        assert 42 in mf.users
        assert mf.users[42].message_count == 1

    def test_update_user_accumulates(self) -> None:
        mf = MorphogeneticField(guild_id=1)
        mf.update_user(42, [1.0, 0.0, 0.0], _ts(1))
        mf.update_user(42, [0.0, 1.0, 0.0], _ts(2))
        assert mf.users[42].message_count == 2

    def test_record_interaction(self) -> None:
        mf = MorphogeneticField(guild_id=1)
        mf.record_interaction(1, 2)
        assert mf.interaction_graph.has_edge(1, 2)
        assert mf.interaction_graph[1][2]["weight"] == 1

    def test_record_interaction_increments(self) -> None:
        mf = MorphogeneticField(guild_id=1)
        mf.record_interaction(1, 2)
        mf.record_interaction(1, 2)
        assert mf.interaction_graph[1][2]["weight"] == 2

    def test_self_interaction_ignored(self) -> None:
        mf = MorphogeneticField(guild_id=1)
        mf.record_interaction(1, 1)
        assert mf.interaction_graph.number_of_edges() == 0

    def test_compute_coupling_similar(self) -> None:
        mf = MorphogeneticField(guild_id=1)
        mf.update_user(1, [1.0, 0.0, 0.0], _ts())
        mf.update_user(2, [1.0, 0.0, 0.0], _ts())
        score = mf.compute_coupling(1, 2)
        assert abs(score - 1.0) < 1e-6

    def test_compute_coupling_orthogonal(self) -> None:
        mf = MorphogeneticField(guild_id=1)
        mf.update_user(1, [1.0, 0.0, 0.0], _ts())
        mf.update_user(2, [0.0, 1.0, 0.0], _ts())
        score = mf.compute_coupling(1, 2)
        assert abs(score) < 1e-6

    def test_compute_coupling_unknown_user(self) -> None:
        mf = MorphogeneticField(guild_id=1)
        mf.update_user(1, [1.0, 0.0, 0.0], _ts())
        assert mf.compute_coupling(1, 999) == 0.0

    def test_top_couplings(self) -> None:
        mf = MorphogeneticField(guild_id=1)
        mf.update_user(1, [1.0, 0.0], _ts())
        mf.update_user(2, [1.0, 0.0], _ts())
        mf.update_user(3, [0.0, 1.0], _ts())
        results = mf.top_couplings(limit=5)
        assert len(results) == 3
        assert isinstance(results[0], CouplingResult)
        assert results[0].score >= results[1].score

    def test_graph_modularity_empty(self) -> None:
        mf = MorphogeneticField(guild_id=1)
        assert mf.graph_modularity() == 0.0

    def test_graph_modularity_with_data(self) -> None:
        mf = MorphogeneticField(guild_id=1)
        for i in range(1, 6):
            for j in range(i + 1, 6):
                mf.record_interaction(i, j)
        mod = mf.graph_modularity()
        assert isinstance(mod, float)
