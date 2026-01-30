from datetime import UTC, datetime
from unittest.mock import MagicMock

from intelstream.utils.feed_utils import parse_feed_date


class TestParseFeedDate:
    def test_published_parsed(self) -> None:
        entry = MagicMock()
        entry.get.side_effect = (
            lambda k: (2024, 1, 15, 10, 30, 0, 0, 0, 0) if k == "published_parsed" else None
        )
        entry.published_parsed = (2024, 1, 15, 10, 30, 0, 0, 0, 0)

        result = parse_feed_date(entry)

        assert result == datetime(2024, 1, 15, 10, 30, 0, tzinfo=UTC)

    def test_published_raw_string(self) -> None:
        entry = MagicMock()
        entry.get.side_effect = (
            lambda k: "Tue, 16 Jan 2024 08:00:00 GMT" if k == "published" else None
        )
        entry.published = "Tue, 16 Jan 2024 08:00:00 GMT"

        result = parse_feed_date(entry)

        assert result.year == 2024
        assert result.month == 1
        assert result.day == 16
        assert result.hour == 8

    def test_updated_parsed(self) -> None:
        entry = MagicMock()
        entry.get.side_effect = (
            lambda k: (2024, 2, 20, 14, 0, 0, 0, 0, 0) if k == "updated_parsed" else None
        )
        entry.updated_parsed = (2024, 2, 20, 14, 0, 0, 0, 0, 0)

        result = parse_feed_date(entry)

        assert result == datetime(2024, 2, 20, 14, 0, 0, tzinfo=UTC)

    def test_updated_raw_string(self) -> None:
        entry = MagicMock()
        entry.get.side_effect = (
            lambda k: "Wed, 21 Feb 2024 12:00:00 GMT" if k == "updated" else None
        )
        entry.updated = "Wed, 21 Feb 2024 12:00:00 GMT"

        result = parse_feed_date(entry)

        assert result.year == 2024
        assert result.month == 2
        assert result.day == 21

    def test_fallback_to_now(self) -> None:
        entry = MagicMock()
        entry.get.return_value = None

        before = datetime.now(UTC)
        result = parse_feed_date(entry)
        after = datetime.now(UTC)

        assert before <= result <= after

    def test_invalid_raw_string_falls_back(self) -> None:
        entry = MagicMock()
        entry.get.side_effect = lambda k: "not a valid date" if k == "published" else None
        entry.published = "not a valid date"

        before = datetime.now(UTC)
        result = parse_feed_date(entry)
        after = datetime.now(UTC)

        assert before <= result <= after

    def test_priority_order(self) -> None:
        entry = MagicMock()
        entry.get.side_effect = lambda k: {
            "published_parsed": (2024, 1, 1, 0, 0, 0, 0, 0, 0),
            "updated_parsed": (2024, 2, 2, 0, 0, 0, 0, 0, 0),
        }.get(k)
        entry.published_parsed = (2024, 1, 1, 0, 0, 0, 0, 0, 0)
        entry.updated_parsed = (2024, 2, 2, 0, 0, 0, 0, 0, 0)

        result = parse_feed_date(entry)

        assert result == datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC)

    def test_short_tuple_falls_back(self) -> None:
        entry = MagicMock()
        entry.get.side_effect = lambda k: (2024, 1, 15) if k == "published_parsed" else None
        entry.published_parsed = (2024, 1, 15)

        before = datetime.now(UTC)
        result = parse_feed_date(entry)
        after = datetime.now(UTC)

        assert before <= result <= after

    def test_invalid_date_values_fall_back(self) -> None:
        entry = MagicMock()
        entry.get.side_effect = (
            lambda k: (2024, 13, 45, 25, 61, 99) if k == "published_parsed" else None
        )
        entry.published_parsed = (2024, 13, 45, 25, 61, 99)

        before = datetime.now(UTC)
        result = parse_feed_date(entry)
        after = datetime.now(UTC)

        assert before <= result <= after

    def test_none_in_tuple_falls_back(self) -> None:
        entry = MagicMock()
        entry.get.side_effect = (
            lambda k: (None, 1, 15, 10, 30, 0) if k == "published_parsed" else None
        )
        entry.published_parsed = (None, 1, 15, 10, 30, 0)

        before = datetime.now(UTC)
        result = parse_feed_date(entry)
        after = datetime.now(UTC)

        assert before <= result <= after

    def test_malformed_published_falls_back_to_updated(self) -> None:
        entry = MagicMock()
        entry.get.side_effect = lambda k: {
            "published_parsed": (2024, 13, 45),
            "updated_parsed": (2024, 2, 20, 14, 0, 0, 0, 0, 0),
        }.get(k)
        entry.published_parsed = (2024, 13, 45)
        entry.updated_parsed = (2024, 2, 20, 14, 0, 0, 0, 0, 0)

        result = parse_feed_date(entry)

        assert result == datetime(2024, 2, 20, 14, 0, 0, tzinfo=UTC)
