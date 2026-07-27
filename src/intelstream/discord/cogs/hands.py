from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import discord
import structlog
from discord import app_commands
from discord.ext import commands

from intelstream.config import reveal_secret
from intelstream.hands.server import AdmissionConfig, HandsServer

if TYPE_CHECKING:
    from intelstream.bot import IntelStreamBot
    from intelstream.database.models import HandsRating

logger = structlog.get_logger(__name__)


class Hands(commands.Cog):
    def __init__(self, bot: IntelStreamBot) -> None:
        self.bot = bot
        self.server: HandsServer | None = None

    async def cog_load(self) -> None:
        settings = self.bot.settings
        if not settings.hands_enabled:
            return
        application_id = self.bot.application_id
        client_secret = reveal_secret(settings.discord_client_secret)
        if application_id is None or client_secret is None:
            raise RuntimeError(
                "Hands requires an authenticated Discord application and client secret"
            )
        server = HandsServer(
            repository=self.bot.repository,
            application_id=str(application_id),
            guild_id=str(settings.discord_guild_id),
            client_secret=client_secret,
            bot_token=settings.discord_token,
            host=settings.hands_host,
            port=settings.hands_port,
            dev_mode=settings.hands_dev_mode,
            admission=AdmissionConfig(
                trusted_proxy_cidrs=settings.hands_trusted_proxies,
            ),
        )
        try:
            await server.start()
        except BaseException:
            await server.close()
            raise
        self.server = server

    async def cog_unload(self) -> None:
        server = self.server
        self.server = None
        if server is not None:
            await server.close()

    def _valid_guild(self, interaction: discord.Interaction) -> bool:
        return (
            interaction.guild is not None
            and interaction.guild_id == self.bot.settings.discord_guild_id
        )

    @app_commands.command(name="hands", description="Open a two-player boxing match")
    async def hands(self, interaction: discord.Interaction) -> None:
        if not self._valid_guild(interaction):
            await interaction.response.send_message(
                "Hands can only be played in its configured server.", ephemeral=True
            )
            return
        if not self.bot.settings.hands_enabled:
            await interaction.response.send_message(
                "Hands is not enabled on this server.", ephemeral=True
            )
            return
        if self.server is None or not self.server.running:
            await interaction.response.send_message(
                "Hands is temporarily unavailable.", ephemeral=True
            )
            return
        await self.bot.repository.get_or_create_hands_rating(
            str(interaction.guild_id), str(interaction.user.id)
        )
        logger.info(
            "Launching Hands activity",
            guild_id=interaction.guild_id,
            user_id=interaction.user.id,
        )
        await interaction.response.launch_activity()

    @app_commands.command(name="hands_scoreboard", description="Show the Hands ELO rankings")
    async def hands_scoreboard(self, interaction: discord.Interaction) -> None:
        if not self._valid_guild(interaction):
            await interaction.response.send_message(
                "The Hands scoreboard is only available in its configured server.",
                ephemeral=True,
            )
            return
        guild = interaction.guild
        assert guild is not None
        await interaction.response.defer()
        guild_id = str(interaction.guild_id)
        user_id = str(interaction.user.id)
        caller = await self.bot.repository.get_or_create_hands_rating(guild_id, user_id)
        leaderboard = await self.bot.repository.get_hands_leaderboard(guild_id, limit=10)
        caller_rank = await self.bot.repository.get_hands_rank(guild_id, user_id)

        embed = discord.Embed(
            title="Hands ELO Scoreboard",
            description="Ranked two-player boxing",
            color=discord.Color.dark_red(),
        )
        names = await self._resolve_member_names(guild, leaderboard)
        lines = [
            self._rating_line(index, rating, names[rating.user_id])
            for index, rating in enumerate(leaderboard, start=1)
        ]
        chunks = self._line_chunks(lines) if lines else ["No ranked bouts yet."]
        for index, chunk in enumerate(chunks):
            embed.add_field(
                name="Top fighters" if index == 0 else "Top fighters (continued)",
                value=chunk,
                inline=False,
            )
        embed.add_field(
            name="Your record",
            value=self._caller_summary(caller_rank, caller),
            inline=False,
        )
        embed.set_footer(text="New fighters begin at 1000 ELO")
        await interaction.followup.send(embed=embed)

    async def _resolve_member_names(
        self, guild: discord.Guild, ratings: list[HandsRating]
    ) -> dict[str, str]:
        semaphore = asyncio.Semaphore(4)

        async def resolve(user_id: str) -> tuple[str, str]:
            try:
                numeric_id = int(user_id)
            except ValueError:
                return user_id, "Departed member"
            member = guild.get_member(numeric_id)
            if member is None:
                try:
                    async with semaphore:
                        member = await guild.fetch_member(numeric_id)
                except discord.DiscordException:
                    member = None
            if member is None:
                return user_id, f"Departed member {user_id[-6:]}"
            raw_name = "".join(
                character
                for character in member.display_name
                if character >= " " and character != "\x7f"
            ).strip()
            bounded = (raw_name or f"Member {user_id[-6:]}")[:40]
            return user_id, discord.utils.escape_markdown(bounded)

        return dict(await asyncio.gather(*(resolve(rating.user_id) for rating in ratings)))

    @staticmethod
    def _line_chunks(lines: list[str]) -> list[str]:
        chunks: list[str] = []
        current: list[str] = []
        current_length = 0
        for line in lines:
            added = len(line) + (1 if current else 0)
            if current and current_length + added > 1024:
                chunks.append("\n".join(current))
                current = []
                current_length = 0
                added = len(line)
            current.append(line)
            current_length += added
        if current:
            chunks.append("\n".join(current))
        return chunks

    @staticmethod
    def _rating_line(rank: int, rating: HandsRating, name: str) -> str:
        streak = f"+{rating.current_streak}" if rating.current_streak > 0 else "0"
        return (
            f"**#{rank} {name}** — {rating.rating} ELO | "
            f"{rating.wins}-{rating.losses}-{rating.draws} | "
            f"{rating.knockouts} KO | streak {streak} | {rating.bouts} bouts"
        )

    @staticmethod
    def _caller_summary(rank: int, rating: HandsRating) -> str:
        streak = f"+{rating.current_streak}" if rating.current_streak > 0 else "0"
        return (
            f"**#{rank} — {rating.rating} ELO**\n"
            f"{rating.wins} wins, {rating.losses} losses, {rating.draws} draws | "
            f"{rating.knockouts} KO | streak {streak} | {rating.bouts} bouts"
        )[:1024]


async def setup(bot: IntelStreamBot) -> None:
    await bot.add_cog(Hands(bot))
