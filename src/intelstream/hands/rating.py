import math
from dataclasses import dataclass

DEFAULT_RATING = 1000
ELO_K_FACTOR = 32


@dataclass(frozen=True, slots=True)
class EloChange:
    player_one_before: int
    player_two_before: int
    player_one_after: int
    player_two_after: int
    player_one_delta: int
    player_two_delta: int


def calculate_elo(
    player_one_rating: int,
    player_two_rating: int,
    player_one_score: float,
) -> EloChange:
    if player_one_rating < 0 or player_two_rating < 0:
        raise ValueError("ratings cannot be negative")
    if player_one_score not in (0.0, 0.5, 1.0):
        raise ValueError("player_one_score must be 0, 0.5, or 1")

    expected = 1.0 / (1.0 + 10.0 ** ((player_two_rating - player_one_rating) / 400.0))
    raw_delta = ELO_K_FACTOR * (player_one_score - expected)
    delta = math.floor(raw_delta + 0.5) if raw_delta >= 0 else math.ceil(raw_delta - 0.5)
    player_one_after = max(0, player_one_rating + delta)
    applied_delta = player_one_after - player_one_rating
    player_two_after = max(0, player_two_rating - applied_delta)
    applied_delta = player_two_rating - player_two_after
    player_one_after = player_one_rating + applied_delta

    return EloChange(
        player_one_before=player_one_rating,
        player_two_before=player_two_rating,
        player_one_after=player_one_after,
        player_two_after=player_two_after,
        player_one_delta=applied_delta,
        player_two_delta=-applied_delta,
    )
