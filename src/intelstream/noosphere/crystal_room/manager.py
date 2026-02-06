from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

import structlog

from intelstream.noosphere.constants import CrystalRoomMode, CrystalRoomState

logger = structlog.get_logger(__name__)


@dataclass
class CrystalRoomInfo:
    guild_id: int
    channel_id: int
    mode: CrystalRoomMode
    state: CrystalRoomState
    member_ids: list[int]
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    sealed_at: datetime | None = None
    sealed_by: list[int] = field(default_factory=list)


class CrystalRoomManager:
    """Manages Crystal Room lifecycle and state transitions.

    State machine: open -> sealed -> breathing (per Arch-3).
    Quorum-based transitions require minimum member count to seal.
    """

    def __init__(self, seal_quorum: int = 3, max_rooms_per_guild: int = 5):
        self._rooms: dict[int, CrystalRoomInfo] = {}
        self._seal_quorum = seal_quorum
        self._max_rooms_per_guild = max_rooms_per_guild
        self._seal_votes: dict[int, set[int]] = {}

    @property
    def rooms(self) -> dict[int, CrystalRoomInfo]:
        return dict(self._rooms)

    def guild_room_count(self, guild_id: int) -> int:
        return sum(1 for r in self._rooms.values() if r.guild_id == guild_id)

    def create_room(
        self,
        guild_id: int,
        channel_id: int,
        mode: CrystalRoomMode,
        creator_id: int,
    ) -> CrystalRoomInfo:
        if self.guild_room_count(guild_id) >= self._max_rooms_per_guild:
            raise ValueError(
                f"Maximum rooms ({self._max_rooms_per_guild}) reached for guild {guild_id}"
            )

        if channel_id in self._rooms:
            raise ValueError(f"Room already exists for channel {channel_id}")

        room = CrystalRoomInfo(
            guild_id=guild_id,
            channel_id=channel_id,
            mode=mode,
            state=CrystalRoomState.OPEN,
            member_ids=[creator_id],
        )
        self._rooms[channel_id] = room
        self._seal_votes[channel_id] = set()

        logger.info(
            "Crystal room created",
            guild_id=guild_id,
            channel_id=channel_id,
            mode=mode.value,
            creator_id=creator_id,
        )
        return room

    def get_room(self, channel_id: int) -> CrystalRoomInfo | None:
        return self._rooms.get(channel_id)

    def add_member(self, channel_id: int, user_id: int) -> CrystalRoomInfo:
        room = self._rooms.get(channel_id)
        if room is None:
            raise ValueError(f"No room for channel {channel_id}")

        if room.state == CrystalRoomState.SEALED:
            raise ValueError("Cannot join a sealed room")

        if user_id not in room.member_ids:
            room.member_ids.append(user_id)
            if room.state == CrystalRoomState.BREATHING:
                room.state = CrystalRoomState.OPEN
                logger.info(
                    "Room unsealed due to new member",
                    channel_id=channel_id,
                    new_member=user_id,
                )

        return room

    def remove_member(self, channel_id: int, user_id: int) -> CrystalRoomInfo:
        room = self._rooms.get(channel_id)
        if room is None:
            raise ValueError(f"No room for channel {channel_id}")

        if user_id in room.member_ids:
            room.member_ids.remove(user_id)

        if not room.member_ids and room.state == CrystalRoomState.SEALED:
            room.state = CrystalRoomState.BREATHING
            logger.info(
                "Room entered breathing state (all members left sealed room)",
                channel_id=channel_id,
            )

        return room

    def vote_seal(self, channel_id: int, user_id: int) -> tuple[bool, int, int]:
        """Vote to seal a room. Returns (sealed, current_votes, needed)."""
        room = self._rooms.get(channel_id)
        if room is None:
            raise ValueError(f"No room for channel {channel_id}")

        if room.state != CrystalRoomState.OPEN:
            raise ValueError(f"Room is already {room.state.value}")

        if user_id not in room.member_ids:
            raise ValueError("Only room members can vote to seal")

        votes = self._seal_votes.setdefault(channel_id, set())
        votes.add(user_id)

        needed = min(self._seal_quorum, len(room.member_ids))
        current = len(votes)

        if current >= needed:
            room.state = CrystalRoomState.SEALED
            room.sealed_at = datetime.now(UTC)
            room.sealed_by = list(votes)
            self._seal_votes[channel_id] = set()
            logger.info(
                "Room sealed",
                channel_id=channel_id,
                sealed_by=room.sealed_by,
            )
            return True, current, needed

        return False, current, needed

    def unseal(self, channel_id: int, user_id: int) -> CrystalRoomInfo:
        room = self._rooms.get(channel_id)
        if room is None:
            raise ValueError(f"No room for channel {channel_id}")

        if room.state not in (CrystalRoomState.SEALED, CrystalRoomState.BREATHING):
            raise ValueError("Room is not sealed or breathing")

        if user_id not in room.member_ids and room.state == CrystalRoomState.SEALED:
            raise ValueError("Only room members can unseal")

        room.state = CrystalRoomState.OPEN
        room.sealed_at = None
        room.sealed_by = []
        self._seal_votes[channel_id] = set()

        logger.info("Room unsealed", channel_id=channel_id, unsealed_by=user_id)
        return room

    def delete_room(self, channel_id: int) -> None:
        self._rooms.pop(channel_id, None)
        self._seal_votes.pop(channel_id, None)
