import os
from pathlib import Path

import pytest
from pydantic import ValidationError

from intelstream.config import Settings, get_database_directory
from intelstream.database.models import SourceType


class TestSettings:
    def test_settings_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_CHANNEL_ID", "987654321")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)

        settings = Settings(_env_file=None)

        assert settings.discord_bot_token == "test_token"
        assert settings.discord_guild_id == 123456789
        assert settings.discord_channel_id == 987654321
        assert settings.discord_owner_id == 111222333
        assert settings.anthropic_api_key == "sk-ant-test"
        assert settings.youtube_api_key is None
        assert settings.default_poll_interval_minutes == 5
        assert settings.log_level == "INFO"

    def test_settings_with_optional_youtube(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_CHANNEL_ID", "987654321")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("YOUTUBE_API_KEY", "yt-api-key")

        settings = Settings(_env_file=None)

        assert settings.youtube_api_key == "yt-api-key"

    def test_settings_poll_interval_bounds(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_CHANNEL_ID", "987654321")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("DEFAULT_POLL_INTERVAL_MINUTES", "0")

        with pytest.raises(ValidationError):
            Settings(_env_file=None)

    def test_settings_missing_required(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
        monkeypatch.delenv("DISCORD_GUILD_ID", raising=False)
        monkeypatch.delenv("DISCORD_CHANNEL_ID", raising=False)
        monkeypatch.delenv("DISCORD_OWNER_ID", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

        for key in list(os.environ.keys()):
            if key.startswith("DISCORD_") or key.startswith("ANTHROPIC_"):
                monkeypatch.delenv(key, raising=False)

        with pytest.raises(ValidationError):
            Settings(_env_file=None)

    def test_repr_masks_secrets(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "secret-discord-token-12345")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-secret-key-67890")
        monkeypatch.setenv("YOUTUBE_API_KEY", "yt-secret-api-key")

        settings = Settings(_env_file=None)
        repr_str = repr(settings)

        assert "secret-discord-token-12345" not in repr_str
        assert "sk-ant-secret-key-67890" not in repr_str
        assert "yt-secret-api-key" not in repr_str
        assert "*****" in repr_str
        assert "discord_guild_id=123456789" in repr_str
        assert "discord_owner_id=111222333" in repr_str

    def test_repr_handles_none_youtube_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)

        settings = Settings(_env_file=None)
        repr_str = repr(settings)

        assert "youtube_api_key=None" in repr_str

    def test_empty_discord_bot_token_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

        with pytest.raises(ValidationError):
            Settings(_env_file=None)

    def test_empty_anthropic_api_key_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "")

        with pytest.raises(ValidationError):
            Settings(_env_file=None)

    def test_summarization_delay_minimum(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("SUMMARIZATION_DELAY_SECONDS", "0")

        with pytest.raises(ValidationError):
            Settings(_env_file=None)


class TestGetPollInterval:
    def _base_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    def test_falls_back_to_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._base_env(monkeypatch)
        monkeypatch.setenv("DEFAULT_POLL_INTERVAL_MINUTES", "10")
        settings = Settings(_env_file=None)

        assert settings.get_poll_interval(SourceType.TWITTER) == 10
        assert settings.get_poll_interval(SourceType.YOUTUBE) == 10
        assert settings.get_poll_interval(SourceType.RSS) == 10

    def test_type_specific_overrides_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._base_env(monkeypatch)
        monkeypatch.setenv("DEFAULT_POLL_INTERVAL_MINUTES", "5")
        monkeypatch.setenv("TWITTER_POLL_INTERVAL_MINUTES", "20")
        monkeypatch.setenv("YOUTUBE_POLL_INTERVAL_MINUTES", "10")
        settings = Settings(_env_file=None)

        assert settings.get_poll_interval(SourceType.TWITTER) == 20
        assert settings.get_poll_interval(SourceType.YOUTUBE) == 10
        assert settings.get_poll_interval(SourceType.RSS) == 5

    def test_all_adapter_types_supported(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._base_env(monkeypatch)
        settings = Settings(_env_file=None)

        for source_type in SourceType:
            interval = settings.get_poll_interval(source_type)
            assert interval == settings.default_poll_interval_minutes


class TestGetDatabaseDirectory:
    def test_returns_parent_directory_for_sqlite_file(self) -> None:
        result = get_database_directory("sqlite+aiosqlite:///./data/mydb.db")
        assert result == Path("./data")

    def test_returns_parent_for_absolute_path(self) -> None:
        result = get_database_directory("sqlite+aiosqlite:////home/user/data/intelstream.db")
        assert result == Path("/home/user/data")

    def test_returns_none_for_memory_database(self) -> None:
        result = get_database_directory("sqlite+aiosqlite:///:memory:")
        assert result is None

    def test_returns_none_for_postgres(self) -> None:
        result = get_database_directory("postgresql+asyncpg://user:pass@localhost/db")
        assert result is None

    def test_returns_none_for_mysql(self) -> None:
        result = get_database_directory("mysql+aiomysql://user:pass@localhost/db")
        assert result is None

    def test_returns_current_dir_for_db_in_root(self) -> None:
        result = get_database_directory("sqlite+aiosqlite:///mydb.db")
        assert result == Path()
