import httpx
import pytest
import respx

from intelstream.services.github_service import GitHubAPIError, GitHubService


@pytest.fixture
def github_service():
    return GitHubService(token="test-token")


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
