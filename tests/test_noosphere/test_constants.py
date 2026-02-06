import math

from intelstream.noosphere.constants import (
    FIBONACCI_SEQ,
    GOLDEN_ANGLE,
    PHI,
    ComputationMode,
    CrystalRoomMode,
    CrystalRoomState,
    PathologyType,
)


class TestConstants:
    def test_phi_value(self) -> None:
        assert abs(PHI - 1.618033988749895) < 1e-10

    def test_golden_angle_value(self) -> None:
        expected = 2 * math.pi / (PHI**2)
        assert abs(GOLDEN_ANGLE - expected) < 1e-10

    def test_fibonacci_sequence(self) -> None:
        assert FIBONACCI_SEQ == [1, 1, 2, 3, 5, 8, 13, 21, 34, 55]
        for i in range(2, len(FIBONACCI_SEQ)):
            assert FIBONACCI_SEQ[i] == FIBONACCI_SEQ[i - 1] + FIBONACCI_SEQ[i - 2]

    def test_crystal_room_modes(self) -> None:
        assert CrystalRoomMode.NUMBER_STATION.value == "number_station"
        assert CrystalRoomMode.WHALE.value == "whale"
        assert CrystalRoomMode.GHOST.value == "ghost"

    def test_crystal_room_states(self) -> None:
        assert CrystalRoomState.OPEN.value == "open"
        assert CrystalRoomState.SEALED.value == "sealed"
        assert CrystalRoomState.BREATHING.value == "breathing"

    def test_computation_modes_count(self) -> None:
        assert len(ComputationMode) == 10

    def test_pathology_types_count(self) -> None:
        assert len(PathologyType) == 10
