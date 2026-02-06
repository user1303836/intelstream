import pytest

from intelstream.noosphere.constants import CrystalRoomMode, CrystalRoomState
from intelstream.noosphere.crystal_room.manager import CrystalRoomManager


class TestCrystalRoomManager:
    @pytest.fixture
    def manager(self) -> CrystalRoomManager:
        return CrystalRoomManager(seal_quorum=3, max_rooms_per_guild=5)

    def test_create_room(self, manager: CrystalRoomManager) -> None:
        room = manager.create_room(1001, 2001, CrystalRoomMode.NUMBER_STATION, 3001)
        assert room.guild_id == 1001
        assert room.channel_id == 2001
        assert room.mode == CrystalRoomMode.NUMBER_STATION
        assert room.state == CrystalRoomState.OPEN
        assert 3001 in room.member_ids

    def test_create_duplicate_room_raises(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        with pytest.raises(ValueError, match="already exists"):
            manager.create_room(1001, 2001, CrystalRoomMode.GHOST, 3002)

    def test_max_rooms_per_guild(self, manager: CrystalRoomManager) -> None:
        for i in range(5):
            manager.create_room(1001, 2000 + i, CrystalRoomMode.WHALE, 3001)
        with pytest.raises(ValueError, match="Maximum rooms"):
            manager.create_room(1001, 2099, CrystalRoomMode.WHALE, 3001)

    def test_max_rooms_per_guild_different_guilds(self, manager: CrystalRoomManager) -> None:
        for i in range(5):
            manager.create_room(1001, 2000 + i, CrystalRoomMode.WHALE, 3001)
        room = manager.create_room(1002, 2099, CrystalRoomMode.WHALE, 3001)
        assert room.guild_id == 1002

    def test_get_room(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.GHOST, 3001)
        room = manager.get_room(2001)
        assert room is not None
        assert room.mode == CrystalRoomMode.GHOST

    def test_get_nonexistent_room(self, manager: CrystalRoomManager) -> None:
        assert manager.get_room(9999) is None

    def test_add_member(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        room = manager.add_member(2001, 3002)
        assert 3002 in room.member_ids

    def test_add_member_idempotent(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        manager.add_member(2001, 3001)
        room = manager.get_room(2001)
        assert room is not None
        assert room.member_ids.count(3001) == 1

    def test_add_member_to_sealed_raises(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        manager.add_member(2001, 3002)
        manager.add_member(2001, 3003)
        manager.vote_seal(2001, 3001)
        manager.vote_seal(2001, 3002)
        manager.vote_seal(2001, 3003)

        with pytest.raises(ValueError, match="sealed"):
            manager.add_member(2001, 3004)

    def test_add_member_to_breathing_reopens(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        manager.add_member(2001, 3002)
        manager.add_member(2001, 3003)
        manager.vote_seal(2001, 3001)
        manager.vote_seal(2001, 3002)
        manager.vote_seal(2001, 3003)

        manager.remove_member(2001, 3001)
        manager.remove_member(2001, 3002)
        manager.remove_member(2001, 3003)

        room = manager.get_room(2001)
        assert room is not None
        assert room.state == CrystalRoomState.BREATHING

        room = manager.add_member(2001, 3004)
        assert room.state == CrystalRoomState.OPEN

    def test_remove_member(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        manager.add_member(2001, 3002)
        manager.remove_member(2001, 3002)
        room = manager.get_room(2001)
        assert room is not None
        assert 3002 not in room.member_ids

    def test_remove_all_members_from_sealed_enters_breathing(
        self, manager: CrystalRoomManager
    ) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        manager.add_member(2001, 3002)
        manager.add_member(2001, 3003)
        manager.vote_seal(2001, 3001)
        manager.vote_seal(2001, 3002)
        manager.vote_seal(2001, 3003)

        manager.remove_member(2001, 3001)
        manager.remove_member(2001, 3002)
        manager.remove_member(2001, 3003)

        room = manager.get_room(2001)
        assert room is not None
        assert room.state == CrystalRoomState.BREATHING

    def test_vote_seal_quorum(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        manager.add_member(2001, 3002)
        manager.add_member(2001, 3003)

        sealed, current, needed = manager.vote_seal(2001, 3001)
        assert not sealed
        assert current == 1
        assert needed == 3

        sealed, current, needed = manager.vote_seal(2001, 3002)
        assert not sealed
        assert current == 2

        sealed, current, needed = manager.vote_seal(2001, 3003)
        assert sealed
        assert current == 3

        room = manager.get_room(2001)
        assert room is not None
        assert room.state == CrystalRoomState.SEALED
        assert room.sealed_at is not None

    def test_vote_seal_small_room(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        manager.add_member(2001, 3002)

        sealed, _, needed = manager.vote_seal(2001, 3001)
        assert not sealed
        assert needed == 2

        sealed, _, _ = manager.vote_seal(2001, 3002)
        assert sealed

    def test_vote_seal_non_member_raises(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        with pytest.raises(ValueError, match="Only room members"):
            manager.vote_seal(2001, 9999)

    def test_vote_seal_already_sealed_raises(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        manager.add_member(2001, 3002)
        manager.add_member(2001, 3003)
        manager.vote_seal(2001, 3001)
        manager.vote_seal(2001, 3002)
        manager.vote_seal(2001, 3003)

        with pytest.raises(ValueError, match="already"):
            manager.vote_seal(2001, 3001)

    def test_unseal(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        manager.add_member(2001, 3002)
        manager.add_member(2001, 3003)
        manager.vote_seal(2001, 3001)
        manager.vote_seal(2001, 3002)
        manager.vote_seal(2001, 3003)

        room = manager.unseal(2001, 3001)
        assert room.state == CrystalRoomState.OPEN
        assert room.sealed_at is None

    def test_unseal_open_room_raises(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        with pytest.raises(ValueError, match="not sealed"):
            manager.unseal(2001, 3001)

    def test_delete_room(self, manager: CrystalRoomManager) -> None:
        manager.create_room(1001, 2001, CrystalRoomMode.WHALE, 3001)
        manager.delete_room(2001)
        assert manager.get_room(2001) is None

    def test_delete_nonexistent_room(self, manager: CrystalRoomManager) -> None:
        manager.delete_room(9999)
