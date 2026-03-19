import json

from intelstream.services.search_eval import (
    SearchEvalCase,
    evaluate_case,
    load_eval_cases,
    summarize_results,
)


class TestLoadEvalCases:
    def test_loads_expected_id_variants(self, tmp_path):
        path = tmp_path / "eval.json"
        path.write_text(
            json.dumps(
                [
                    {"query": "first query", "expected_content_item_id": "item-1"},
                    {"query": "second query", "expected_ids": ["item-2", "item-3"]},
                ]
            )
        )

        cases = load_eval_cases(path)

        assert cases[0].expected_ids == ("item-1",)
        assert cases[1].expected_ids == ("item-2", "item-3")


class TestEvaluateCase:
    def test_computes_rank_and_reciprocal_rank(self):
        result = evaluate_case(
            case=SearchEvalCase(query="query", expected_ids=("item-2",)),
            returned_ids=["item-9", "item-2", "item-3"],
        )

        assert result.hit is True
        assert result.rank == 2
        assert result.reciprocal_rank == 0.5


class TestSummarizeResults:
    def test_summarizes_hits_and_mrr(self):
        case_1 = SearchEvalCase(query="a", expected_ids=("item-1",))
        case_2 = SearchEvalCase(query="b", expected_ids=("item-2",))

        results = [
            evaluate_case(case_1, ["item-1", "item-3"]),
            evaluate_case(case_2, ["item-9", "item-8"]),
        ]

        summary = summarize_results(results)

        assert summary.cases == 2
        assert summary.hits == 1
        assert summary.hit_rate == 0.5
        assert summary.mean_reciprocal_rank == 0.5
