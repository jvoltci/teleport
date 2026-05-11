"""Teleport signaling — ASGI entry point."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.manager import RoomManager
from app.routers import health, signaling


def _configure_logging() -> None:
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    _configure_logging()
    app.state.room_manager = RoomManager(ttl_seconds=settings.room_ttl_seconds)
    logging.getLogger(__name__).info(
        "teleport.start cors=%s ttl=%ds",
        settings.cors_origins,
        settings.room_ttl_seconds,
    )
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Teleport Signaling",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None,  # OSS server: don't expose Swagger UI by default
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        allow_credentials=False,
    )
    app.include_router(health.router)
    app.include_router(signaling.router)
    return app


app = create_app()


def main() -> None:  # pragma: no cover
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",  # noqa: S104 — explicit bind for container/VM use
        port=settings.port,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":  # pragma: no cover
    main()
