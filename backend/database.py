import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./data/harness.db")

# Upgrade a plain `sqlite://` URL to the async driver. This has to be anchored
# at the start of the string: a naive `.replace("sqlite:///", ...)` also matches
# the tail of an already-correct `sqlite+aiosqlite:///` URL and rewrites it to
# `sqlite+aiosqlite+aiosqlite:///`, which SQLAlchemy rejects at import time —
# the backend could not start at all with the default configuration.
if DATABASE_URL.startswith("sqlite://"):
    DATABASE_URL = "sqlite+aiosqlite://" + DATABASE_URL[len("sqlite://"):]

engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
