from datetime import UTC
from unittest.mock import AsyncMock

import httpx
import pytest
import respx

from intelstream.services.github_service import GitHubAPIError, GitHubService


@pytest.fixture
def github_service():
    return GitHubService(token="test-token")


class TestGitHubServiceClient:
    async def test_get_client_lazily_creates_owned_client(self) -> None:
        service = GitHubService(token="test-token")

        client = await service._get_client()

        assert service._client is client
        assert service._owns_client is True

        await service.close()

        assert service._client is None

    async def test_close_does_not_close_injected_client(self) -> None:
        client = AsyncMock(spec=httpx.AsyncClient)
        service = GitHubService(token="test-token", http_client=client)

        await service.close()

        client.aclose.assert_not_called()
        assert service._client is client


class TestGitHubServiceValidation:
    @respx.mock
    async def test_validate_repo_success(self, github_service: GitHubService) -> None:
        respx.get("https://api.github.com/repos/owner/repo").mock(
            return_value=httpx.Response(200, json={"id": 123, "full_name": "owner/repo"})
        )

        result = await github_service.validate_repo("owner", "repo")

        assert result is True
        await github_service.close()

    @respx.mock
    async def test_validate_repo_not_found(self, github_service: GitHubService) -> None:
        respx.get("https://api.github.com/repos/owner/nonexistent").mock(
            return_value=httpx.Response(404, json={"message": "Not Found"})
        )

        result = await github_service.validate_repo("owner", "nonexistent")

        assert result is False
        await github_service.close()

    @respx.mock
    async def test_validate_repo_unauthorized(self, github_service: GitHubService) -> None:
        respx.get("https://api.github.com/repos/owner/repo").mock(
            return_value=httpx.Response(401, json={"message": "Bad credentials"})
        )

        with pytest.raises(GitHubAPIError) as exc_info:
            await github_service.validate_repo("owner", "repo")

        assert exc_info.value.status_code == 401
        await github_service.close()

    @pytest.mark.parametrize(
        ("status_code", "message"),
        [
            (403, "Rate limit exceeded or access denied"),
            (500, "server exploded"),
        ],
    )
    @respx.mock
    async def test_request_normalizes_additional_error_statuses(
        self,
        github_service: GitHubService,
        status_code: int,
        message: str,
    ) -> None:
        respx.get("https://api.github.com/repos/owner/repo").mock(
            return_value=httpx.Response(status_code, text=message)
        )

        with pytest.raises(GitHubAPIError) as exc_info:
            await github_service.validate_repo("owner", "repo")

        assert exc_info.value.status_code == status_code
        assert exc_info.value.message == message
        await github_service.close()


class TestGitHubServiceCommits:
    @respx.mock
    async def test_fetch_new_commits(self, github_service: GitHubService) -> None:
        commits_response = [
            {
                "sha": "abc123def456",
                "commit": {
                    "message": "Fix bug in login\n\nThis fixes the auth issue",
                    "author": {"name": "Test User", "date": "2024-01-15T10:30:00Z"},
                },
                "author": {"login": "testuser", "avatar_url": "https://github.com/testuser.png"},
                "html_url": "https://github.com/owner/repo/commit/abc123def456",
            },
            {
                "sha": "def789ghi012",
                "commit": {
                    "message": "Add new feature",
                    "author": {"name": "Test User", "date": "2024-01-14T09:00:00Z"},
                },
                "author": {"login": "testuser", "avatar_url": "https://github.com/testuser.png"},
                "html_url": "https://github.com/owner/repo/commit/def789ghi012",
            },
        ]

        respx.get("https://api.github.com/repos/owner/repo/commits").mock(
            return_value=httpx.Response(200, json=commits_response)
        )

        events = await github_service.fetch_new_commits("owner", "repo")

        assert len(events) == 2
        assert events[0].event_type == "commit"
        assert events[0].sha == "abc123def456"
        assert events[0].title == "Fix bug in login"
        assert events[0].author == "testuser"
        assert events[0].repo_full_name == "owner/repo"
        await github_service.close()

    @respx.mock
    async def test_fetch_commits_stops_at_since_sha(self, github_service: GitHubService) -> None:
        commits_response = [
            {
                "sha": "new123",
                "commit": {
                    "message": "New commit",
                    "author": {"name": "User", "date": "2024-01-15T10:30:00Z"},
                },
                "author": {"login": "user", "avatar_url": ""},
                "html_url": "https://github.com/owner/repo/commit/new123",
            },
            {
                "sha": "old456",
                "commit": {
                    "message": "Old commit",
                    "author": {"name": "User", "date": "2024-01-14T10:30:00Z"},
                },
                "author": {"login": "user", "avatar_url": ""},
                "html_url": "https://github.com/owner/repo/commit/old456",
            },
        ]

        respx.get("https://api.github.com/repos/owner/repo/commits").mock(
            return_value=httpx.Response(200, json=commits_response)
        )

        events = await github_service.fetch_new_commits("owner", "repo", since_sha="old456")

        assert len(events) == 1
        assert events[0].sha == "new123"
        await github_service.close()

    async def test_fetch_commits_returns_empty_for_non_list_response(
        self, github_service: GitHubService
    ) -> None:
        github_service._request = AsyncMock(return_value={"message": "unexpected"})

        assert await github_service.fetch_new_commits("owner", "repo") == []

    @respx.mock
    async def test_fetch_commits_uses_committer_author_fallback(
        self, github_service: GitHubService
    ) -> None:
        respx.get("https://api.github.com/repos/owner/repo/commits").mock(
            return_value=httpx.Response(
                200,
                json=[
                    {
                        "sha": "abc123",
                        "commit": {
                            "message": "Commit from detached identity",
                            "author": {"name": "Committer Name", "date": ""},
                        },
                        "author": None,
                        "html_url": "",
                    }
                ],
            )
        )

        events = await github_service.fetch_new_commits("owner", "repo")

        assert events[0].author == "Committer Name"
        assert events[0].description is None
        assert events[0].created_at.tzinfo == UTC
        await github_service.close()


