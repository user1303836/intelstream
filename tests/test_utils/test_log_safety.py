from intelstream.utils.log_safety import (
    MAX_LOG_URL_LENGTH,
    safe_url_for_log,
    sanitize_log_urls,
)


def test_safe_url_for_log_removes_credentials_query_and_fragment() -> None:
    result = safe_url_for_log("https://user:password@example.com:8443/article?token=secret#private")

    assert result == "https://example.com:8443/article"


def test_safe_url_for_log_preserves_ipv6_host_format() -> None:
    assert safe_url_for_log("https://[2001:db8::1]:8443/path?q=1") == (
        "https://[2001:db8::1]:8443/path"
    )


def test_safe_url_for_log_handles_relative_and_invalid_urls() -> None:
    assert safe_url_for_log("/path?token=secret#fragment") == "/path"
    assert safe_url_for_log("https://example.com:invalid/path") == "<invalid-url>"


def test_safe_url_for_log_removes_control_characters_and_limits_length() -> None:
    result = safe_url_for_log("https://example.com/" + "a" * 600 + "\n?token=secret")

    assert "\n" not in result
    assert "secret" not in result
    assert len(result) == MAX_LOG_URL_LENGTH


def test_sanitize_log_urls_redacts_all_url_fields_and_leaves_other_fields() -> None:
    event = {
        "event": "fetch failed",
        "url": "https://user:pass@example.com/a?token=secret",
        "feed_url": "https://feeds.example.com/rss?key=private",
        "detail": "unchanged",
    }

    result = sanitize_log_urls(None, "warning", event)

    assert result == {
        "event": "fetch failed",
        "url": "https://example.com/a",
        "feed_url": "https://feeds.example.com/rss",
        "detail": "unchanged",
    }
