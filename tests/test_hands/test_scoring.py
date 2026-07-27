import pytest

from intelstream.hands.engine import RoundPerformance, score_round
from intelstream.hands.rating import calculate_elo
from intelstream.hands.rules import JUDGE_PROFILES


def test_equal_rating_elo_is_symmetric_and_zero_sum() -> None:
    win = calculate_elo(1000, 1000, 1.0)
    loss = calculate_elo(1000, 1000, 0.0)
    draw = calculate_elo(1000, 1000, 0.5)

    assert (win.player_one_delta, win.player_two_delta) == (16, -16)
    assert (loss.player_one_delta, loss.player_two_delta) == (-16, 16)
    assert (draw.player_one_delta, draw.player_two_delta) == (0, 0)
    assert win.player_one_after + win.player_two_after == 2000


def test_underdog_and_favorite_changes_reflect_expectation() -> None:
    upset = calculate_elo(800, 1200, 1.0)
    expected = calculate_elo(1200, 800, 1.0)

    assert upset.player_one_delta > 16
    assert 0 < expected.player_one_delta < 16
    assert upset.player_one_delta == -upset.player_two_delta


@pytest.mark.parametrize("score", [-1.0, 0.25, 2.0])
def test_elo_rejects_invalid_scores(score: float) -> None:
    with pytest.raises(ValueError):
        calculate_elo(1000, 1000, score)


def test_round_scoring_rewards_impact_defense_control_and_knockdowns() -> None:
    one = RoundPerformance(
        damage=120,
        clean_hits=12,
        blocked_hits=8,
        evasions=4,
        control=100,
        knockdowns=1,
    )
    two = RoundPerformance(damage=60, clean_hits=8, blocked_hits=2, control=20)

    for profile in JUDGE_PROFILES:
        score = score_round(one, two, profile)
        assert score.player_one == 10
        assert score.player_two == 8


def test_close_round_can_be_scored_even_and_deductions_are_explicit() -> None:
    one = RoundPerformance(damage=50, clean_hits=5, control=10, deductions=1)
    two = RoundPerformance(damage=50, clean_hits=5, control=10)

    score = score_round(one, two, JUDGE_PROFILES[0])

    assert score.player_one == 9
    assert score.player_two == 10


def test_sole_knockdown_forces_standard_ten_eight_round() -> None:
    scorer = RoundPerformance(knockdowns=1)
    downed = RoundPerformance(damage=20, clean_hits=2, control=10)

    for profile in JUDGE_PROFILES:
        score = score_round(scorer, downed, profile)
        assert score.player_one == 10
        assert score.player_two == 8


def test_knockdown_score_preserves_explicit_point_deduction() -> None:
    scorer = RoundPerformance(knockdowns=1, deductions=1)
    downed = RoundPerformance(damage=20, clean_hits=2)

    score = score_round(scorer, downed, JUDGE_PROFILES[0])

    assert score.player_one == 9
    assert score.player_two == 8
