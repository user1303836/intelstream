from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class NoosphereSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="NOOSPHERE_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    enabled: bool = Field(default=False, description="Enable the Noosphere Engine")

    # Crystal Room
    crystal_room_enabled: bool = Field(default=True, description="Enable Crystal Room feature")
    crystal_room_seal_quorum: int = Field(
        default=3, ge=2, le=20, description="Minimum members to seal a crystal room"
    )
    crystal_room_max_per_guild: int = Field(
        default=5, ge=1, le=50, description="Maximum crystal rooms per guild"
    )

    # Ghost Channel
    ghost_channel_enabled: bool = Field(default=True, description="Enable Ghost Channel feature")
    ghost_oracle_temperature: float = Field(
        default=0.9, ge=0.0, le=2.0, description="LLM temperature for ghost oracle"
    )
    ghost_oracle_top_p: float = Field(
        default=0.95, ge=0.0, le=1.0, description="LLM top_p for ghost oracle"
    )
    ghost_base_interval_hours: float = Field(
        default=4.0, ge=0.5, le=48.0, description="Base interval for ghost channel posting"
    )
    ghost_thread_auto_archive_minutes: int = Field(
        default=60, description="Auto-archive ghost threads after N minutes"
    )

    # Morphogenetic Pulse
    pulse_enabled: bool = Field(default=True, description="Enable morphogenetic pulse")
    pulse_base_interval_minutes: float = Field(
        default=60.0,
        ge=5.0,
        le=1440.0,
        description="Base interval for morphogenetic pulses in minutes",
    )

    # Serendipity Injector
    serendipity_enabled: bool = Field(default=True, description="Enable serendipity injection")
    serendipity_noise_sigma: float = Field(
        default=0.2,
        ge=0.0,
        le=1.0,
        description="Noise sigma for serendipity scoring",
    )
    serendipity_similarity_min: float = Field(
        default=0.3, ge=0.0, le=1.0, description="Minimum similarity for serendipity bridges"
    )
    serendipity_similarity_max: float = Field(
        default=0.6, ge=0.0, le=1.0, description="Maximum similarity for serendipity bridges"
    )

    # Mode Manager
    default_mode: str = Field(default="integrative", description="Default computation mode")

    # Engine
    dormancy_threshold_hours: float = Field(
        default=48.0,
        ge=1.0,
        le=720.0,
        description="Hours of inactivity before cryptobiosis",
    )
