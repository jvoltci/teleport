"""
Room manager — the only stateful piece of the signaling server.

A "room" is a pair of WebSockets identified by a 6-digit code. The host
creates the room with an SDP offer; the joiner pulls the offer, posts an
answer, and the two endpoints exchange ICE candidates until they're talking
directly. After that, the server is irrelevant.

Rooms live in RAM. Killing the server wipes all rooms. That's intentional.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


@dataclass
class Room:
    code: str
    host: WebSocket
    offer: dict[str, Any]
    offer_candidates: list[dict[str, Any]]
    joiner: WebSocket | None = None
    answer: dict[str, Any] | None = None
    answer_candidates: list[dict[str, Any]] | None = None
    ttl_task: asyncio.Task[None] | None = field(default=None, repr=False)


class RoomManager:
    """In-memory pairing service. One instance per process."""

    def __init__(self, ttl_seconds: int) -> None:
        self.ttl_seconds = ttl_seconds
        self._rooms: dict[str, Room] = {}
        self._ws_to_code: dict[int, str] = {}  # id(ws) -> code
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------ rooms

    async def create(
        self,
        code: str,
        host: WebSocket,
        offer: dict[str, Any],
        offer_candidates: list[dict[str, Any]],
    ) -> Room:
        async with self._lock:
            if code in self._rooms:
                raise ValueError("Room already exists")
            room = Room(
                code=code,
                host=host,
                offer=offer,
                offer_candidates=offer_candidates,
            )
            self._rooms[code] = room
            self._ws_to_code[id(host)] = code
            self._schedule_ttl(room)
            logger.info("room.created code=%s", code)
            return room

    async def join(self, code: str, joiner: WebSocket) -> Room:
        async with self._lock:
            room = self._rooms.get(code)
            if room is None:
                raise ValueError("Room not found")
            if room.joiner is not None:
                raise ValueError("Room is full")
            room.joiner = joiner
            self._ws_to_code[id(joiner)] = code
            self._cancel_ttl(room)
            logger.info("room.joined code=%s", code)
            return room

    async def submit_answer(
        self,
        code: str,
        answer: dict[str, Any],
        answer_candidates: list[dict[str, Any]],
    ) -> Room | None:
        async with self._lock:
            room = self._rooms.get(code)
            if room is None:
                return None
            room.answer = answer
            room.answer_candidates = answer_candidates
            return room

    async def get(self, code: str) -> Room | None:
        async with self._lock:
            return self._rooms.get(code)

    async def remove_websocket(self, ws: WebSocket) -> Room | None:
        """
        Called on WebSocket disconnect. Returns the room (if any) the WS was in,
        with the disconnected side cleared. The caller is responsible for notifying
        the surviving peer.
        """
        async with self._lock:
            code = self._ws_to_code.pop(id(ws), None)
            if code is None:
                return None
            room = self._rooms.get(code)
            if room is None:
                return None
            if room.host is ws:
                # Host left → tear down the room entirely
                if room.joiner is not None:
                    self._ws_to_code.pop(id(room.joiner), None)
                self._cancel_ttl(room)
                self._rooms.pop(code, None)
                logger.info("room.host_left code=%s", code)
                return room
            if room.joiner is ws:
                room.joiner = None
                logger.info("room.joiner_left code=%s", code)
                # Schedule TTL again now that joiner is gone
                self._schedule_ttl(room)
                return room
            return None

    # ------------------------------------------------------------------ ttl

    def _schedule_ttl(self, room: Room) -> None:
        self._cancel_ttl(room)

        async def _expire() -> None:
            try:
                await asyncio.sleep(self.ttl_seconds)
            except asyncio.CancelledError:
                return
            async with self._lock:
                current = self._rooms.get(room.code)
                if current is room and current.joiner is None:
                    self._rooms.pop(room.code, None)
                    self._ws_to_code.pop(id(current.host), None)
                    logger.info("room.expired code=%s", room.code)

        room.ttl_task = asyncio.create_task(_expire())

    def _cancel_ttl(self, room: Room) -> None:
        if room.ttl_task and not room.ttl_task.done():
            room.ttl_task.cancel()
        room.ttl_task = None

    # ------------------------------------------------------------------ misc

    def count(self) -> int:
        return len(self._rooms)
