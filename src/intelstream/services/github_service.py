from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, cast

import httpx
import structlog

logger = structlog.get_logger()

GitHubEventType = Literal["commit", "pull_request", "issue"]


@dataclass
class GitHubEvent:
    event_type: GitHubEventType
    repo_full_name: str
    number: int | None
    sha: str | None
    title: str
    description: str | None
    author: str
    author_avatar_url: str
    url: str
    created_at: datetime
    state: str | None = None


class GitHubAPIError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(f"GitHub API error ({status_code}): {message}")


class GitHubService:
    BASE_URL = "https://api.github.com"

    def __init__(self, token: str, http_client: httpx.AsyncClient | None = None) -> None:
        self._token = token
        self._client = http_client
        self._owns_client = http_client is None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
            self._owns_client = True
        return self._client

    async def close(self) -> None:
        if self._client and self._owns_client:
            await self._client.aclose()
            self._client = None

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def _request(
        self, method: str, path: str, **kwargs: Any
    ) -> dict[str, Any] | list[dict[str, Any]]:
        client = await self._get_client()
        url = f"{self.BASE_URL}{path}"
        response = await client.request(method, url, headers=self._headers(), **kwargs)

        if response.status_code == 404:
            raise GitHubAPIError(404, "Repository not found")
        if response.status_code == 401:
            raise GitHubAPIError(401, "Invalid or expired token")
        if response.status_code == 403:
            raise GitHubAPIError(403, "Rate limit exceeded or access denied")
        if response.status_code >= 400:
            raise GitHubAPIError(response.status_code, response.text)

        return cast("dict[str, Any] | list[dict[str, Any]]", response.json())

    async def validate_repo(self, owner: str, repo: str) -> bool:
        try:
            await self._request("GET", f"/repos/{owner}/{repo}")
            return True
        except GitHubAPIError as e:
            if e.status_code == 404:
                return False
            raise

    async def fetch_new_commits(
        self, owner: str, repo: str, since_sha: str | None = None, limit: int = 10
    ) -> list[GitHubEvent]:
        path = f"/repos/{owner}/{repo}/commits"
        params = {"per_page": limit}

        data = await self._request("GET", path, params=params)
        if not isinstance(data, list):
            return []

        events = []
        for commit in data:
            sha = commit.get("sha", "")

            if since_sha and sha == since_sha:
                break

            commit_data = commit.get("commit", {})
            author_data = commit.get("author") or {}
            committer_data = commit_data.get("author", {})

            message = commit_data.get("message", "")
            title = message.split("\n")[0][:256]

            events.append(
                GitHubEvent(
                    event_type="commit",
                    repo_full_name=f"{owner}/{repo}",
                    number=None,
                    sha=sha,
                    title=title,
                    description=message if len(message) > len(title) else None,
                    author=author_data.get("login", committer_data.get("name", "Unknown")),
                    author_avatar_url=author_data.get("avatar_url", ""),
                    url=commit.get("html_url", ""),
                    created_at=self._parse_datetime(committer_data.get("date", "")),
                    state=None,
                )
            )

        return events

    async def fetch_new_prs(
        self, owner: str, repo: str, since_number: int | None = None, limit: int = 10
    ) -> list[GitHubEvent]:
        path = f"/repos/{owner}/{repo}/pulls"
        params = {"state": "all", "sort": "created", "direction": "desc", "per_page": limit}

        data = await self._request("GET", path, params=params)
        if not isinstance(data, list):
            return []

        events = []
        for pr in data:
            number = pr.get("number", 0)

            if since_number is not None and number <= since_number:
                break

            user = pr.get("user", {})
            state = pr.get("state", "open")
            if pr.get("merged_at"):
                state = "merged"

            events.append(
                GitHubEvent(
                    event_type="pull_request",
                    repo_full_name=f"{owner}/{repo}",
                    number=number,
                    sha=pr.get("head", {}).get("sha"),
                    title=pr.get("title", ""),
                    description=self._truncate(pr.get("body"), 500),
                    author=user.get("login", "Unknown"),
                    author_avatar_url=user.get("avatar_url", ""),
                    url=pr.get("html_url", ""),
                    created_at=self._parse_datetime(pr.get("created_at", "")),
                    state=state,
                )
            )

        return events

    async def fetch_new_issues(
        self, owner: str, repo: str, since_number: int | None = None, limit: int = 10
    ) -> list[GitHubEvent]:
        path = f"/repos/{owner}/{repo}/issues"
        params = {
            "state": "all",
            "sort": "created",
            "direction": "desc",
            "per_page": limit,
            "filter": "all",
        }

        data = await self._request("GET", path, params=params)
        if not isinstance(data, list):
            return []

        events = []
        for issue in data:
            if "pull_request" in issue:
                continue

            number = issue.get("number", 0)

            if since_number is not None and number <= since_number:
                break

            user = issue.get("user", {})

            events.append(
                GitHubEvent(
                    event_type="issue",
                    repo_full_name=f"{owner}/{repo}",
                    number=number,
                    sha=None,
                    title=issue.get("title", ""),
                    description=self._truncate(issue.get("body"), 500),
                    author=user.get("login", "Unknown"),
                    author_avatar_url=user.get("avatar_url", ""),
                    url=issue.get("html_url", ""),
                    created_at=self._parse_datetime(issue.get("created_at", "")),
                    state=issue.get("state", "open"),
                )
            )

        return events

    def _parse_datetime(self, dt_str: str) -> datetime:
        if not dt_str:
            return datetime.now()
        try:
            return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        except ValueError:
            return datetime.now()

    def _truncate(self, text: str | None, max_length: int) -> str | None:
        if not text:
            return None
        if len(text) <= max_length:
            return text
        return text[: max_length - 3] + "..."
