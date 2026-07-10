from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import discord
import pytest
from discord import app_commands

from intelstream.discord.cogs.github import (
    ConfirmGitHubRemoveView,
    GitHubCommands,
    parse_github_url,
    setup,
)
from intelstream.services.github_service import GitHubAPIError


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


def make_interaction(
    *,
    guild_id: int | None = 456,
    channel: MagicMock | None = None,
) -> MagicMock:
    interaction = MagicMock(spec=discord.Interaction)
    interaction.response = MagicMock()
    interaction.response.defer = AsyncMock()
    interaction.response.send_message = AsyncMock()
    interaction.followup = MagicMock()
    interaction.followup.send = AsyncMock()
    interaction.edit_original_response = AsyncMock()
    interaction.user = MagicMock()
    interaction.user.id = 123
    interaction.guild_id = guild_id
    interaction.channel = channel
    return interaction


def make_channel(channel_id: int = 789, name: str = "updates") -> MagicMock:
    channel = MagicMock(spec=discord.TextChannel)
    channel.id = channel_id
    channel.name = name
    return channel


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


class TestConfirmGitHubRemoveView:
    async def test_confirm_button_marks_view_confirmed(self) -> None:
        view = ConfirmGitHubRemoveView()
        interaction = make_interaction()

        await view.children[0].callback(interaction)

        assert view.confirmed is True
        assert view.is_finished() is True
        interaction.response.defer.assert_awaited_once()

    async def test_cancel_button_marks_view_cancelled(self) -> None:
        view = ConfirmGitHubRemoveView()
        interaction = make_interaction()

        await view.children[1].callback(interaction)

        assert view.confirmed is False
        assert view.is_finished() is True
        interaction.response.defer.assert_awaited_once()


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


class TestGitHubServiceLifecycle:
    def test_get_github_service_returns_none_without_token(self, github_commands, mock_bot):
        mock_bot.settings.github_token = None

        assert github_commands._get_github_service() is None

    def test_get_github_service_caches_created_service(self, github_commands):
        with patch("intelstream.discord.cogs.github.GitHubService") as service_cls:
            first = github_commands._get_github_service()
            second = github_commands._get_github_service()

        assert first is second
        service_cls.assert_called_once_with(token="test-token")

    async def test_cog_unload_closes_cached_service(self, github_commands):
        service = MagicMock()
        service.close = AsyncMock()
        github_commands._github_service = service

        await github_commands.cog_unload()

        service.close.assert_awaited_once()

    async def test_cog_unload_without_cached_service_noops(self, github_commands):
        github_commands._github_service = None

        await github_commands.cog_unload()


