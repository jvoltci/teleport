from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Request

router = APIRouter()

_started_at = time.monotonic()


@router.get("/")
async def root(request: Request) -> dict[str, Any]:
    return {
        "service": "teleport-signaling",
        "status": "ok",
        "uptime": time.monotonic() - _started_at,
        "rooms": request.app.state.room_manager.count(),
    }


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
