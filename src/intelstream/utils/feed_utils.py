from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

import feedparser


def _parse_time_tuple(parsed: tuple[Any, ...]) -> datetime | None:
    """Safely parse a time tuple into a datetime.

    Returns None if the tuple is invalid or malformed.
    """
    try:
        if len(parsed) < 6:
            return None
        return datetime(
            int(parsed[0]),
            int(parsed[1]),
            int(parsed[2]),
            int(parsed[3]),
            int(parsed[4]),
            int(parsed[5]),
            tzinfo=UTC,
        )
    except (TypeError, ValueError, IndexError):
        return None


def parse_feed_date(entry: feedparser.FeedParserDict) -> datetime:
    """Parse date from feedparser entry, with fallback to current time.

    Checks in order: published_parsed, published (raw), updated_parsed, updated (raw).
    Returns datetime.now(UTC) if no valid date is found.
    """
    if entry.get("published_parsed"):
        result = _parse_time_tuple(entry.published_parsed)
        if result is not None:
            return result

    if entry.get("published"):
        try:
            return parsedate_to_datetime(str(entry.published))
        except (TypeError, ValueError):
            pass

    if entry.get("updated_parsed"):
        result = _parse_time_tuple(entry.updated_parsed)
        if result is not None:
            return result

    if entry.get("updated"):
        try:
            return parsedate_to_datetime(str(entry.updated))
        except (TypeError, ValueError):
            pass

    return datetime.now(UTC)
