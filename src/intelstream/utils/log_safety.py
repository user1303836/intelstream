import re
from collections.abc import MutableMapping
from typing import Any
from urllib.parse import urlsplit, urlunsplit

MAX_LOG_URL_LENGTH = 500
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f-\x9f]")


def safe_url_for_log(url: str) -> str:
    """Remove credentials, query parameters, fragments, and control characters from a URL."""
    cleaned = _CONTROL_CHARACTERS.sub("", url).strip()
    try:
        parsed = urlsplit(cleaned)
        hostname = parsed.hostname
        if parsed.scheme and hostname:
            host = f"[{hostname}]" if ":" in hostname else hostname
            if parsed.port is not None:
                host = f"{host}:{parsed.port}"
            cleaned = urlunsplit((parsed.scheme, host, parsed.path, "", ""))
        else:
            cleaned = cleaned.split("?", 1)[0].split("#", 1)[0]
    except ValueError:
        cleaned = "<invalid-url>"

    if len(cleaned) > MAX_LOG_URL_LENGTH:
        return cleaned[: MAX_LOG_URL_LENGTH - 3] + "..."
    return cleaned


def sanitize_log_urls(
    _logger: Any,
    _method_name: str,
    event_dict: MutableMapping[str, Any],
) -> MutableMapping[str, Any]:
    """Structlog processor that redacts every URL-shaped event field centrally."""
    for key, value in event_dict.items():
        normalized_key = key.lower()
        if isinstance(value, str) and (normalized_key == "url" or normalized_key.endswith("_url")):
            event_dict[key] = safe_url_for_log(value)
    return event_dict
