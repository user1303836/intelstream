import asyncio
import logging
import sys

import structlog

from intelstream.bot import run_bot
from intelstream.config import get_settings
from intelstream.utils.log_safety import sanitize_log_urls


def configure_logging(log_level: str) -> None:
    stdout_is_tty = getattr(sys.stdout, "isatty", lambda: False)()
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            sanitize_log_urls,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.dev.ConsoleRenderer(
                colors=stdout_is_tty,
                exception_formatter=structlog.dev.plain_traceback,
            ),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, log_level.upper())),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, log_level.upper()),
    )

    third_party_level = logging.DEBUG if log_level.upper() == "DEBUG" else logging.WARNING
    logging.getLogger("discord").setLevel(third_party_level)
    logging.getLogger("discord.http").setLevel(third_party_level)
    logging.getLogger("httpx").setLevel(third_party_level)


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)

    logger = structlog.get_logger()
    logger.info("Starting IntelStream bot", **settings.startup_log_context())

    try:
        asyncio.run(run_bot(settings))
    except KeyboardInterrupt:
        logger.info("Bot shutdown requested")
    except Exception:
        logger.exception("Fatal error")
        sys.exit(1)


if __name__ == "__main__":
    main()
