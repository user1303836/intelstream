from __future__ import annotations

import discord
import structlog

logger = structlog.get_logger(__name__)


async def create_private_channel(
    guild: discord.Guild,
    name: str,
    creator: discord.Member,
    category: discord.CategoryChannel | None = None,
) -> discord.TextChannel:
    """Create a private channel visible only to the creator and the bot."""
    overwrites: dict[
        discord.Role | discord.Member | discord.Object, discord.PermissionOverwrite
    ] = {
        guild.default_role: discord.PermissionOverwrite(read_messages=False),
        creator: discord.PermissionOverwrite(
            read_messages=True,
            send_messages=True,
            read_message_history=True,
        ),
    }

    if guild.me:
        overwrites[guild.me] = discord.PermissionOverwrite(
            read_messages=True,
            send_messages=True,
            manage_channels=True,
            manage_messages=True,
            read_message_history=True,
        )

    channel = await guild.create_text_channel(
        name=f"crystal-{name}",
        overwrites=overwrites,
        category=category,
        topic="Crystal Room -- sealed discussion space",
    )

    logger.info(
        "Private crystal channel created",
        guild_id=str(guild.id),
        channel_id=str(channel.id),
        creator_id=str(creator.id),
    )
    return channel


async def grant_access(
    channel: discord.TextChannel,
    member: discord.Member,
) -> None:
    """Grant a member access to a crystal room channel."""
    await channel.set_permissions(
        member,
        read_messages=True,
        send_messages=True,
        read_message_history=True,
    )
    logger.info(
        "Access granted to crystal room",
        channel_id=str(channel.id),
        member_id=str(member.id),
    )


async def revoke_access(
    channel: discord.TextChannel,
    member: discord.Member,
) -> None:
    """Revoke a member's access to a crystal room channel."""
    await channel.set_permissions(member, overwrite=None)
    logger.info(
        "Access revoked from crystal room",
        channel_id=str(channel.id),
        member_id=str(member.id),
    )


async def set_sealed_permissions(
    channel: discord.TextChannel,
) -> None:
    """In sealed state, prevent new members from being added externally."""
    await channel.edit(
        topic="Crystal Room [SEALED] -- no new members",
    )


async def set_open_permissions(
    channel: discord.TextChannel,
) -> None:
    """Restore open state permissions."""
    await channel.edit(
        topic="Crystal Room -- sealed discussion space",
    )
