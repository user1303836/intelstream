import pytest

from intelstream.noosphere.constants import CrystalRoomMode, CrystalRoomState
from intelstream.noosphere.crystal_room.manager import CrystalRoomManager


class TestCrystalRoomManager:
    @pytest.fixture
    def manager(self) -> CrystalRoomManager:
        return CrystalRoomManager(seal_quorum=3, max_rooms_per_guild=5)

    def test_create_room(self, manager: CrystalRoomManager) -> None:
        room = manager.create_room("guild_1", "chan_1", CrystalRoomMode.NUMBER_STATION, "user_1")
        assert room.guild_id == "guild_1"
        assert room.channel_id == "chan_1"
        assert room.mode == CrystalRoomMode.NUMBER_STATION
        assert room.state == CrystalRoomState.OPEN
        assert "user_1" in room.member_ids

    def test_create_duplicate_room_raises(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        with pytest.raises(ValueError, match="already exists"):
            manager.create_room("guild_1", "chan_1", CrystalRoomMode.GHOST, "user_2")

    def test_max_rooms_per_guild(self, manager: CrystalRoomManager) -> None:
        for i in range(5):
            manager.create_room("guild_1", f"chan_{i}", CrystalRoomMode.WHALE, "user_1")
        with pytest.raises(ValueError, match="Maximum rooms"):
            manager.create_room("guild_1", "chan_extra", CrystalRoomMode.WHALE, "user_1")

    def test_max_rooms_per_guild_different_guilds(self, manager: CrystalRoomManager) -> None:
        for i in range(5):
            manager.create_room("guild_1", f"chan_{i}", CrystalRoomMode.WHALE, "user_1")
        room = manager.create_room("guild_2", "chan_other", CrystalRoomMode.WHALE, "user_1")
        assert room.guild_id == "guild_2"

    def test_get_room(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.GHOST, "user_1")
        room = manager.get_room("chan_1")
        assert room is not None
        assert room.mode == CrystalRoomMode.GHOST

    def test_get_nonexistent_room(self, manager: CrystalRoomManager) -> None:
        assert manager.get_room("nonexistent") is None

    def test_add_member(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        room = manager.add_member("chan_1", "user_2")
        assert "user_2" in room.member_ids

    def test_add_member_idempotent(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        manager.add_member("chan_1", "user_1")
        room = manager.get_room("chan_1")
        assert room is not None
        assert room.member_ids.count("user_1") == 1

    def test_add_member_to_sealed_raises(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        manager.add_member("chan_1", "user_2")
        manager.add_member("chan_1", "user_3")
        manager.vote_seal("chan_1", "user_1")
        manager.vote_seal("chan_1", "user_2")
        manager.vote_seal("chan_1", "user_3")

        with pytest.raises(ValueError, match="sealed"):
            manager.add_member("chan_1", "user_4")

    def test_add_member_to_breathing_reopens(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        manager.add_member("chan_1", "user_2")
        manager.add_member("chan_1", "user_3")
        manager.vote_seal("chan_1", "user_1")
        manager.vote_seal("chan_1", "user_2")
        manager.vote_seal("chan_1", "user_3")

        manager.remove_member("chan_1", "user_1")
        manager.remove_member("chan_1", "user_2")
        manager.remove_member("chan_1", "user_3")

        room = manager.get_room("chan_1")
        assert room is not None
        assert room.state == CrystalRoomState.BREATHING

        room = manager.add_member("chan_1", "user_4")
        assert room.state == CrystalRoomState.OPEN

    def test_remove_member(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        manager.add_member("chan_1", "user_2")
        manager.remove_member("chan_1", "user_2")
        room = manager.get_room("chan_1")
        assert room is not None
        assert "user_2" not in room.member_ids

    def test_remove_all_members_from_sealed_enters_breathing(
        self, manager: CrystalRoomManager
    ) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        manager.add_member("chan_1", "user_2")
        manager.add_member("chan_1", "user_3")
        manager.vote_seal("chan_1", "user_1")
        manager.vote_seal("chan_1", "user_2")
        manager.vote_seal("chan_1", "user_3")

        manager.remove_member("chan_1", "user_1")
        manager.remove_member("chan_1", "user_2")
        manager.remove_member("chan_1", "user_3")

        room = manager.get_room("chan_1")
        assert room is not None
        assert room.state == CrystalRoomState.BREATHING

    def test_vote_seal_quorum(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        manager.add_member("chan_1", "user_2")
        manager.add_member("chan_1", "user_3")

        sealed, current, needed = manager.vote_seal("chan_1", "user_1")
        assert not sealed
        assert current == 1
        assert needed == 3

        sealed, current, needed = manager.vote_seal("chan_1", "user_2")
        assert not sealed
        assert current == 2

        sealed, current, needed = manager.vote_seal("chan_1", "user_3")
        assert sealed
        assert current == 3

        room = manager.get_room("chan_1")
        assert room is not None
        assert room.state == CrystalRoomState.SEALED
        assert room.sealed_at is not None

    def test_vote_seal_small_room(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        manager.add_member("chan_1", "user_2")

        sealed, _, needed = manager.vote_seal("chan_1", "user_1")
        assert not sealed
        assert needed == 2

        sealed, _, _ = manager.vote_seal("chan_1", "user_2")
        assert sealed

    def test_vote_seal_non_member_raises(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        with pytest.raises(ValueError, match="Only room members"):
            manager.vote_seal("chan_1", "user_999")

    def test_vote_seal_already_sealed_raises(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        manager.add_member("chan_1", "user_2")
        manager.add_member("chan_1", "user_3")
        manager.vote_seal("chan_1", "user_1")
        manager.vote_seal("chan_1", "user_2")
        manager.vote_seal("chan_1", "user_3")

        with pytest.raises(ValueError, match="already"):
            manager.vote_seal("chan_1", "user_1")

    def test_unseal(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        manager.add_member("chan_1", "user_2")
        manager.add_member("chan_1", "user_3")
        manager.vote_seal("chan_1", "user_1")
        manager.vote_seal("chan_1", "user_2")
        manager.vote_seal("chan_1", "user_3")

        room = manager.unseal("chan_1", "user_1")
        assert room.state == CrystalRoomState.OPEN
        assert room.sealed_at is None

    def test_unseal_open_room_raises(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        with pytest.raises(ValueError, match="not sealed"):
            manager.unseal("chan_1", "user_1")

    def test_delete_room(self, manager: CrystalRoomManager) -> None:
        manager.create_room("guild_1", "chan_1", CrystalRoomMode.WHALE, "user_1")
        manager.delete_room("chan_1")
        assert manager.get_room("chan_1") is None

    def test_delete_nonexistent_room(self, manager: CrystalRoomManager) -> None:
        manager.delete_room("nonexistent")
