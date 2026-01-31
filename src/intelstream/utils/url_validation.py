import ipaddress
import re
import socket
from urllib.parse import urlparse


class SSRFError(Exception):
    """Raised when a URL fails SSRF validation."""


BLOCKED_HOSTS = frozenset(
    {
        "localhost",
        "localhost.",
        "localhost.localdomain",
        "127.0.0.1",
        "::1",
        "0.0.0.0",
        "[::1]",
    }
)

OCTAL_IP_PATTERN = re.compile(r"^0[0-7]*(\.[0-7]+){0,3}$")
HEX_IP_PATTERN = re.compile(r"^0x[0-9a-fA-F]+(\.[0-9a-fA-F]+){0,3}$")
DECIMAL_IP_PATTERN = re.compile(r"^\d{8,10}$")


def _is_obfuscated_ip(hostname: str) -> bool:
    """
    Detect obfuscated IP address formats that bypass standard parsing.

    Checks for:
    - Octal format: 0177.0.0.1 (127.0.0.1)
    - Hex format: 0x7f.0.0.1 or 0x7f000001 (127.0.0.1)
    - Decimal format: 2130706433 (127.0.0.1)
    """
    if OCTAL_IP_PATTERN.match(hostname):
        return True
    if HEX_IP_PATTERN.match(hostname):
        return True
    if DECIMAL_IP_PATTERN.match(hostname):
        try:
            decimal_val = int(hostname)
            if 0 <= decimal_val <= 0xFFFFFFFF:
                return True
        except ValueError:
            pass
    return False


def _is_private_ip(ip_str: str) -> bool:
    """Check if an IP address is private, loopback, or link-local."""
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    except ValueError:
        pass

    if ip_str.startswith("[") and ip_str.endswith("]"):
        inner = ip_str[1:-1]
        try:
            ip = ipaddress.ip_address(inner)
            return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        except ValueError:
            pass

        if inner.lower().startswith("::ffff:"):
            ipv4_part = inner[7:]
            try:
                ip = ipaddress.ip_address(ipv4_part)
                return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
            except ValueError:
                pass

    return False


def validate_url_for_ssrf(url: str) -> None:
    """
    Validate a URL to prevent SSRF attacks.

    WARNING: This validation has inherent limitations:
    - TOCTOU (time-of-check-time-of-use): DNS resolution may change between
      validation and the actual HTTP request. An attacker could use DNS rebinding
      to bypass this check.
    - This function only validates URLs at entry points. Internal code paths
      (e.g., URLs discovered from sitemaps, RSS feeds, or scraped links) may
      bypass this validation when processed by WebFetcher or PageAnalyzer.

    Raises:
        SSRFError: If the URL points to a blocked host or internal IP, or if
            the hostname cannot be resolved.
    """
    parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        raise SSRFError("Only HTTP and HTTPS URLs are allowed")

    hostname = parsed.hostname
    if not hostname:
        raise SSRFError("URL must have a valid hostname")

    hostname_lower = hostname.lower()

    if hostname_lower in BLOCKED_HOSTS:
        raise SSRFError("URLs pointing to localhost are not allowed")

    if _is_obfuscated_ip(hostname_lower):
        raise SSRFError("URLs with obfuscated IP addresses are not allowed")

    if _is_private_ip(hostname_lower):
        raise SSRFError("URLs pointing to private IP addresses are not allowed")

    try:
        resolved_ips = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        for _, _, _, _, sockaddr in resolved_ips:
            ip_str = str(sockaddr[0])
            if _is_private_ip(ip_str):
                raise SSRFError(f"URL resolves to a private IP address ({ip_str})")
    except socket.gaierror as e:
        raise SSRFError("Could not resolve hostname") from e


def is_safe_url(url: str) -> tuple[bool, str]:
    """
    Check if a URL is safe from SSRF attacks.

    WARNING: See validate_url_for_ssrf() for important limitations regarding
    TOCTOU vulnerabilities and internal code paths that may bypass validation.

    Returns:
        Tuple of (is_safe, error_message). If is_safe is True, error_message is empty.
    """
    try:
        validate_url_for_ssrf(url)
        return True, ""
    except SSRFError as e:
        return False, str(e)
