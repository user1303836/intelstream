from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import feedparser


def parse_feed_date(entry: feedparser.FeedParserDict) -> datetime:
    """Parse date from feedparser entry, with fallback to current time.

    Checks in order: published_parsed, published (raw), updated_parsed, updated (raw).
    Returns datetime.now(UTC) if no valid date is found.
    """
    if entry.get("published_parsed"):
        parsed = entry.published_parsed
        return datetime(
            parsed[0], parsed[1], parsed[2], parsed[3], parsed[4], parsed[5], tzinfo=UTC
        )

    if entry.get("published"):
        try:
            return parsedate_to_datetime(str(entry.published))
        except (TypeError, ValueError):
            pass

    if entry.get("updated_parsed"):
        parsed = entry.updated_parsed
        return datetime(
            parsed[0], parsed[1], parsed[2], parsed[3], parsed[4], parsed[5], tzinfo=UTC
        )

    if entry.get("updated"):
        try:
            return parsedate_to_datetime(str(entry.updated))
        except (TypeError, ValueError):
            pass

    return datetime.now(UTC)
