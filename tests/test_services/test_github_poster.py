from datetime import UTC, datetime

import discord
import pytest

from intelstream.services.github_poster import GitHubPoster
from intelstream.services.github_service import GitHubEvent


@pytest.fixture
def poster():
    return GitHubPoster()


def make_commit_event(
    sha: str = "abc123def456",
    title: str = "Fix bug",
    description: str | None = None,
    author: str = "testuser",
) -> GitHubEvent:
    return GitHubEvent(
        event_type="commit",
        repo_full_name="owner/repo",
        number=None,
        sha=sha,
        title=title,
        description=description,
        author=author,
        author_avatar_url="https://github.com/testuser.png",
        url=f"https://github.com/owner/repo/commit/{sha}",
        created_at=datetime(2024, 1, 15, 10, 30, 0, tzinfo=UTC),
        state=None,
    )


def make_pr_event(
    number: int = 42,
    title: str = "Add feature",
    state: str = "open",
) -> GitHubEvent:
    return GitHubEvent(
        event_type="pull_request",
        repo_full_name="owner/repo",
        number=number,
        sha="abc123",
        title=title,
        description="This PR adds something",
        author="testuser",
        author_avatar_url="https://github.com/testuser.png",
        url=f"https://github.com/owner/repo/pull/{number}",
        created_at=datetime(2024, 1, 15, 10, 30, 0, tzinfo=UTC),
        state=state,
    )


def make_issue_event(
    number: int = 10,
    title: str = "Bug report",
    state: str = "open",
) -> GitHubEvent:
    return GitHubEvent(
        event_type="issue",
        repo_full_name="owner/repo",
        number=number,
        sha=None,
        title=title,
        description="Something is broken",
        author="reporter",
        author_avatar_url="https://github.com/reporter.png",
        url=f"https://github.com/owner/repo/issues/{number}",
        created_at=datetime(2024, 1, 15, 10, 30, 0, tzinfo=UTC),
        state=state,
    )


class TestCommitFormatting:
    def test_format_commit_basic(self, poster: GitHubPoster) -> None:
        event = make_commit_event()
        embed = poster.format_event(event)

        assert isinstance(embed, discord.Embed)
        assert "abc123d" in embed.title
        assert "Fix bug" in embed.title
        assert embed.url == "https://github.com/owner/repo/commit/abc123def456"
        assert embed.color == GitHubPoster.COLORS["commit"]

    def test_format_commit_with_description(self, poster: GitHubPoster) -> None:
        event = make_commit_event(
            title="Fix bug",
            description="Fix bug\n\nThis fixes the auth issue in login flow",
        )
        embed = poster.format_event(event)

        assert embed.description is not None
        assert "auth issue" in embed.description

    def test_format_commit_long_title_truncated(self, poster: GitHubPoster) -> None:
        long_title = "A" * 300
        event = make_commit_event(title=long_title)
        embed = poster.format_event(event)

        assert len(embed.title) <= 256


class TestPRFormatting:
    def test_format_pr_open(self, poster: GitHubPoster) -> None:
        event = make_pr_event(state="open")
        embed = poster.format_event(event)

        assert "PR #42" in embed.title
        assert embed.color == GitHubPoster.COLORS["pull_request"]
        assert any(field.value == "Open" for field in embed.fields)

    def test_format_pr_merged(self, poster: GitHubPoster) -> None:
        event = make_pr_event(state="merged")
        embed = poster.format_event(event)

        assert embed.color == GitHubPoster.COLORS["pull_request_merged"]
        assert any(field.value == "Merged" for field in embed.fields)

    def test_format_pr_closed(self, poster: GitHubPoster) -> None:
        event = make_pr_event(state="closed")
        embed = poster.format_event(event)

        assert embed.color == GitHubPoster.COLORS["pull_request_closed"]
        assert any(field.value == "Closed" for field in embed.fields)


class TestIssueFormatting:
    def test_format_issue_open(self, poster: GitHubPoster) -> None:
        event = make_issue_event(state="open")
        embed = poster.format_event(event)

        assert "Issue #10" in embed.title
        assert embed.color == GitHubPoster.COLORS["issue"]
        assert any(field.value == "Open" for field in embed.fields)

    def test_format_issue_closed(self, poster: GitHubPoster) -> None:
        event = make_issue_event(state="closed")
        embed = poster.format_event(event)

        assert embed.color == GitHubPoster.COLORS["issue_closed"]
        assert any(field.value == "Closed" for field in embed.fields)


class TestEmbedCommonProperties:
    def test_embed_has_author(self, poster: GitHubPoster) -> None:
        event = make_commit_event()
        embed = poster.format_event(event)

        assert embed.author.name == "testuser"

    def test_embed_has_footer(self, poster: GitHubPoster) -> None:
        event = make_commit_event()
        embed = poster.format_event(event)

        assert embed.footer.text == "owner/repo"

    def test_embed_has_timestamp(self, poster: GitHubPoster) -> None:
        event = make_commit_event()
        embed = poster.format_event(event)

        assert embed.timestamp is not None
