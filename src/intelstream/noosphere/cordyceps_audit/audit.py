from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CordycepsReport:
    herfindahl_index: float
    vocabulary_jaccard: float
    parasitism_score: float
    flagged: bool


def herfindahl_index(message_counts: dict[int, int]) -> float:
    total = sum(message_counts.values())
    if total == 0:
        return 0.0
    return sum((count / total) ** 2 for count in message_counts.values())


def vocabulary_jaccard(bot_terms: set[str], community_terms: set[str]) -> float:
    if not bot_terms and not community_terms:
        return 0.0
    intersection = bot_terms & community_terms
    union = bot_terms | community_terms
    if not union:
        return 0.0
    return len(intersection) / len(union)


def compute_parasitism_score(
    hhi: float,
    vocab_jaccard: float,
    hhi_weight: float = 0.5,
    vocab_weight: float = 0.5,
) -> float:
    return hhi_weight * hhi + vocab_weight * vocab_jaccard


def run_audit(
    message_counts: dict[int, int],
    bot_terms: set[str],
    community_terms: set[str],
    parasitism_threshold: float = 0.6,
) -> CordycepsReport:
    hhi = herfindahl_index(message_counts)
    vjac = vocabulary_jaccard(bot_terms, community_terms)
    score = compute_parasitism_score(hhi, vjac)
    return CordycepsReport(
        herfindahl_index=hhi,
        vocabulary_jaccard=vjac,
        parasitism_score=score,
        flagged=score > parasitism_threshold,
    )
