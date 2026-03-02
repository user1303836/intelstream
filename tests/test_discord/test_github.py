from unittest.mock import AsyncMock, MagicMock, patch

import discord
import pytest

from intelstream.discord.cogs.github import (
    ConfirmGitHubRemoveView,
    GitHubCommands,
    parse_github_url,
)


@pytest.fixture
def mock_bot():
    bot = MagicMock()
    bot.repository = MagicMock()
    bot.settings = MagicMock()
    bot.settings.github_token = "test-token"
    return bot


@pytest.fixture
def github_commands(mock_bot):
    return GitHubCommands(mock_bot)


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


class TestGitHubAutocomplete:
    def _make_repo(self, owner: str, repo: str, is_active: bool) -> MagicMock:
        r = MagicMock()
        r.owner = owner
        r.repo = repo
        r.is_active = is_active
        return r

    async def test_autocomplete_returns_matching_repos(self, github_commands, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.guild_id = 456

        repos = [
            self._make_repo("org", "frontend", True),
            self._make_repo("org", "backend", False),
            self._make_repo("other", "lib", True),
        ]
        mock_bot.repository.get_github_repos_for_guild = AsyncMock(return_value=repos)

        choices = await github_commands._github_repo_autocomplete(interaction, "back")

        assert len(choices) == 1
        assert choices[0].value == "org/backend"
        assert "[OFF]" in choices[0].name

    async def test_autocomplete_returns_all_on_empty_input(self, github_commands, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.guild_id = 456

        repos = [
            self._make_repo("org", "a", True),
            self._make_repo("org", "b", True),
        ]
        mock_bot.repository.get_github_repos_for_guild = AsyncMock(return_value=repos)

        choices = await github_commands._github_repo_autocomplete(interaction, "")

        assert len(choices) == 2

    async def test_autocomplete_limits_to_25(self, github_commands, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.guild_id = 456

        repos = [self._make_repo("org", f"repo-{i}", True) for i in range(30)]
        mock_bot.repository.get_github_repos_for_guild = AsyncMock(return_value=repos)

        choices = await github_commands._github_repo_autocomplete(interaction, "")

        assert len(choices) == 25

    async def test_autocomplete_no_guild(self, github_commands):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.guild_id = None

        choices = await github_commands._github_repo_autocomplete(interaction, "")

        assert choices == []

    async def test_autocomplete_includes_status_indicator(self, github_commands, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.guild_id = 456

        repos = [
            self._make_repo("org", "active-repo", True),
            self._make_repo("org", "paused-repo", False),
        ]
        mock_bot.repository.get_github_repos_for_guild = AsyncMock(return_value=repos)

        choices = await github_commands._github_repo_autocomplete(interaction, "")

        assert "[ON]" in choices[0].name
        assert "[OFF]" in choices[1].name


class TestGitHubRemoveConfirmation:
    def _make_confirmed_view(self) -> MagicMock:
        view = MagicMock(spec=ConfirmGitHubRemoveView)
        view.confirmed = True
        view.wait = AsyncMock(return_value=False)
        return view

    def _make_cancelled_view(self) -> MagicMock:
        view = MagicMock(spec=ConfirmGitHubRemoveView)
        view.confirmed = False
        view.wait = AsyncMock(return_value=False)
        return view

    @patch("intelstream.discord.cogs.github.ConfirmGitHubRemoveView")
    async def test_remove_confirmed(self, mock_view_cls, github_commands, mock_bot):
        mock_view_cls.return_value = self._make_confirmed_view()

        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.edit_original_response = AsyncMock()
        interaction.user = MagicMock()
        interaction.user.id = 123
        interaction.guild_id = 456

        mock_repo = MagicMock()
        mock_repo.channel_id = "789"
        mock_repo.is_active = True
        mock_repo.track_commits = True
        mock_repo.track_prs = True
        mock_repo.track_issues = False
        mock_bot.repository.get_github_repo = AsyncMock(return_value=mock_repo)
        mock_bot.repository.delete_github_repo = AsyncMock(return_value=True)

        await github_commands.github_remove.callback(github_commands, interaction, repo="org/repo")

        mock_bot.repository.delete_github_repo.assert_called_once_with("456", "org", "repo")
        msg = interaction.edit_original_response.call_args.kwargs["content"]
        assert "Stopped monitoring" in msg

    @patch("intelstream.discord.cogs.github.ConfirmGitHubRemoveView")
    async def test_remove_cancelled(self, mock_view_cls, github_commands, mock_bot):
        mock_view_cls.return_value = self._make_cancelled_view()

        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.edit_original_response = AsyncMock()
        interaction.guild_id = 456

        mock_repo = MagicMock()
        mock_repo.channel_id = "789"
        mock_repo.is_active = True
        mock_repo.track_commits = True
        mock_repo.track_prs = False
        mock_repo.track_issues = False
        mock_bot.repository.get_github_repo = AsyncMock(return_value=mock_repo)

        await github_commands.github_remove.callback(github_commands, interaction, repo="org/repo")

        mock_bot.repository.delete_github_repo.assert_not_called()
        msg = interaction.edit_original_response.call_args.kwargs["content"]
        assert "cancelled" in msg

    async def test_remove_repo_not_found(self, github_commands, mock_bot):
        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.guild_id = 456

        mock_bot.repository.get_github_repo = AsyncMock(return_value=None)

        await github_commands.github_remove.callback(github_commands, interaction, repo="org/repo")

        mock_bot.repository.delete_github_repo.assert_not_called()
        call_args = interaction.followup.send.call_args
        assert "not being monitored" in call_args[0][0]

    @patch("intelstream.discord.cogs.github.ConfirmGitHubRemoveView")
    async def test_remove_shows_confirmation_embed(self, mock_view_cls, github_commands, mock_bot):
        mock_view_cls.return_value = self._make_cancelled_view()

        interaction = MagicMock(spec=discord.Interaction)
        interaction.response = MagicMock()
        interaction.response.defer = AsyncMock()
        interaction.followup = MagicMock()
        interaction.followup.send = AsyncMock()
        interaction.edit_original_response = AsyncMock()
        interaction.guild_id = 456

        mock_repo = MagicMock()
        mock_repo.channel_id = "789"
        mock_repo.is_active = True
        mock_repo.track_commits = True
        mock_repo.track_prs = True
        mock_repo.track_issues = True
        mock_bot.repository.get_github_repo = AsyncMock(return_value=mock_repo)

        await github_commands.github_remove.callback(github_commands, interaction, repo="org/repo")

        call_kwargs = interaction.followup.send.call_args.kwargs
        embed = call_kwargs["embed"]
        assert embed.title == "Confirm Repository Removal"
        assert "org/repo" in embed.description
