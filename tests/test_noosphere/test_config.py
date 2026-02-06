from unittest.mock import patch

from intelstream.noosphere.config import NoosphereSettings


class TestNoosphereSettings:
    def test_default_values(self) -> None:
        with patch.dict("os.environ", {}, clear=False):
            settings = NoosphereSettings()

        assert settings.enabled is False
        assert settings.crystal_room_enabled is True
        assert settings.crystal_room_seal_quorum == 3
        assert settings.crystal_room_max_per_guild == 5
        assert settings.ghost_channel_enabled is True
        assert settings.ghost_oracle_temperature == 0.9
        assert settings.ghost_oracle_top_p == 0.95
        assert settings.ghost_base_interval_hours == 4.0
        assert settings.ghost_thread_auto_archive_minutes == 60
        assert settings.pulse_enabled is True
        assert settings.pulse_base_interval_minutes == 60.0
        assert settings.serendipity_enabled is True
        assert settings.serendipity_noise_sigma == 0.2
        assert settings.default_mode == "integrative"
        assert settings.dormancy_threshold_hours == 48.0

    def test_env_override(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "NOOSPHERE_ENABLED": "true",
                "NOOSPHERE_CRYSTAL_ROOM_SEAL_QUORUM": "5",
                "NOOSPHERE_GHOST_ORACLE_TEMPERATURE": "0.7",
                "NOOSPHERE_PULSE_BASE_INTERVAL_MINUTES": "30",
            },
        ):
            settings = NoosphereSettings()

        assert settings.enabled is True
        assert settings.crystal_room_seal_quorum == 5
        assert settings.ghost_oracle_temperature == 0.7
        assert settings.pulse_base_interval_minutes == 30.0