class TestGitHubAdd:
    async def test_add_reports_missing_token(self, github_commands, mock_bot):
        mock_bot.settings.github_token = None
        interaction = make_interaction(channel=make_channel())

        await github_commands.github_add.callback(github_commands, interaction, repo_url="org/repo")

        call_args = interaction.followup.send.call_args
        assert "No GitHub token" in call_args.args[0]
        assert call_args.kwargs["ephemeral"] is True

    async def test_add_rejects_invalid_repo_url(self, github_commands):
        github_commands._get_github_service = MagicMock(return_value=MagicMock())
        interaction = make_interaction(channel=make_channel())

        await github_commands.github_add.callback(
            github_commands, interaction, repo_url="not-a-repo"
        )

        assert "Invalid GitHub URL" in interaction.followup.send.call_args.args[0]

    async def test_add_requires_target_channel(self, github_commands):
        github_commands._get_github_service = MagicMock(return_value=MagicMock())
        interaction = make_interaction(channel=None)

        await github_commands.github_add.callback(github_commands, interaction, repo_url="org/repo")

        assert "target channel" in interaction.followup.send.call_args.args[0]

    async def test_add_requires_guild(self, github_commands):
        github_commands._get_github_service = MagicMock(return_value=MagicMock())
        interaction = make_interaction(guild_id=None, channel=make_channel())

        await github_commands.github_add.callback(github_commands, interaction, repo_url="org/repo")

        assert "only be used in a server" in interaction.followup.send.call_args.args[0]

    async def test_add_rejects_existing_repo(self, github_commands, mock_bot):
        github_commands._get_github_service = MagicMock(return_value=MagicMock())
        interaction = make_interaction(channel=make_channel())
        existing = MagicMock()
        existing.channel_id = "999"
        mock_bot.repository.get_github_repo = AsyncMock(return_value=existing)

        await github_commands.github_add.callback(github_commands, interaction, repo_url="org/repo")

        assert "already being monitored" in interaction.followup.send.call_args.args[0]

    async def test_add_rejects_inaccessible_repo(self, github_commands, mock_bot):
        service = MagicMock()
        service.validate_repo = AsyncMock(return_value=False)
        github_commands._get_github_service = MagicMock(return_value=service)
        interaction = make_interaction(channel=make_channel())
        mock_bot.repository.get_github_repo = AsyncMock(return_value=None)

        await github_commands.github_add.callback(github_commands, interaction, repo_url="org/repo")

        assert "not found or is not accessible" in interaction.followup.send.call_args.args[0]

    async def test_add_reports_validation_api_error(self, github_commands, mock_bot):
        service = MagicMock()
        service.validate_repo = AsyncMock(side_effect=GitHubAPIError(403, "rate limited"))
        github_commands._get_github_service = MagicMock(return_value=service)
        interaction = make_interaction(channel=make_channel())
        mock_bot.repository.get_github_repo = AsyncMock(return_value=None)

        await github_commands.github_add.callback(github_commands, interaction, repo_url="org/repo")

        assert "rate limited" in interaction.followup.send.call_args.args[0]

    async def test_add_success_saves_repo_and_sends_embed(self, github_commands, mock_bot):
        service = MagicMock()
        service.validate_repo = AsyncMock(return_value=True)
        github_commands._get_github_service = MagicMock(return_value=service)
        channel = make_channel(channel_id=321)
        interaction = make_interaction(channel=channel)
        mock_bot.repository.get_github_repo = AsyncMock(return_value=None)
        stored = MagicMock()
        stored.id = 42
        mock_bot.repository.add_github_repo = AsyncMock(return_value=stored)

        await github_commands.github_add.callback(
            github_commands,
            interaction,
            repo_url="Org/Repo",
            track_commits=True,
            track_prs=False,
            track_issues=True,
        )

        mock_bot.repository.add_github_repo.assert_awaited_once_with(
            guild_id="456",
            channel_id="321",
            owner="org",
            repo="repo",
            track_commits=True,
            track_prs=False,
            track_issues=True,
        )
        embed = interaction.followup.send.call_args.kwargs["embed"]
        assert embed.title == "GitHub Repository Added"
        assert "Commits, Issues" in embed.fields[2].value

    async def test_add_success_can_track_only_prs(self, github_commands, mock_bot):
        service = MagicMock()
        service.validate_repo = AsyncMock(return_value=True)
        github_commands._get_github_service = MagicMock(return_value=service)
        interaction = make_interaction(channel=make_channel(channel_id=321))
        mock_bot.repository.get_github_repo = AsyncMock(return_value=None)
        stored = MagicMock()
        stored.id = 42
        mock_bot.repository.add_github_repo = AsyncMock(return_value=stored)

        await github_commands.github_add.callback(
            github_commands,
            interaction,
            repo_url="Org/Repo",
            track_commits=False,
            track_prs=True,
            track_issues=False,
        )

        embed = interaction.followup.send.call_args.kwargs["embed"]
        assert embed.fields[2].value == "PRs"


