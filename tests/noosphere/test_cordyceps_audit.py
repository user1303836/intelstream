from intelstream.noosphere.cordyceps_audit.audit import (
    CordycepsReport,
    compute_parasitism_score,
    herfindahl_index,
    run_audit,
    vocabulary_jaccard,
)
from intelstream.noosphere.cordyceps_audit.vocabulary_tracker import (
    VocabularyTracker,
    extract_terms,
)


class TestHerfindahlIndex:
    def test_single_speaker(self) -> None:
        counts = {"1": 100}
        assert herfindahl_index(counts) == 1.0

    def test_equal_speakers(self) -> None:
        counts = {"1": 50, "2": 50}
        assert abs(herfindahl_index(counts) - 0.5) < 1e-9

    def test_four_equal_speakers(self) -> None:
        counts = {"1": 25, "2": 25, "3": 25, "4": 25}
        assert abs(herfindahl_index(counts) - 0.25) < 1e-9

    def test_empty(self) -> None:
        assert herfindahl_index({}) == 0.0

    def test_dominated_conversation(self) -> None:
        counts = {"1": 90, "2": 5, "3": 5}
        hhi = herfindahl_index(counts)
        assert hhi > 0.8


class TestVocabularyJaccard:
    def test_identical_sets(self) -> None:
        terms = {"hello", "world", "test"}
        assert vocabulary_jaccard(terms, terms) == 1.0

    def test_disjoint_sets(self) -> None:
        assert vocabulary_jaccard({"a", "b"}, {"c", "d"}) == 0.0

    def test_partial_overlap(self) -> None:
        result = vocabulary_jaccard({"a", "b", "c"}, {"b", "c", "d"})
        assert abs(result - 0.5) < 1e-9

    def test_empty_sets(self) -> None:
        assert vocabulary_jaccard(set(), set()) == 0.0


class TestComputeParasitismScore:
    def test_equal_weights(self) -> None:
        score = compute_parasitism_score(0.6, 0.4)
        assert abs(score - 0.5) < 1e-9

    def test_custom_weights(self) -> None:
        score = compute_parasitism_score(1.0, 0.0, hhi_weight=0.7, vocab_weight=0.3)
        assert abs(score - 0.7) < 1e-9


class TestRunAudit:
    def test_healthy_community(self) -> None:
        report = run_audit(
            message_counts={"1": 30, "2": 25, "3": 20, "4": 15, "5": 10},
            bot_terms={"hello", "world"},
            community_terms={"python", "discord", "bot"},
        )
        assert not report.flagged
        assert report.parasitism_score < 0.6

    def test_flagged_when_dominated(self) -> None:
        report = run_audit(
            message_counts={"1": 95, "2": 5},
            bot_terms={"alpha", "beta", "gamma"},
            community_terms={"alpha", "beta", "gamma"},
        )
        assert report.flagged

    def test_report_structure(self) -> None:
        report = run_audit(
            message_counts={"1": 50, "2": 50},
            bot_terms=set(),
            community_terms=set(),
        )
        assert isinstance(report, CordycepsReport)
        assert 0.0 <= report.herfindahl_index <= 1.0
        assert 0.0 <= report.vocabulary_jaccard <= 1.0


class TestExtractTerms:
    def test_basic_extraction(self) -> None:
        terms = extract_terms("Hello world this is a test")
        assert "hello" in terms
        assert "world" in terms
        assert "this" in terms
        assert "test" in terms

    def test_ignores_short_words(self) -> None:
        terms = extract_terms("I am a ok at it")
        assert terms == []

    def test_lowercases(self) -> None:
        terms = extract_terms("HELLO World")
        assert "hello" in terms
        assert "world" in terms


class TestVocabularyTracker:
    def test_tracks_bot_terms(self) -> None:
        tracker = VocabularyTracker(top_n=10)
        tracker.record_bot_message("neural network deep learning model")
        assert "neural" in tracker.bot_terms
        assert "network" in tracker.bot_terms

    def test_tracks_community_terms(self) -> None:
        tracker = VocabularyTracker(top_n=10)
        tracker.record_community_message("python discord bot development")
        assert "python" in tracker.community_terms
        assert "discord" in tracker.community_terms

    def test_reset_clears(self) -> None:
        tracker = VocabularyTracker()
        tracker.record_bot_message("hello world test")
        tracker.reset()
        assert tracker.bot_terms == set()
        assert tracker.community_terms == set()