class TestGitHubServicePRs:
    @respx.mock
    async def test_fetch_new_prs(self, github_service: GitHubService) -> None:
        prs_response = [
            {
                "number": 42,
                "title": "Add new feature",
                "body": "This PR adds a cool feature",
                "state": "open",
                "merged_at": None,
                "head": {"sha": "abc123"},
                "user": {"login": "testuser", "avatar_url": "https://github.com/testuser.png"},
                "html_url": "https://github.com/owner/repo/pull/42",
                "created_at": "2024-01-15T10:30:00Z",
            },
        ]

        respx.get("https://api.github.com/repos/owner/repo/pulls").mock(
            return_value=httpx.Response(200, json=prs_response)
        )

        events = await github_service.fetch_new_prs("owner", "repo")

        assert len(events) == 1
        assert events[0].event_type == "pull_request"
        assert events[0].number == 42
        assert events[0].title == "Add new feature"
        assert events[0].state == "open"
        await github_service.close()

    @respx.mock
    async def test_fetch_merged_pr(self, github_service: GitHubService) -> None:
        prs_response = [
            {
                "number": 43,
                "title": "Merged PR",
                "body": "Was merged",
                "state": "closed",
                "merged_at": "2024-01-15T12:00:00Z",
                "head": {"sha": "abc123"},
                "user": {"login": "testuser", "avatar_url": ""},
                "html_url": "https://github.com/owner/repo/pull/43",
                "created_at": "2024-01-15T10:30:00Z",
            },
        ]

        respx.get("https://api.github.com/repos/owner/repo/pulls").mock(
            return_value=httpx.Response(200, json=prs_response)
        )

        events = await github_service.fetch_new_prs("owner", "repo")

        assert len(events) == 1
        assert events[0].state == "merged"
        await github_service.close()

    async def test_fetch_prs_returns_empty_for_non_list_response(
        self, github_service: GitHubService
    ) -> None:
        github_service._request = AsyncMock(return_value={"message": "unexpected"})

        assert await github_service.fetch_new_prs("owner", "repo") == []

    @respx.mock
    async def test_fetch_prs_stops_at_since_number_and_uses_defaults(
        self, github_service: GitHubService
    ) -> None:
        prs_response = [
            {
                "number": 44,
                "title": "New PR",
                "body": None,
                "state": "open",
                "merged_at": None,
                "head": {},
                "html_url": "",
                "created_at": "not-a-date",
            },
            {
                "number": 43,
                "title": "Old PR",
                "body": "old",
                "state": "open",
                "merged_at": None,
                "head": {},
                "user": {"login": "old", "avatar_url": ""},
                "html_url": "",
                "created_at": "2024-01-15T10:30:00Z",
            },
        ]

        respx.get("https://api.github.com/repos/owner/repo/pulls").mock(
            return_value=httpx.Response(200, json=prs_response)
        )

        events = await github_service.fetch_new_prs("owner", "repo", since_number=43)

        assert len(events) == 1
        assert events[0].number == 44
        assert events[0].author == "Unknown"
        assert events[0].description is None
        assert events[0].created_at.tzinfo == UTC
        await github_service.close()


