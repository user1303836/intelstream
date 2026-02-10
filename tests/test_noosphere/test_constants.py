from intelstream.noosphere.constants import CrystalRoomMode, CrystalRoomState


class TestCrystalRoomConstants:
    def test_crystal_room_modes(self) -> None:
        assert CrystalRoomMode.NUMBER_STATION.value == "number_station"
        assert CrystalRoomMode.WHALE.value == "whale"
        assert CrystalRoomMode.GHOST.value == "ghost"

    def test_crystal_room_states(self) -> None:
        assert CrystalRoomState.OPEN.value == "open"
        assert CrystalRoomState.SEALED.value == "sealed"
        assert CrystalRoomState.BREATHING.value == "breathing"
