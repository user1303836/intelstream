from typing import ClassVar

import discord
import structlog

from intelstream.services.github_service import GitHubEvent

logger = structlog.get_logger()


class GitHubPoster:
    COLORS: ClassVar[dict[str, discord.Color]] = {
        "commit": discord.Color.from_rgb(110, 118, 129),
        "pull_request": discord.Color.from_rgb(139, 92, 246),
        "pull_request_merged": discord.Color.from_rgb(111, 66, 193),
        "pull_request_closed": discord.Color.from_rgb(218, 54, 51),
        "issue": discord.Color.from_rgb(88, 166, 255),
        "issue_closed": discord.Color.from_rgb(130, 80, 223),
    }

    def format_event(self, event: GitHubEvent) -> discord.Embed:
        if event.event_type == "commit":
            return self._format_commit(event)
        elif event.event_type == "pull_request":
            return self._format_pr(event)
        elif event.event_type == "issue":
            return self._format_issue(event)
        else:
            return self._format_generic(event)

    def _format_commit(self, event: GitHubEvent) -> discord.Embed:
        short_sha = event.sha[:7] if event.sha else "unknown"
        title = f"[{event.repo_full_name}] {short_sha}: {event.title}"
        if len(title) > 256:
            title = title[:253] + "..."

        embed = discord.Embed(
            title=title,
            url=event.url,
            color=self.COLORS["commit"],
            timestamp=event.created_at,
        )

        if event.description and event.description != event.title:
            desc = event.description
            first_line_end = desc.find("\n")
            if first_line_end > 0:
                desc = desc[first_line_end + 1 :].strip()
            if desc:
                embed.description = desc[:500]

        if event.author_avatar_url:
            embed.set_author(name=event.author, icon_url=event.author_avatar_url)
        else:
            embed.set_author(name=event.author)

        embed.set_footer(text=event.repo_full_name)

        return embed

    def _format_pr(self, event: GitHubEvent) -> discord.Embed:
        title = f"[{event.repo_full_name}] PR #{event.number}: {event.title}"
        if len(title) > 256:
            title = title[:253] + "..."

        if event.state == "merged":
            color = self.COLORS["pull_request_merged"]
        elif event.state == "closed":
            color = self.COLORS["pull_request_closed"]
        else:
            color = self.COLORS["pull_request"]

        embed = discord.Embed(
            title=title,
            url=event.url,
            color=color,
            timestamp=event.created_at,
        )

        if event.description:
            embed.description = event.description[:500]

        if event.author_avatar_url:
            embed.set_author(name=event.author, icon_url=event.author_avatar_url)
        else:
            embed.set_author(name=event.author)

        status_display = {
            "open": "Open",
            "closed": "Closed",
            "merged": "Merged",
        }.get(event.state or "open", event.state or "Open")

        embed.add_field(name="Status", value=status_display, inline=True)
        embed.set_footer(text=event.repo_full_name)

        return embed

    def _format_issue(self, event: GitHubEvent) -> discord.Embed:
        title = f"[{event.repo_full_name}] Issue #{event.number}: {event.title}"
        if len(title) > 256:
            title = title[:253] + "..."

        color = self.COLORS["issue_closed"] if event.state == "closed" else self.COLORS["issue"]

        embed = discord.Embed(
            title=title,
            url=event.url,
            color=color,
            timestamp=event.created_at,
        )

        if event.description:
            embed.description = event.description[:500]

        if event.author_avatar_url:
            embed.set_author(name=event.author, icon_url=event.author_avatar_url)
        else:
            embed.set_author(name=event.author)

        status_display = "Open" if event.state == "open" else "Closed"
        embed.add_field(name="Status", value=status_display, inline=True)
        embed.set_footer(text=event.repo_full_name)

        return embed

    def _format_generic(self, event: GitHubEvent) -> discord.Embed:
        embed = discord.Embed(
            title=event.title[:256],
            url=event.url,
            color=discord.Color.greyple(),
            timestamp=event.created_at,
        )

        if event.description:
            embed.description = event.description[:500]

        if event.author_avatar_url:
            embed.set_author(name=event.author, icon_url=event.author_avatar_url)
        else:
            embed.set_author(name=event.author)

        embed.set_footer(text=event.repo_full_name)

        return embed

    async def post_events(
        self, channel: discord.abc.Messageable, events: list[GitHubEvent]
    ) -> list[discord.Message]:
        posted_messages = []
        for event in reversed(events):
            try:
                embed = self.format_event(event)
                message = await channel.send(embed=embed)
                posted_messages.append(message)
                logger.debug(
                    "Posted GitHub event",
                    event_type=event.event_type,
                    repo=event.repo_full_name,
                    number=event.number,
                    sha=event.sha[:7] if event.sha else None,
                )
            except discord.HTTPException as e:
                logger.error(
                    "Failed to post GitHub event",
                    event_type=event.event_type,
                    repo=event.repo_full_name,
                    error=str(e),
                )
        return posted_messages