class TestGitHubList:
    async def test_list_requires_target_channel(self, github_commands):
        interaction = make_interaction(channel=None)

        await github_commands.github_list.callback(github_commands, interaction)

        assert "target channel" in interaction.followup.send.call_args.args[0]

    async def test_list_reports_empty_channel(self, github_commands, mock_bot):
        channel = make_channel(channel_id=321)
        interaction = make_interaction(channel=channel)
        mock_bot.repository.get_github_repos_for_channel = AsyncMock(return_value=[])

        await github_commands.github_list.callback(github_commands, interaction)

        assert "No GitHub repositories" in interaction.followup.send.call_args.args[0]
        mock_bot.repository.get_github_repos_for_channel.assert_awaited_once_with("321")

    async def test_list_formats_active_paused_and_failing_repos(self, github_commands, mock_bot):
        channel = make_channel(channel_id=321, name="dev")
        interaction = make_interaction(channel=channel)
        active = MagicMock()
        active.owner = "org"
        active.repo = "active"
        active.is_active = True
        active.consecutive_failures = 0
        active.track_commits = True
        active.track_prs = True
        active.track_issues = False
        active.last_polled_at = datetime(2026, 5, 25, 12, tzinfo=UTC)
        paused = MagicMock()
        paused.owner = "org"
        paused.repo = "paused"
        paused.is_active = False
        paused.consecutive_failures = 0
        paused.track_commits = False
        paused.track_prs = False
        paused.track_issues = True
        paused.last_polled_at = None
        failing = MagicMock()
        failing.owner = "org"
        failing.repo = "failing"
        failing.is_active = True
        failing.consecutive_failures = 3
        failing.track_commits = False
        failing.track_prs = True
        failing.track_issues = True
        failing.last_polled_at = None
        mock_bot.repository.get_github_repos_for_channel = AsyncMock(
            return_value=[active, paused, failing]
        )

        await github_commands.github_list.callback(github_commands, interaction)

        embed = interaction.followup.send.call_args.kwargs["embed"]
        values = "\n".join(field.value for field in embed.fields)
        assert embed.title == "GitHub Repositories in #dev"
        assert embed.fields[0].name == "[ON] org/active"
        assert embed.fields[1].name == "[OFF] org/paused"
        assert "Failing (3 errors)" in values
        assert "Never" in values

    async def test_list_caps_embed_fields_and_reports_total(self, github_commands, mock_bot):
        channel = make_channel(channel_id=321, name="dev")
        interaction = make_interaction(channel=channel)
        repos = []
        for index in range(30):
            repo = MagicMock()
            repo.owner = "o" * 255
            repo.repo = f"repo-{index}-" + ("r" * 255)
            repo.is_active = True
            repo.consecutive_failures = 0
            repo.track_commits = True
            repo.track_prs = False
            repo.track_issues = False
            repo.last_polled_at = None
            repos.append(repo)
        mock_bot.repository.get_github_repos_for_channel = AsyncMock(return_value=repos)

        await github_commands.github_list.callback(github_commands, interaction)

        embed = interaction.followup.send.call_args.kwargs["embed"]
        assert 0 < len(embed.fields) < 25
        assert all(len(field.name) <= 256 for field in embed.fields)
        total_text = (
            len(embed.title or "")
            + len(embed.footer.text or "")
            + sum(len(field.name) + len(field.value) for field in embed.fields)
        )
        assert total_text <= 6000
        assert embed.footer.text == f"Showing {len(embed.fields)} of 30 repositories"


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

    async def test_remove_rejects_invalid_repo_format(self, github_commands):
        interaction = make_interaction(channel=make_channel())

        await github_commands.github_remove.callback(
            github_commands, interaction, repo="not-a-repo"
        )

        assert "Invalid repository format" in interaction.followup.send.call_args.args[0]

    async def test_remove_requires_guild(self, github_commands):
        interaction = make_interaction(guild_id=None, channel=make_channel())

        await github_commands.github_remove.callback(github_commands, interaction, repo="org/repo")

        assert "only be used in a server" in interaction.followup.send.call_args.args[0]

    @patch("intelstream.discord.cogs.github.ConfirmGitHubRemoveView")
    async def test_remove_treats_timeout_as_cancelled(
        self, mock_view_cls, github_commands, mock_bot
    ):
        view = self._make_confirmed_view()
        view.wait = AsyncMock(return_value=True)
        mock_view_cls.return_value = view
        interaction = make_interaction(channel=make_channel())
        mock_repo = MagicMock()
        mock_repo.channel_id = "789"
        mock_repo.is_active = False
        mock_repo.track_commits = False
        mock_repo.track_prs = False
        mock_repo.track_issues = False
        mock_bot.repository.get_github_repo = AsyncMock(return_value=mock_repo)

        await github_commands.github_remove.callback(github_commands, interaction, repo="org/repo")

        mock_bot.repository.delete_github_repo.assert_not_called()
        assert "cancelled" in interaction.edit_original_response.call_args.kwargs["content"]

    @patch("intelstream.discord.cogs.github.ConfirmGitHubRemoveView")
    async def test_remove_reports_already_removed(self, mock_view_cls, github_commands, mock_bot):
        mock_view_cls.return_value = self._make_confirmed_view()
        interaction = make_interaction(channel=make_channel())
        mock_repo = MagicMock()
        mock_repo.channel_id = "789"
        mock_repo.is_active = True
        mock_repo.track_commits = False
        mock_repo.track_prs = False
        mock_repo.track_issues = False
        mock_bot.repository.get_github_repo = AsyncMock(return_value=mock_repo)
        mock_bot.repository.delete_github_repo = AsyncMock(return_value=False)

        await github_commands.github_remove.callback(github_commands, interaction, repo="org/repo")

        assert "already removed" in interaction.edit_original_response.call_args.kwargs["content"]

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