class TestGitHubServiceIssues:
    @respx.mock
    async def test_fetch_new_issues(self, github_service: GitHubService) -> None:
        issues_response = [
            {
                "number": 10,
                "title": "Bug report",
                "body": "Something is broken",
                "state": "open",
                "user": {"login": "reporter", "avatar_url": "https://github.com/reporter.png"},
                "html_url": "https://github.com/owner/repo/issues/10",
                "created_at": "2024-01-15T10:30:00Z",
            },
        ]

        respx.get("https://api.github.com/repos/owner/repo/issues").mock(
            return_value=httpx.Response(200, json=issues_response)
        )

        events = await github_service.fetch_new_issues("owner", "repo")

        assert len(events) == 1
        assert events[0].event_type == "issue"
        assert events[0].number == 10
        assert events[0].title == "Bug report"
        await github_service.close()

    @respx.mock
    async def test_fetch_issues_excludes_prs(self, github_service: GitHubService) -> None:
        issues_response = [
            {
                "number": 10,
                "title": "Real issue",
                "body": "An issue",
                "state": "open",
                "user": {"login": "user", "avatar_url": ""},
                "html_url": "https://github.com/owner/repo/issues/10",
                "created_at": "2024-01-15T10:30:00Z",
            },
            {
                "number": 11,
                "title": "This is a PR",
                "body": "A PR disguised as issue",
                "state": "open",
                "pull_request": {"url": "https://api.github.com/repos/owner/repo/pulls/11"},
                "user": {"login": "user", "avatar_url": ""},
                "html_url": "https://github.com/owner/repo/pull/11",
                "created_at": "2024-01-15T10:30:00Z",
            },
        ]

        respx.get("https://api.github.com/repos/owner/repo/issues").mock(
            return_value=httpx.Response(200, json=issues_response)
        )

        events = await github_service.fetch_new_issues("owner", "repo")

        assert len(events) == 1
        assert events[0].number == 10
        await github_service.close()

    async def test_fetch_issues_returns_empty_for_non_list_response(
        self, github_service: GitHubService
    ) -> None:
        github_service._request = AsyncMock(return_value={"message": "unexpected"})

        assert await github_service.fetch_new_issues("owner", "repo") == []

    @respx.mock
    async def test_fetch_issues_stops_at_since_number_and_uses_defaults(
        self, github_service: GitHubService
    ) -> None:
        issues_response = [
            {
                "number": 12,
                "title": "New issue",
                "body": "X" * 600,
                "html_url": "",
                "created_at": "",
            },
            {
                "number": 11,
                "title": "Old issue",
                "body": "old",
                "state": "closed",
                "user": {"login": "old", "avatar_url": ""},
                "html_url": "",
                "created_at": "2024-01-15T10:30:00Z",
            },
        ]

        respx.get("https://api.github.com/repos/owner/repo/issues").mock(
            return_value=httpx.Response(200, json=issues_response)
        )

        events = await github_service.fetch_new_issues("owner", "repo", since_number=11)

        assert len(events) == 1
        assert events[0].number == 12
        assert events[0].author == "Unknown"
        assert events[0].state == "open"
        assert events[0].description is not None
        assert events[0].description.endswith("...")
        assert events[0].created_at.tzinfo == UTC
        await github_service.close()


class TestGitHubServiceHelpers:
    def test_parse_datetime_returns_now_for_empty_and_invalid_values(
        self, github_service: GitHubService
    ) -> None:
        assert github_service._parse_datetime("").tzinfo == UTC
        assert github_service._parse_datetime("not-a-date").tzinfo == UTC

    @pytest.mark.parametrize("text", [None, ""])
    def test_truncate_returns_none_for_empty_values(
        self, github_service: GitHubService, text: str | None
    ) -> None:
        assert github_service._truncate(text, 10) is None

    def test_truncate_short_and_long_values(self, github_service: GitHubService) -> None:
        assert github_service._truncate("short", 10) == "short"
        assert github_service._truncate("abcdefghijk", 10) == "abcdefg..."
