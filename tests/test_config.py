import os
from pathlib import Path

import pytest
from pydantic import ValidationError

from intelstream.config import Settings, get_database_directory, reveal_secret
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

        assert settings.discord_bot_token.get_secret_value() == "test_token"
        assert settings.discord_guild_id == 123456789
        assert settings.discord_channel_id == 987654321
        assert settings.discord_owner_id == 111222333
        assert settings.anthropic_api_key is not None
        assert settings.anthropic_api_key.get_secret_value() == "sk-ant-test"
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

        assert settings.youtube_api_key is not None
        assert settings.youtube_api_key.get_secret_value() == "yt-api-key"

    def test_settings_accepts_lowercase_env_and_optional_legacy_channel(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        for key in (
            "DISCORD_BOT_TOKEN",
            "DISCORD_GUILD_ID",
            "DISCORD_CHANNEL_ID",
            "DISCORD_OWNER_ID",
            "ANTHROPIC_API_KEY",
            "LLM_PROVIDER",
        ):
            monkeypatch.delenv(key, raising=False)

        monkeypatch.setenv("discord_bot_token", "test_token")
        monkeypatch.setenv("discord_guild_id", "123456789")
        monkeypatch.setenv("discord_owner_id", "111222333")
        monkeypatch.setenv("anthropic_api_key", "sk-ant-test")
        monkeypatch.setenv("llm_provider", "anthropic")

        settings = Settings(_env_file=None)

        assert settings.discord_bot_token.get_secret_value() == "test_token"
        assert settings.discord_guild_id == 123456789
        assert settings.discord_channel_id is None
        assert settings.discord_owner_id == 111222333
        assert settings.llm_provider == "anthropic"
        assert settings.llm_api_key == "sk-ant-test"

    def test_settings_poll_interval_bounds(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_CHANNEL_ID", "987654321")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("DEFAULT_POLL_INTERVAL_MINUTES", "0")

        with pytest.raises(ValidationError):
            Settings(_env_file=None)

    @pytest.mark.parametrize(
        ("env_name", "env_value"),
        [
            ("GITHUB_POLL_INTERVAL_MINUTES", "61"),
            ("CONTENT_POLL_INTERVAL_MINUTES", "0"),
            ("DISCORD_MAX_MESSAGE_LENGTH", "2001"),
            ("ARTICLE_SEARCH_MIN_RELEVANCE_SCORE", "1.1"),
            ("ARTICLE_CHUNK_OVERLAP_CHARS", "1001"),
            ("LORE_CHUNK_MAX_MESSAGES", "4"),
        ],
    )
    def test_numeric_bounds_reject_invalid_feature_knobs(
        self, monkeypatch: pytest.MonkeyPatch, env_name: str, env_value: str
    ) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv(env_name, env_value)

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
        monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-secret")
        monkeypatch.setenv("YOUTUBE_API_KEY", "yt-secret-api-key")

        settings = Settings(_env_file=None)
        repr_str = repr(settings)

        assert "secret-discord-token-12345" not in repr_str
        assert "sk-ant-secret-key-67890" not in repr_str
        assert "sk-openai-secret" not in repr_str
        assert "yt-secret-api-key" not in repr_str
        assert "*****" in repr_str
        assert "discord_guild_id=123456789" in repr_str
        assert "discord_owner_id=111222333" in repr_str
        assert "llm_provider=" in repr_str

        settings_str = str(settings)
        serialized = settings.model_dump(mode="json")
        for secret in (
            "secret-discord-token-12345",
            "sk-ant-secret-key-67890",
            "sk-openai-secret",
            "yt-secret-api-key",
        ):
            assert secret not in settings_str
            assert secret not in repr(serialized)

    def test_repr_handles_none_keys(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)

        settings = Settings(_env_file=None)
        repr_str = repr(settings)

        assert "youtube_api_key=None" in repr_str
        assert "openai_api_key=None" in repr_str

    def test_empty_discord_bot_token_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

        with pytest.raises(ValidationError):
            Settings(_env_file=None)

    def test_empty_anthropic_api_key_rejected_at_construction(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "")

        with pytest.raises(ValidationError, match="cannot be empty or whitespace-only"):
            Settings(_env_file=None)

    def test_llm_api_key_returns_correct_provider_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-test")

        settings = Settings(_env_file=None)
        assert settings.llm_api_key == "sk-openai-test"

    def test_explicit_secret_accessors_return_raw_values(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "discord-token")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-token")

        settings = Settings(_env_file=None)

        assert settings.discord_token == "discord-token"
        assert reveal_secret(settings.anthropic_api_key) == "anthropic-token"
        assert reveal_secret("  legacy-test-token  ") == "legacy-test-token"
        assert reveal_secret(None) is None

    def test_llm_api_key_raises_if_configured_key_is_later_cleared(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-test")

        settings = Settings(_env_file=None)
        settings.openai_api_key = None

        with pytest.raises(ValueError, match="No API key configured"):
            _ = settings.llm_api_key

    def test_llm_api_key_raises_when_key_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)

        with pytest.raises(ValidationError, match="No API key configured"):
            Settings(_env_file=None)

    def test_invalid_llm_provider_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("LLM_PROVIDER", "invalid_provider")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

        with pytest.raises(ValidationError):
            Settings(_env_file=None)

    def test_valid_llm_providers_accepted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")

        for provider, key_env, key_val in [
            ("anthropic", "ANTHROPIC_API_KEY", "sk-ant-test"),
            ("openai", "OPENAI_API_KEY", "sk-openai-test"),
            ("gemini", "GEMINI_API_KEY", "gemini-test"),
            ("kimi", "KIMI_API_KEY", "kimi-test"),
        ]:
            monkeypatch.setenv("LLM_PROVIDER", provider)
            monkeypatch.setenv(key_env, key_val)
            settings = Settings(_env_file=None)
            assert settings.llm_provider == provider
            assert settings.llm_api_key == key_val
            monkeypatch.delenv(key_env, raising=False)

    def test_missing_api_key_fails_at_construction(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("LLM_PROVIDER", "gemini")
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)

        with pytest.raises(ValidationError, match="No API key configured"):
            Settings(_env_file=None)

    def test_empty_sqlite_database_url_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///")

        with pytest.raises(ValidationError, match="SQLite database path cannot be empty"):
            Settings(_env_file=None)

    def test_non_sqlite_database_url_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/db")

        with pytest.raises(ValidationError, match="Only SQLite databases are supported"):
            Settings(_env_file=None)

    @pytest.mark.parametrize(
        "database_url",
        ["sqlite:///./data/intelstream.db", "sqlite+pysqlite:///./data/intelstream.db"],
    )
    def test_synchronous_sqlite_driver_rejected(
        self, monkeypatch: pytest.MonkeyPatch, database_url: str
    ) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("DATABASE_URL", database_url)

        with pytest.raises(ValidationError, match=r"sqlite\+aiosqlite async driver"):
            Settings(_env_file=None)

    @pytest.mark.parametrize(
        ("env_name", "env_value"),
        [
            ("DISCORD_BOT_TOKEN", "   "),
            ("ANTHROPIC_API_KEY", "\t"),
            ("YOUTUBE_API_KEY", "\n"),
        ],
    )
    def test_whitespace_credentials_are_rejected(
        self,
        monkeypatch: pytest.MonkeyPatch,
        env_name: str,
        env_value: str,
    ) -> None:
        monkeypatch.setenv(env_name, env_value)

        with pytest.raises(ValidationError, match="cannot be empty or whitespace-only"):
            Settings(_env_file=None)

    def test_credentials_are_trimmed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "  discord-token  ")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "  anthropic-key  ")

        settings = Settings(_env_file=None)

        assert settings.discord_bot_token.get_secret_value() == "discord-token"
        assert settings.llm_api_key == "anthropic-key"

    @pytest.mark.parametrize(
        "env_name",
        ["DISCORD_GUILD_ID", "DISCORD_CHANNEL_ID", "DISCORD_OWNER_ID"],
    )
    @pytest.mark.parametrize("env_value", ["0", "-1"])
    def test_discord_ids_must_be_positive(
        self,
        monkeypatch: pytest.MonkeyPatch,
        env_name: str,
        env_value: str,
    ) -> None:
        monkeypatch.setenv(env_name, env_value)

        with pytest.raises(ValidationError):
            Settings(_env_file=None)

    def test_article_chunk_overlap_must_be_smaller_than_chunk_size(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("ARTICLE_CHUNK_SIZE_CHARS", "500")
        monkeypatch.setenv("ARTICLE_CHUNK_OVERLAP_CHARS", "500")

        with pytest.raises(ValidationError, match="must be smaller"):
            Settings(_env_file=None)

    def test_startup_log_context_contains_no_credentials(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        secrets = {
            "DISCORD_BOT_TOKEN": "discord-startup-secret",
            "ANTHROPIC_API_KEY": "anthropic-startup-secret",
            "YOUTUBE_API_KEY": "youtube-startup-secret",
            "TWITTER_BEARER_TOKEN": "twitter-startup-secret",
            "GITHUB_TOKEN": "github-startup-secret",
        }
        for name, value in secrets.items():
            monkeypatch.setenv(name, value)

        context = Settings(_env_file=None).startup_log_context()
        rendered = repr(context)

        assert context["database_backend"] == "sqlite"
        assert context["youtube_enabled"] is True
        assert context["twitter_enabled"] is True
        assert context["github_enabled"] is True
        assert not any(secret in rendered for secret in secrets.values())

    def test_hands_is_disabled_by_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("HANDS_ENABLED", raising=False)
        monkeypatch.delenv("DISCORD_CLIENT_SECRET", raising=False)
        monkeypatch.delenv("HANDS_TRUSTED_PROXY_CIDRS", raising=False)

        settings = Settings(_env_file=None)

        assert settings.hands_enabled is False
        assert settings.discord_client_secret is None
        assert settings.hands_host == "127.0.0.1"
        assert settings.hands_port == 8080
        assert settings.hands_dev_mode is False
        assert settings.hands_trusted_proxies == ()

    def test_hands_enabled_requires_client_secret(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HANDS_ENABLED", "true")
        monkeypatch.delenv("DISCORD_CLIENT_SECRET", raising=False)

        with pytest.raises(ValidationError, match="DISCORD_CLIENT_SECRET is required"):
            Settings(_env_file=None)

    def test_hands_configuration_is_validated_and_secret_is_masked(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HANDS_ENABLED", "true")
        monkeypatch.setenv("DISCORD_CLIENT_SECRET", "  hands-client-secret  ")
        monkeypatch.setenv("HANDS_HOST", "0.0.0.0")
        monkeypatch.setenv("HANDS_PORT", "9443")
        monkeypatch.setenv("HANDS_DEV_MODE", "true")
        monkeypatch.setenv(
            "HANDS_TRUSTED_PROXY_CIDRS",
            "127.0.0.1, 10.0.0.9/24",
        )

        settings = Settings(_env_file=None)
        rendered = repr(settings)
        context = settings.startup_log_context()

        assert settings.discord_client_secret is not None
        assert settings.discord_client_secret.get_secret_value() == "hands-client-secret"
        assert settings.hands_enabled is True
        assert settings.hands_host == "0.0.0.0"
        assert settings.hands_port == 9443
        assert settings.hands_dev_mode is True
        assert settings.hands_trusted_proxies == ("127.0.0.1/32", "10.0.0.0/24")
        assert "hands-client-secret" not in rendered
        assert "hands-client-secret" not in repr(settings.model_dump(mode="json"))
        assert "hands-client-secret" not in repr(context)
        assert context["hands_enabled"] is True
        assert context["hands_host"] == "0.0.0.0"
        assert context["hands_port"] == 9443
        assert context["hands_dev_mode"] is True
        assert context["hands_trusted_proxy_cidrs"] == "127.0.0.1/32,10.0.0.0/24"

    @pytest.mark.parametrize(
        "trusted",
        ["not-a-network", "0.0.0.0/0", "127.0.0.1,,::1", ",".join(["::1"] * 17)],
    )
    def test_hands_trusted_proxy_cidrs_reject_unsafe_values(
        self, monkeypatch: pytest.MonkeyPatch, trusted: str
    ) -> None:
        monkeypatch.setenv("HANDS_TRUSTED_PROXY_CIDRS", trusted)

        with pytest.raises(ValidationError, match="HANDS_TRUSTED_PROXY_CIDRS"):
            Settings(_env_file=None)

    @pytest.mark.parametrize("port", ["0", "65536"])
    def test_hands_port_bounds(self, monkeypatch: pytest.MonkeyPatch, port: str) -> None:
        monkeypatch.setenv("HANDS_PORT", port)

        with pytest.raises(ValidationError):
            Settings(_env_file=None)

    @pytest.mark.parametrize(
        "host",
        [
            "",
            "bad host",
            "https://example.com",
            "host/path",
            "example.com:8080",
            "127.0.0.1:8080",
            "[::1]",
        ],
    )
    def test_hands_host_rejects_invalid_values(
        self, monkeypatch: pytest.MonkeyPatch, host: str
    ) -> None:
        monkeypatch.setenv("HANDS_HOST", host)

        with pytest.raises(ValidationError, match=r"HANDS_HOST|at least 1 character"):
            Settings(_env_file=None)

    @pytest.mark.parametrize("host", ["localhost", "example.com", "127.0.0.1", "::1"])
    def test_hands_host_accepts_bare_host_values(
        self, monkeypatch: pytest.MonkeyPatch, host: str
    ) -> None:
        monkeypatch.setenv("HANDS_HOST", host)

        assert Settings(_env_file=None).hands_host == host

    def test_summarization_delay_minimum(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("SUMMARIZATION_DELAY_SECONDS", "0")

        with pytest.raises(ValidationError):
            Settings(_env_file=None)


class TestProviderAwareModelDefaults:
    def _base_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.delenv("SUMMARY_MODEL", raising=False)
        monkeypatch.delenv("SUMMARY_MODEL_INTERACTIVE", raising=False)

    def test_anthropic_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._base_env(monkeypatch)
        monkeypatch.setenv("LLM_PROVIDER", "anthropic")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

        settings = Settings(_env_file=None)
        assert settings.summary_model == "claude-haiku-4-5-20251001"
        assert settings.summary_model_interactive == "claude-sonnet-4-6"

    def test_openai_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._base_env(monkeypatch)
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-test")

        settings = Settings(_env_file=None)
        assert settings.summary_model == "gpt-5.4-mini"
        assert settings.summary_model_interactive == "gpt-5.4"

    def test_gemini_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._base_env(monkeypatch)
        monkeypatch.setenv("LLM_PROVIDER", "gemini")
        monkeypatch.setenv("GEMINI_API_KEY", "gemini-test")

        settings = Settings(_env_file=None)
        assert settings.summary_model == "gemini-3.5-flash"
        assert settings.summary_model_interactive == "gemini-3.1-pro-preview"

    def test_kimi_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._base_env(monkeypatch)
        monkeypatch.setenv("LLM_PROVIDER", "kimi")
        monkeypatch.setenv("KIMI_API_KEY", "kimi-test")

        settings = Settings(_env_file=None)
        assert settings.summary_model == "moonshot-v1-8k"
        assert settings.summary_model_interactive == "moonshot-v1-32k"

    def test_explicit_model_overrides_provider_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._base_env(monkeypatch)
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-test")
        monkeypatch.setenv("SUMMARY_MODEL", "my-custom-model")
        monkeypatch.setenv("SUMMARY_MODEL_INTERACTIVE", "my-custom-interactive")

        settings = Settings(_env_file=None)
        assert settings.summary_model == "my-custom-model"
        assert settings.summary_model_interactive == "my-custom-interactive"

    def test_partial_override_uses_default_for_unset(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._base_env(monkeypatch)
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-test")
        monkeypatch.setenv("SUMMARY_MODEL", "my-custom-model")

        settings = Settings(_env_file=None)
        assert settings.summary_model == "my-custom-model"
        assert settings.summary_model_interactive == "gpt-5.4"

    def test_unknown_provider_default_lookup_leaves_models_unchanged(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._base_env(monkeypatch)
        monkeypatch.setenv("LLM_PROVIDER", "anthropic")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        settings = Settings(_env_file=None)
        settings.llm_provider = "unknown"  # type: ignore[assignment]
        settings.summary_model = ""
        settings.summary_model_interactive = ""

        settings.set_provider_model_defaults()

        assert settings.summary_model == ""
        assert settings.summary_model_interactive == ""


class TestGetPollInterval:
    def _base_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "test_token")
        monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
        monkeypatch.setenv("DISCORD_OWNER_ID", "111222333")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        for prefix in (
            "SUBSTACK",
            "YOUTUBE",
            "RSS",
            "ARXIV",
            "BLOG",
            "TWITTER",
            "PAGE",
            "GITHUB",
        ):
            monkeypatch.delenv(f"{prefix}_POLL_INTERVAL_MINUTES", raising=False)

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

    def test_handles_sqlite_query_parameters(self) -> None:
        result = get_database_directory(
            "sqlite+aiosqlite:////home/user/data/intelstream.db?mode=rwc&uri=true"
        )
        assert result == Path("/home/user/data")

    def test_returns_none_for_malformed_url(self) -> None:
        assert get_database_directory("://not-a-database-url") is None


class TestEnvironmentExample:
    def test_example_documents_every_setting_and_loads_after_required_values_are_set(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        example_path = Path(__file__).parents[1] / ".env.example"
        example = example_path.read_text()

        documented_names = {
            line.lstrip("# ").split("=", 1)[0]
            for line in example.splitlines()
            if "=" in line and line.lstrip("# ").split("=", 1)[0].isupper()
        }
        expected_names = {field_name.upper() for field_name in Settings.model_fields}
        assert documented_names == expected_names

        configured = (
            example.replace(
                "DISCORD_BOT_TOKEN=replace_with_discord_bot_token",
                "DISCORD_BOT_TOKEN=test-discord-token",
            )
            .replace(
                "DISCORD_GUILD_ID=replace_with_discord_server_id",
                "DISCORD_GUILD_ID=123456789",
            )
            .replace(
                "DISCORD_OWNER_ID=replace_with_discord_user_id",
                "DISCORD_OWNER_ID=987654321",
            )
            .replace(
                "ANTHROPIC_API_KEY=replace_with_anthropic_api_key",
                "ANTHROPIC_API_KEY=test-anthropic-key",
            )
        )
        env_path = tmp_path / ".env"
        env_path.write_text(configured)

        for field_name in Settings.model_fields:
            monkeypatch.delenv(field_name.upper(), raising=False)

        settings = Settings(_env_file=env_path)

        assert settings.discord_bot_token.get_secret_value() == "test-discord-token"
        assert settings.discord_channel_id is None
        assert settings.youtube_api_key is None
        assert settings.twitter_bearer_token is None
        assert settings.github_token is None
