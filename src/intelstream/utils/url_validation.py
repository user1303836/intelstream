import ipaddress
import socket
from urllib.parse import urlparse

BLOCKED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0"})


def is_private_ip(ip_str: str) -> bool:
    """Check if an IP address is private, loopback, or link-local."""
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return False


def is_safe_url(url: str) -> tuple[bool, str]:
    """Validate that a URL doesn't point to internal/private addresses.

    Returns a tuple of (is_safe, error_message).
    If is_safe is True, error_message is empty.
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
        resolved_ip = socket.gethostbyname(hostname)
        if is_private_ip(resolved_ip):
            return False, "URLs pointing to private or internal addresses are not allowed."
    except socket.gaierror:
        pass

    return True, ""
