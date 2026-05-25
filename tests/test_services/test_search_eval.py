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

    def test_trims_query_expected_ids_and_optional_label(self, tmp_path):
        path = tmp_path / "eval.json"
        path.write_text(
            json.dumps(
                [
                    {
                        "query": "  query text  ",
                        "expected_ids": [" item-1 ", "", None, "item-2"],
                        "label": "  smoke  ",
                    }
                ]
            )
        )

        [case] = load_eval_cases(path)

        assert case.query == "query text"
        assert case.expected_ids == ("item-1", "item-2")
        assert case.label == "smoke"

    def test_rejects_non_array_eval_file(self, tmp_path):
        path = tmp_path / "eval.json"
        path.write_text(json.dumps({"query": "not a list"}))

        try:
            load_eval_cases(path)
        except ValueError as exc:
            assert str(exc) == "Evaluation file must contain a JSON array of cases"
        else:
            raise AssertionError("Expected ValueError")

    def test_rejects_invalid_cases_with_indexed_errors(self, tmp_path):
        path = tmp_path / "eval.json"
        path.write_text(json.dumps([{"query": "ok", "expected_ids": ["item"]}, "bad"]))

        try:
            load_eval_cases(path)
        except ValueError as exc:
            assert str(exc) == "Case #2 must be a JSON object"
        else:
            raise AssertionError("Expected ValueError")

    def test_rejects_missing_query(self, tmp_path):
        path = tmp_path / "eval.json"
        path.write_text(json.dumps([{"expected_ids": ["item"]}]))

        try:
            load_eval_cases(path)
        except ValueError as exc:
            assert str(exc) == "Case #1 is missing a non-empty 'query'"
        else:
            raise AssertionError("Expected ValueError")

    def test_rejects_missing_expected_ids(self, tmp_path):
        path = tmp_path / "eval.json"
        path.write_text(json.dumps([{"query": "query"}]))

        try:
            load_eval_cases(path)
        except ValueError as exc:
            assert str(exc) == "Case #1 must provide 'expected_ids' or 'expected_content_item_id'"
        else:
            raise AssertionError("Expected ValueError")

    def test_rejects_expected_ids_without_valid_strings(self, tmp_path):
        path = tmp_path / "eval.json"
        path.write_text(json.dumps([{"query": "query", "expected_ids": ["", None]}]))

        try:
            load_eval_cases(path)
        except ValueError as exc:
            assert str(exc) == "Case #1 has no valid expected ids"
        else:
            raise AssertionError("Expected ValueError")


class TestEvaluateCase:
    def test_computes_rank_and_reciprocal_rank(self):
        result = evaluate_case(
            case=SearchEvalCase(query="query", expected_ids=("item-2",)),
            returned_ids=["item-9", "item-2", "item-3"],
        )

        assert result.hit is True
        assert result.rank == 2
        assert result.reciprocal_rank == 0.5

    def test_miss_has_no_rank_or_matched_id(self):
        result = evaluate_case(
            case=SearchEvalCase(query="query", expected_ids=("item-2",), label="case"),
            returned_ids=("item-9", "item-3"),
        )

        assert result.hit is False
        assert result.matched_id is None
        assert result.rank is None
        assert result.reciprocal_rank == 0.0
        assert result.to_dict()["label"] == "case"


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

    def test_empty_results_summary_has_zero_rates(self):
        summary = summarize_results([])

        assert summary.cases == 0
        assert summary.hits == 0
        assert summary.hit_rate == 0.0
        assert summary.mean_reciprocal_rank == 0.0
        assert summary.to_dict() == {
            "cases": 0,
            "hits": 0,
            "hit_rate": 0.0,
            "mean_reciprocal_rank": 0.0,
            "results": [],
        }