class TestGitHubToggle:
    async def test_toggle_rejects_invalid_repo_format(self, github_commands):
        interaction = make_interaction(channel=make_channel())

        await github_commands.github_toggle.callback(
            github_commands, interaction, repo="not-a-repo"
        )

        assert "Invalid repository format" in interaction.followup.send.call_args.args[0]

    async def test_toggle_requires_guild(self, github_commands):
        interaction = make_interaction(guild_id=None, channel=make_channel())

        await github_commands.github_toggle.callback(github_commands, interaction, repo="org/repo")

        assert "only be used in a server" in interaction.followup.send.call_args.args[0]

    async def test_toggle_reports_missing_repo(self, github_commands, mock_bot):
        interaction = make_interaction(channel=make_channel())
        mock_bot.repository.get_github_repo = AsyncMock(return_value=None)

        await github_commands.github_toggle.callback(github_commands, interaction, repo="org/repo")

        assert "not being monitored" in interaction.followup.send.call_args.args[0]

    @pytest.mark.parametrize(
        ("initial_state", "expected_state", "expected_word"),
        [(True, False, "disabled"), (False, True, "enabled")],
    )
    async def test_toggle_flips_repo_state(
        self,
        github_commands,
        mock_bot,
        initial_state: bool,
        expected_state: bool,
        expected_word: str,
    ):
        interaction = make_interaction(channel=make_channel())
        repo = MagicMock()
        repo.id = 42
        repo.is_active = initial_state
        mock_bot.repository.get_github_repo = AsyncMock(return_value=repo)
        mock_bot.repository.set_github_repo_active = AsyncMock()

        await github_commands.github_toggle.callback(github_commands, interaction, repo="org/repo")

        mock_bot.repository.set_github_repo_active.assert_awaited_once_with(42, expected_state)
        assert expected_word in interaction.followup.send.call_args.args[0]

    async def test_remove_autocomplete_delegates_to_repo_autocomplete(self, github_commands):
        interaction = make_interaction(channel=make_channel())
        choice = app_commands.Choice(name="[ON] org/repo", value="org/repo")
        github_commands._github_repo_autocomplete = AsyncMock(return_value=[choice])

        choices = await github_commands.github_remove_autocomplete(interaction, "org")

        assert choices == [choice]
        github_commands._github_repo_autocomplete.assert_awaited_once_with(interaction, "org")

    async def test_toggle_autocomplete_delegates_to_repo_autocomplete(self, github_commands):
        interaction = make_interaction(channel=make_channel())
        choice = app_commands.Choice(name="[ON] org/repo", value="org/repo")
        github_commands._github_repo_autocomplete = AsyncMock(return_value=[choice])

        choices = await github_commands.github_toggle_autocomplete(interaction, "org")

        assert choices == [choice]
        github_commands._github_repo_autocomplete.assert_awaited_once_with(interaction, "org")


def test_github_toggle_description_matches_pause_behavior(github_commands):
    assert (
        github_commands.github_toggle.description == "Pause or resume GitHub repository monitoring"
    )


class TestGitHubErrorHandlers:
    @pytest.mark.parametrize(
        ("handler_name", "expected"),
        [
            ("github_add_error", "add GitHub repositories"),
            ("github_remove_error", "remove GitHub repositories"),
            ("github_toggle_error", "toggle GitHub repositories"),
        ],
    )
    async def test_missing_permission_errors_send_ephemeral_message(
        self, github_commands, handler_name: str, expected: str
    ):
        interaction = make_interaction(channel=make_channel())
        error = app_commands.MissingPermissions(["manage_guild"])

        await getattr(github_commands, handler_name)(interaction, error)

        interaction.response.send_message.assert_awaited_once()
        assert expected in interaction.response.send_message.call_args.args[0]
        assert interaction.response.send_message.call_args.kwargs["ephemeral"] is True

    @pytest.mark.parametrize(
        "handler_name",
        ["github_add_error", "github_remove_error", "github_toggle_error"],
    )
    async def test_non_permission_errors_are_reraised(self, github_commands, handler_name: str):
        interaction = make_interaction(channel=make_channel())
        error = app_commands.CommandInvokeError(MagicMock(), RuntimeError("boom"))

        with pytest.raises(app_commands.CommandInvokeError):
            await getattr(github_commands, handler_name)(interaction, error)


class TestSetup:
    async def test_setup_registers_cog(self):
        bot = MagicMock()
        bot.add_cog = AsyncMock()

        await setup(bot)

        [cog] = bot.add_cog.await_args.args
        assert isinstance(cog, GitHubCommands)
        assert cog.bot is bot
