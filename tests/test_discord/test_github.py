from intelstream.discord.cogs.github import parse_github_url


class TestParseGitHubUrl:
    def test_parse_full_url(self) -> None:
        result = parse_github_url("https://github.com/owner/repo")
        assert result == ("owner", "repo")

    def test_parse_url_with_trailing_slash(self) -> None:
        result = parse_github_url("https://github.com/owner/repo/")
        assert result == ("owner", "repo")

    def test_parse_url_with_git_extension(self) -> None:
        result = parse_github_url("https://github.com/owner/repo.git")
        assert result == ("owner", "repo")

    def test_parse_url_without_https(self) -> None:
        result = parse_github_url("http://github.com/owner/repo")
        assert result == ("owner", "repo")

    def test_parse_url_without_protocol(self) -> None:
        result = parse_github_url("github.com/owner/repo")
        assert result == ("owner", "repo")

    def test_parse_url_with_www(self) -> None:
        result = parse_github_url("https://www.github.com/owner/repo")
        assert result == ("owner", "repo")

    def test_parse_owner_repo_format(self) -> None:
        result = parse_github_url("owner/repo")
        assert result == ("owner", "repo")

    def test_parse_owner_repo_with_whitespace(self) -> None:
        result = parse_github_url("  owner/repo  ")
        assert result == ("owner", "repo")

    def test_parse_invalid_url_no_repo(self) -> None:
        result = parse_github_url("https://github.com/owner")
        assert result is None

    def test_parse_invalid_url_random_string(self) -> None:
        result = parse_github_url("not-a-url")
        assert result is None

    def test_parse_invalid_url_different_domain(self) -> None:
        result = parse_github_url("https://gitlab.com/owner/repo")
        assert result is None

    def test_parse_empty_string(self) -> None:
        result = parse_github_url("")
        assert result is None

    def test_parse_owner_with_hyphen(self) -> None:
        result = parse_github_url("https://github.com/my-org/my-repo")
        assert result == ("my-org", "my-repo")

    def test_parse_owner_with_numbers(self) -> None:
        result = parse_github_url("https://github.com/user123/repo456")
        assert result == ("user123", "repo456")

    def test_parse_normalizes_to_lowercase(self) -> None:
        result = parse_github_url("https://github.com/MyOrg/MyRepo")
        assert result == ("myorg", "myrepo")

    def test_parse_owner_repo_normalizes_to_lowercase(self) -> None:
        result = parse_github_url("Owner/Repo")
        assert result == ("owner", "repo")
