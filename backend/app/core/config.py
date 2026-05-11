from __future__ import annotations

import os
from dataclasses import dataclass, field


def _parse_origins(raw: str | None) -> list[str]:
    if not raw or raw.strip() == "*":
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]


@dataclass(frozen=True)
class Settings:
    port: int = field(default_factory=lambda: int(os.getenv("PORT", "4000")))
    cors_origins: list[str] = field(
        default_factory=lambda: _parse_origins(os.getenv("CORS_ORIGINS"))
    )
    room_ttl_seconds: int = field(
        default_factory=lambda: int(os.getenv("ROOM_TTL_SECONDS", "60"))
    )
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))


settings = Settings()
