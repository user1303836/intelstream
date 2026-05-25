from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from intelstream import main as main_module


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


class TestMainEntrypoint:
    def test_main_runs_bot_with_settings(self) -> None:
        settings = SimpleNamespace(log_level="INFO")

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
        settings = SimpleNamespace(log_level="INFO")

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
        settings = SimpleNamespace(log_level="INFO")

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
