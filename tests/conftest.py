import socket

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from intelstream.database.models import Base


@pytest.fixture(autouse=True)
def mock_settings_env(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "test-discord-token")
    monkeypatch.setenv("DISCORD_GUILD_ID", "123456789")
    monkeypatch.setenv("DISCORD_OWNER_ID", "987654321")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-anthropic-key")
    from intelstream.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def deterministic_public_dns(monkeypatch):
    def fake_getaddrinfo(
        host,
        port,
        family=socket.AF_UNSPEC,
        type=0,
        proto=0,
        flags=0,
    ):
        _ = (host, flags)
        if family == socket.AF_INET6:
            return [
                (
                    socket.AF_INET6,
                    type or socket.SOCK_STREAM,
                    proto or 6,
                    "",
                    ("2606:2800:220:1:248:1893:25c8:1946", port or 0, 0, 0),
                )
            ]
        return [
            (
                socket.AF_INET,
                type or socket.SOCK_STREAM,
                proto or 6,
                "",
                ("93.184.216.34", port or 0),
            )
        ]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)


@pytest.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()
