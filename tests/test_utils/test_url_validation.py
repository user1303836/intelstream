import pytest

from intelstream.utils.url_validation import SSRFError, is_safe_url, validate_url_for_ssrf


class TestValidateUrlForSsrf:
    def test_allows_valid_https_url(self):
        validate_url_for_ssrf("https://example.com/page")

    def test_allows_valid_http_url(self):
        validate_url_for_ssrf("http://example.com/page")

    def test_rejects_localhost(self):
        with pytest.raises(SSRFError, match="localhost"):
            validate_url_for_ssrf("http://localhost/admin")

    def test_rejects_127_0_0_1(self):
        with pytest.raises(SSRFError, match="localhost"):
            validate_url_for_ssrf("http://127.0.0.1/admin")

    def test_rejects_127_0_0_2_loopback_range(self):
        with pytest.raises(SSRFError, match="private"):
            validate_url_for_ssrf("http://127.0.0.2/admin")

    def test_rejects_127_255_255_255(self):
        with pytest.raises(SSRFError, match="private"):
            validate_url_for_ssrf("http://127.255.255.255/admin")

    def test_rejects_octal_ip(self):
        with pytest.raises(SSRFError, match="obfuscated"):
            validate_url_for_ssrf("http://0177.0.0.1/admin")

    def test_rejects_hex_ip(self):
        with pytest.raises(SSRFError, match="obfuscated"):
            validate_url_for_ssrf("http://0x7f.0.0.1/admin")

    def test_rejects_decimal_ip(self):
        with pytest.raises(SSRFError, match="obfuscated"):
            validate_url_for_ssrf("http://2130706433/admin")

    def test_rejects_ipv6_loopback(self):
        with pytest.raises(SSRFError, match="localhost"):
            validate_url_for_ssrf("http://[::1]/admin")

    def test_rejects_zero_address(self):
        with pytest.raises(SSRFError, match="localhost"):
            validate_url_for_ssrf("http://0.0.0.0/admin")

    def test_rejects_private_ip_10_x(self):
        with pytest.raises(SSRFError, match="private"):
            validate_url_for_ssrf("http://10.0.0.1/internal")

    def test_rejects_private_ip_172_16_x(self):
        with pytest.raises(SSRFError, match="private"):
            validate_url_for_ssrf("http://172.16.0.1/internal")

    def test_rejects_private_ip_192_168_x(self):
        with pytest.raises(SSRFError, match="private"):
            validate_url_for_ssrf("http://192.168.1.1/internal")

    def test_rejects_link_local_169_254_x(self):
        with pytest.raises(SSRFError, match="private"):
            validate_url_for_ssrf("http://169.254.169.254/latest/meta-data/")

    def test_rejects_ftp_scheme(self):
        with pytest.raises(SSRFError, match="HTTP"):
            validate_url_for_ssrf("ftp://example.com/file")

    def test_rejects_file_scheme(self):
        with pytest.raises(SSRFError, match="HTTP"):
            validate_url_for_ssrf("file:///etc/passwd")

    def test_rejects_empty_hostname(self):
        with pytest.raises(SSRFError, match="hostname"):
            validate_url_for_ssrf("http:///path")


class TestIsSafeUrl:
    def test_returns_true_for_safe_url(self):
        safe, error = is_safe_url("https://example.com/page")
        assert safe is True
        assert error == ""

    def test_returns_false_for_localhost(self):
        safe, error = is_safe_url("http://localhost/admin")
        assert safe is False
        assert "localhost" in error.lower()

    def test_returns_false_for_private_ip(self):
        safe, error = is_safe_url("http://192.168.1.1/")
        assert safe is False
        assert "private" in error.lower()

    def test_returns_false_for_cloud_metadata(self):
        safe, error = is_safe_url("http://169.254.169.254/latest/meta-data/")
        assert safe is False
        assert "private" in error.lower()
