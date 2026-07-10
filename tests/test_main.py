import runpy
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from intelstream import main as main_module


def make_settings() -> SimpleNamespace:
    return SimpleNamespace(
        log_level="INFO",
        startup_log_context=lambda: {"guild_id": 123, "search_enabled": True},
    )


class TestConfigureLogging:
    def test_debug_level_enables_debug_for_third_party_loggers(self) -> None:
        main_module.configure_logging("DEBUG")

        assert main_module.logging.getLogger("discord").level == main_module.logging.DEBUG
        assert main_module.logging.getLogger("discord.http").level == main_module.logging.DEBUG
        assert main_module.logging.getLogger("httpx").level == main_module.logging.DEBUG

    def test_non_debug_level_warns_for_third_party_loggers(self) -> None:
        main_module.configure_logging("INFO")

        assert main_module.logging.getLogger("discord").level == main_module.logging.WARNING
        assert main_module.logging.getLogger("discord.http").level == main_module.logging.WARNING
        assert main_module.logging.getLogger("httpx").level == main_module.logging.WARNING

    def test_invalid_log_level_raises_attribute_error(self) -> None:
        with pytest.raises(AttributeError):
            main_module.configure_logging("not-a-level")

    @pytest.mark.parametrize(("is_tty", "expected_colors"), [(True, True), (False, False)])
    def test_console_colors_follow_stdout_tty(
        self,
        is_tty: bool,
        expected_colors: bool,
    ) -> None:
        with (
            patch.object(main_module.sys.stdout, "isatty", return_value=is_tty),
            patch("intelstream.main.structlog.dev.ConsoleRenderer") as renderer,
            patch("intelstream.main.structlog.configure"),
        ):
            main_module.configure_logging("INFO")

        renderer.assert_called_once_with(colors=expected_colors)

    def test_timestamp_processor_is_explicitly_utc(self) -> None:
        with (
            patch("intelstream.main.structlog.processors.TimeStamper") as time_stamper,
            patch("intelstream.main.structlog.configure"),
        ):
            main_module.configure_logging("INFO")

        time_stamper.assert_called_once_with(fmt="iso", utc=True)

    def test_logging_pipeline_redacts_url_fields(self) -> None:
        with patch("intelstream.main.structlog.configure") as configure:
            main_module.configure_logging("INFO")

        processors = configure.call_args.kwargs["processors"]
        assert main_module.sanitize_log_urls in processors


class TestMainEntrypoint:
    def test_main_runs_bot_with_settings(self) -> None:
        settings = make_settings()

        with (
            patch("intelstream.main.get_settings", return_value=settings),
            patch("intelstream.main.configure_logging") as configure_logging,
            patch(
                "intelstream.main.run_bot",
                new=MagicMock(return_value="run-bot-result"),
            ) as run_bot,
            patch("intelstream.main.asyncio.run") as asyncio_run,
        ):
            main_module.main()

        configure_logging.assert_called_once_with("INFO")
        run_bot.assert_called_once_with(settings)
        asyncio_run.assert_called_once_with("run-bot-result")

    def test_main_handles_keyboard_interrupt_without_exiting(self) -> None:
        settings = make_settings()

        with (
            patch("intelstream.main.get_settings", return_value=settings),
            patch("intelstream.main.configure_logging"),
            patch(
                "intelstream.main.run_bot",
                new=MagicMock(return_value="run-bot-result"),
            ),
            patch("intelstream.main.asyncio.run", side_effect=KeyboardInterrupt),
            patch("intelstream.main.sys.exit") as sys_exit,
        ):
            main_module.main()

        sys_exit.assert_not_called()

    def test_main_exits_on_unhandled_exception(self) -> None:
        settings = make_settings()

        with (
            patch("intelstream.main.get_settings", return_value=settings),
            patch("intelstream.main.configure_logging"),
            patch(
                "intelstream.main.run_bot",
                new=MagicMock(return_value="run-bot-result"),
            ),
            patch("intelstream.main.asyncio.run", side_effect=RuntimeError("boom")),
            patch("intelstream.main.sys.exit") as sys_exit,
        ):
            main_module.main()

        sys_exit.assert_called_once_with(1)

    def test_module_execution_invokes_main(self) -> None:
        settings = make_settings()
        main_path = main_module.__file__

        with (
            patch("intelstream.config.get_settings", return_value=settings),
            patch("intelstream.bot.run_bot", new=MagicMock(return_value="run-bot-result")),
            patch("asyncio.run") as asyncio_run,
        ):
            runpy.run_path(main_path, run_name="__main__")

        asyncio_run.assert_called_once_with("run-bot-result")

    def test_main_logs_safe_startup_context(self) -> None:
        settings = make_settings()
        logger = MagicMock()

        with (
            patch("intelstream.main.get_settings", return_value=settings),
            patch("intelstream.main.configure_logging"),
            patch("intelstream.main.structlog.get_logger", return_value=logger),
            patch(
                "intelstream.main.run_bot",
                new=MagicMock(return_value="run-bot-result"),
            ),
            patch("intelstream.main.asyncio.run"),
        ):
            main_module.main()

        logger.info.assert_called_once_with(
            "Starting IntelStream bot",
            guild_id=123,
            search_enabled=True,
        )
