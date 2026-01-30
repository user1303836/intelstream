from unittest.mock import patch

from intelstream.utils.url_validation import is_private_ip, is_safe_url


class TestIsPrivateIp:
    def test_loopback_ipv4(self):
        assert is_private_ip("127.0.0.1") is True

    def test_loopback_ipv6(self):
        assert is_private_ip("::1") is True

    def test_private_class_a(self):
        assert is_private_ip("10.0.0.1") is True

    def test_private_class_b(self):
        assert is_private_ip("172.16.0.1") is True

    def test_private_class_c(self):
        assert is_private_ip("192.168.1.1") is True

    def test_link_local(self):
        assert is_private_ip("169.254.169.254") is True

    def test_public_ip(self):
        assert is_private_ip("8.8.8.8") is False

    def test_invalid_ip(self):
        assert is_private_ip("not-an-ip") is False


class TestIsSafeUrl:
    def test_blocks_localhost(self):
        is_safe, error = is_safe_url("http://localhost/admin")
        assert is_safe is False
        assert "localhost" in error.lower()

    def test_blocks_127_0_0_1(self):
        is_safe, error = is_safe_url("http://127.0.0.1:8080/")
        assert is_safe is False
        assert "localhost" in error.lower()

    def test_blocks_ipv6_loopback(self):
        is_safe, error = is_safe_url("http://[::1]/")
        assert is_safe is False
        assert "localhost" in error.lower()

    @patch("intelstream.utils.url_validation.socket.getaddrinfo")
    def test_blocks_private_ip_resolution(self, mock_getaddrinfo):
        mock_getaddrinfo.return_value = [(2, 1, 0, "", ("192.168.1.1", 0))]
        is_safe, error = is_safe_url("http://internal-server.local/")
        assert is_safe is False
        assert "private" in error.lower() or "internal" in error.lower()

    @patch("intelstream.utils.url_validation.socket.getaddrinfo")
    def test_blocks_cloud_metadata_endpoint(self, mock_getaddrinfo):
        mock_getaddrinfo.return_value = [(2, 1, 0, "", ("169.254.169.254", 0))]
        is_safe, _ = is_safe_url("http://metadata.google.internal/")
        assert is_safe is False

    @patch("intelstream.utils.url_validation.socket.getaddrinfo")
    def test_allows_public_url(self, mock_getaddrinfo):
        mock_getaddrinfo.return_value = [(2, 1, 0, "", ("151.101.1.140", 0))]
        is_safe, error = is_safe_url("https://example.com/article")
        assert is_safe is True
        assert error == ""

    def test_rejects_non_http_scheme(self):
        is_safe, error = is_safe_url("ftp://example.com/file")
        assert is_safe is False
        assert "HTTP" in error

    def test_rejects_file_scheme(self):
        is_safe, error = is_safe_url("file:///etc/passwd")
        assert is_safe is False
        assert "HTTP" in error

    def test_rejects_missing_hostname(self):
        is_safe, error = is_safe_url("http:///path")
        assert is_safe is False
        assert "hostname" in error.lower()

    @patch("intelstream.utils.url_validation.socket.getaddrinfo")
    def test_allows_when_dns_fails(self, mock_getaddrinfo):
        import socket

        mock_getaddrinfo.side_effect = socket.gaierror("DNS failed")
        is_safe, _ = is_safe_url("https://nonexistent-domain-12345.com/")
        assert is_safe is True

    @patch("intelstream.utils.url_validation.socket.getaddrinfo")
    def test_blocks_if_any_resolved_ip_is_private(self, mock_getaddrinfo):
        mock_getaddrinfo.return_value = [
            (2, 1, 0, "", ("8.8.8.8", 0)),
            (2, 1, 0, "", ("192.168.1.1", 0)),
        ]
        is_safe, error = is_safe_url("http://dual-homed.example.com/")
        assert is_safe is False
        assert "private" in error.lower() or "internal" in error.lower()

    @patch("intelstream.utils.url_validation.socket.getaddrinfo")
    def test_blocks_ipv6_private_resolution(self, mock_getaddrinfo):
        mock_getaddrinfo.return_value = [(10, 1, 0, "", ("::1", 0, 0, 0))]
        is_safe, error = is_safe_url("http://ipv6-only.example.com/")
        assert is_safe is False
        assert "private" in error.lower() or "internal" in error.lower()
