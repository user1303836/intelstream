import os

import pytest
from pydantic import ValidationError

from intelstream.config import Settings


class TestSettings:
    def test_settings_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_CHANNEL_ID", "987654321")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

        settings = Settings()

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

        settings = Settings()

        assert settings.youtube_api_key == "yt-api-key"

    def test_settings_poll_interval_bounds(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_CHANNEL_ID", "987654321")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("DEFAULT_POLL_INTERVAL_MINUTES", "0")

        with pytest.raises(ValidationError):
            Settings()

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
            Settings()
