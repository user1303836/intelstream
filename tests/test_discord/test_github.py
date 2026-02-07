from unittest.mock import AsyncMock, MagicMock

from intelstream.discord.cogs.github import GitHubCommands, parse_github_url


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


class TestRepoAutocomplete:
    async def test_returns_matching_repos(self) -> None:
        mock_bot = MagicMock()
        repo1 = MagicMock()
        repo1.owner = "acme"
        repo1.repo = "backend"
        repo1.guild_id = "123"

        repo2 = MagicMock()
        repo2.owner = "acme"
        repo2.repo = "frontend"
        repo2.guild_id = "123"

        mock_bot.repository.get_all_github_repos = AsyncMock(return_value=[repo1, repo2])

        cog = GitHubCommands(mock_bot)
        interaction = MagicMock()
        interaction.guild_id = 123

        choices = await cog._repo_autocomplete(interaction, "back")

        assert len(choices) == 1
        assert choices[0].name == "acme/backend"
        assert choices[0].value == "acme/backend"

    async def test_filters_by_guild(self) -> None:
        mock_bot = MagicMock()
        repo1 = MagicMock()
        repo1.owner = "acme"
        repo1.repo = "api"
        repo1.guild_id = "123"

        repo2 = MagicMock()
        repo2.owner = "other"
        repo2.repo = "api"
        repo2.guild_id = "999"

        mock_bot.repository.get_all_github_repos = AsyncMock(return_value=[repo1, repo2])

        cog = GitHubCommands(mock_bot)
        interaction = MagicMock()
        interaction.guild_id = 123

        choices = await cog._repo_autocomplete(interaction, "")

        assert len(choices) == 1
        assert choices[0].name == "acme/api"

    async def test_returns_all_when_empty_query(self) -> None:
        mock_bot = MagicMock()
        repo1 = MagicMock()
        repo1.owner = "acme"
        repo1.repo = "api"
        repo1.guild_id = "123"

        repo2 = MagicMock()
        repo2.owner = "acme"
        repo2.repo = "web"
        repo2.guild_id = "123"

        mock_bot.repository.get_all_github_repos = AsyncMock(return_value=[repo1, repo2])

        cog = GitHubCommands(mock_bot)
        interaction = MagicMock()
        interaction.guild_id = 123

        choices = await cog._repo_autocomplete(interaction, "")

        assert len(choices) == 2

    async def test_limits_to_25_choices(self) -> None:
        mock_bot = MagicMock()
        repos = []
        for i in range(30):
            r = MagicMock()
            r.owner = "acme"
            r.repo = f"repo-{i}"
            r.guild_id = "123"
            repos.append(r)

        mock_bot.repository.get_all_github_repos = AsyncMock(return_value=repos)

        cog = GitHubCommands(mock_bot)
        interaction = MagicMock()
        interaction.guild_id = 123

        choices = await cog._repo_autocomplete(interaction, "")

        assert len(choices) == 25
