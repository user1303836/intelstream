import pytest

from intelstream.noosphere.constants import ComputationMode, PathologyType
from intelstream.noosphere.shared.mode_manager import ModeManager


class TestModeManager:
    @pytest.fixture
    def manager(self) -> ModeManager:
        return ModeManager(123)

    def test_initial_mode(self, manager: ModeManager) -> None:
        assert manager.current_mode == ComputationMode.INTEGRATIVE

    def test_custom_initial_mode(self) -> None:
        manager = ModeManager(123, default_mode=ComputationMode.RESONANT)
        assert manager.current_mode == ComputationMode.RESONANT

    def test_set_mode(self, manager: ModeManager) -> None:
        transition = manager.set_mode(ComputationMode.STIGMERGIC, reason="test")
        assert transition.old_mode == ComputationMode.INTEGRATIVE
        assert transition.new_mode == ComputationMode.STIGMERGIC
        assert transition.reason == "test"
        assert manager.current_mode == ComputationMode.STIGMERGIC

    def test_mode_history(self, manager: ModeManager) -> None:
        assert len(manager.history) == 0
        manager.set_mode(ComputationMode.RESONANT)
        manager.set_mode(ComputationMode.BROADCAST)
        assert len(manager.history) == 2
        assert manager.history[0].new_mode == ComputationMode.RESONANT
        assert manager.history[1].new_mode == ComputationMode.BROADCAST

    def test_report_pathology(self, manager: ModeManager) -> None:
        manager.report_pathology(PathologyType.GROUPTHINK, 0.8)
        assert PathologyType.GROUPTHINK in manager.active_pathologies
        assert manager.active_pathologies[PathologyType.GROUPTHINK] == 0.8

    def test_report_pathology_clamps_severity(self, manager: ModeManager) -> None:
        manager.report_pathology(PathologyType.CANCER, 1.5)
        assert manager.active_pathologies[PathologyType.CANCER] == 1.0

        manager.report_pathology(PathologyType.COMA, -0.5)
        assert manager.active_pathologies[PathologyType.COMA] == 0.0

    def test_clear_pathology(self, manager: ModeManager) -> None:
        manager.report_pathology(PathologyType.SEIZURE, 0.5)
        manager.clear_pathology(PathologyType.SEIZURE)
        assert PathologyType.SEIZURE not in manager.active_pathologies

    def test_clear_nonexistent_pathology(self, manager: ModeManager) -> None:
        manager.clear_pathology(PathologyType.SCHISM)

    def test_mode_description(self, manager: ModeManager) -> None:
        desc = manager.get_mode_description()
        assert "Gap junction" in desc

    def test_history_is_copy(self, manager: ModeManager) -> None:
        manager.set_mode(ComputationMode.RESONANT)
        history = manager.history
        history.clear()
        assert len(manager.history) == 1

    def test_active_pathologies_is_copy(self, manager: ModeManager) -> None:
        manager.report_pathology(PathologyType.ADDICTION, 0.3)
        pathologies = manager.active_pathologies
        pathologies.clear()
        assert len(manager.active_pathologies) == 1
