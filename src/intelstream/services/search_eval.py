from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class SearchEvalCase:
    query: str
    expected_ids: tuple[str, ...]
    label: str | None = None


@dataclass(frozen=True)
class SearchEvalResult:
    query: str
    expected_ids: tuple[str, ...]
    returned_ids: tuple[str, ...]
    hit: bool
    matched_id: str | None
    rank: int | None
    reciprocal_rank: float
    label: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class SearchEvalSummary:
    cases: int
    hits: int
    hit_rate: float
    mean_reciprocal_rank: float
    results: tuple[SearchEvalResult, ...]

    def to_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["results"] = [result.to_dict() for result in self.results]
        return data


def load_eval_cases(path: str | Path) -> list[SearchEvalCase]:
    raw_cases = json.loads(Path(path).read_text())
    if not isinstance(raw_cases, list):
        raise ValueError("Evaluation file must contain a JSON array of cases")

    cases: list[SearchEvalCase] = []
    for index, raw_case in enumerate(raw_cases, start=1):
        if not isinstance(raw_case, dict):
            raise ValueError(f"Case #{index} must be a JSON object")

        query = raw_case.get("query")
        if not isinstance(query, str) or not query.strip():
            raise ValueError(f"Case #{index} is missing a non-empty 'query'")

        expected_ids = raw_case.get("expected_ids")
        if expected_ids is None:
            expected_id = raw_case.get("expected_content_item_id")
            if isinstance(expected_id, str) and expected_id.strip():
                expected_ids = [expected_id]

        if not isinstance(expected_ids, list) or not expected_ids:
            raise ValueError(
                f"Case #{index} must provide 'expected_ids' or 'expected_content_item_id'"
            )

        normalized_expected_ids = tuple(
            expected_id.strip()
            for expected_id in expected_ids
            if isinstance(expected_id, str) and expected_id.strip()
        )
        if not normalized_expected_ids:
            raise ValueError(f"Case #{index} has no valid expected ids")

        label = raw_case.get("label")
        cases.append(
            SearchEvalCase(
                query=query.strip(),
                expected_ids=normalized_expected_ids,
                label=label.strip() if isinstance(label, str) and label.strip() else None,
            )
        )

    return cases


def evaluate_case(
    case: SearchEvalCase, returned_ids: list[str] | tuple[str, ...]
) -> SearchEvalResult:
    normalized_ids = tuple(str(item_id) for item_id in returned_ids)
    rank: int | None = None
    matched_id: str | None = None
    for index, item_id in enumerate(normalized_ids, start=1):
        if item_id in case.expected_ids:
            rank = index
            matched_id = item_id
            break

    reciprocal_rank = 0.0 if rank is None else 1.0 / rank
    return SearchEvalResult(
        query=case.query,
        expected_ids=case.expected_ids,
        returned_ids=normalized_ids,
        hit=rank is not None,
        matched_id=matched_id,
        rank=rank,
        reciprocal_rank=reciprocal_rank,
        label=case.label,
    )


def summarize_results(results: list[SearchEvalResult]) -> SearchEvalSummary:
    cases = len(results)
    hits = sum(1 for result in results if result.hit)
    hit_rate = 0.0 if cases == 0 else hits / cases
    mean_reciprocal_rank = (
        0.0 if cases == 0 else sum(result.reciprocal_rank for result in results) / cases
    )
    return SearchEvalSummary(
        cases=cases,
        hits=hits,
        hit_rate=hit_rate,
        mean_reciprocal_rank=mean_reciprocal_rank,
        results=tuple(results),
    )
