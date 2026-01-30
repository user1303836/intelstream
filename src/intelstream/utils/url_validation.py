import ipaddress
import socket
from urllib.parse import urlparse

BLOCKED_HOSTS = frozenset(
    {
        "localhost",
        "localhost.",
        "localhost.localdomain",
        "127.0.0.1",
        "::1",
        "0.0.0.0",
        "[::1]",
        "[0:0:0:0:0:0:0:1]",
    }
)


def is_private_ip(ip_str: str) -> bool:
    """Check if an IP address is private, loopback, link-local, or reserved."""
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    except ValueError:
        return False


def is_safe_url(url: str) -> tuple[bool, str]:
    """Validate that a URL doesn't point to internal/private addresses.

    Returns a tuple of (is_safe, error_message).
    If is_safe is True, error_message is empty.

    Note: This validation is subject to TOCTOU (time-of-check-time-of-use) race
    conditions. DNS rebinding attacks could bypass this check if the DNS response
    changes between validation and actual request. For high-security contexts,
    consider additional protections at the HTTP client level.
    """
    parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        return False, "Only HTTP and HTTPS URLs are allowed."

    hostname = parsed.hostname
    if not hostname:
        return False, "Invalid URL: no hostname found."

    hostname_lower = hostname.lower()

    if hostname_lower in BLOCKED_HOSTS:
        return False, "URLs pointing to localhost are not allowed."

    try:
        addr_info = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        for _, _, _, _, sockaddr in addr_info:
            ip_str = sockaddr[0]
            if is_private_ip(ip_str):
                return False, "URLs pointing to private or internal addresses are not allowed."
    except socket.gaierror:
        pass

    return True, ""
