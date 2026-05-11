"""
Signaling WebSocket endpoint.

Wire protocol — see ../../README.md and ../../ARCHITECTURE.md for the full spec.

Client → server messages:
    { reqId, type: "create-room", data: { code, offer, iceCandidates } }
    { reqId, type: "join-room",   data: { code } }
    {        type: "submit-answer", data: { code, answer, iceCandidates } }
    {        type: "ice-candidate", data: { code, candidate } }

Server → client:
    Acks (in reply to a reqId):
        { type: "ack", reqId, success: true,  ...payload }
        { type: "ack", reqId, error: "..." }
    Pushes (no reqId):
        { type: "answer-received", answer, answerCandidates }
        { type: "ice-candidate", candidate }
        { type: "peer-disconnected" }
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.manager import Room, RoomManager

logger = logging.getLogger(__name__)

router = APIRouter()


async def _send(ws: WebSocket, payload: dict[str, Any]) -> None:
    try:
        await ws.send_text(json.dumps(payload))
    except Exception as e:  # pragma: no cover — connection-state edge cases
        logger.debug("send failed: %s", e)


async def _ack(
    ws: WebSocket, req_id: str | None, *, error: str | None = None, **payload: Any
) -> None:
    msg: dict[str, Any] = {"type": "ack", "reqId": req_id}
    if error is not None:
        msg["error"] = error
    else:
        msg["success"] = True
        msg.update(payload)
    await _send(ws, msg)


def _peer_of(room: Room, ws: WebSocket) -> WebSocket | None:
    if room.host is ws:
        return room.joiner
    if room.joiner is ws:
        return room.host
    return None


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    manager: RoomManager = ws.app.state.room_manager
    await ws.accept()
    logger.info("ws.connect")

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("ws.bad_json")
                continue

            req_id: str | None = msg.get("reqId")
            mtype: str | None = msg.get("type")
            data: dict[str, Any] = msg.get("data") or {}

            if mtype == "create-room":
                code = str(data.get("code", "")).strip()
                offer = data.get("offer")
                ice = data.get("iceCandidates") or []
                if not code or not isinstance(offer, dict):
                    await _ack(ws, req_id, error="Bad create-room payload")
                    continue
                try:
                    await manager.create(code, ws, offer, ice)
                    await _ack(ws, req_id, code=code)
                except ValueError as e:
                    await _ack(ws, req_id, error=str(e))

            elif mtype == "join-room":
                code = str(data.get("code", "")).strip()
                if not code:
                    await _ack(ws, req_id, error="Bad join-room payload")
                    continue
                try:
                    room = await manager.join(code, ws)
                    await _ack(
                        ws,
                        req_id,
                        offer=room.offer,
                        offerCandidates=room.offer_candidates,
                    )
                except ValueError as e:
                    await _ack(ws, req_id, error=str(e))

            elif mtype == "submit-answer":
                code = str(data.get("code", "")).strip()
                answer = data.get("answer")
                ice = data.get("iceCandidates") or []
                if not code or not isinstance(answer, dict):
                    continue
                submitted = await manager.submit_answer(code, answer, ice)
                if submitted is None or submitted.host is None:
                    continue
                await _send(
                    submitted.host,
                    {
                        "type": "answer-received",
                        "answer": answer,
                        "answerCandidates": ice,
                    },
                )

            elif mtype == "ice-candidate":
                code = str(data.get("code", "")).strip()
                candidate = data.get("candidate")
                if not code or candidate is None:
                    continue
                existing = await manager.get(code)
                if existing is None:
                    continue
                peer = _peer_of(existing, ws)
                if peer is not None:
                    await _send(peer, {"type": "ice-candidate", "candidate": candidate})

            else:
                logger.warning("ws.unknown_type type=%s", mtype)

    except WebSocketDisconnect:
        logger.info("ws.disconnect")
    except Exception:  # pragma: no cover
        logger.exception("ws.error")
    finally:
        removed = await manager.remove_websocket(ws)
        if removed is not None:
            survivor = _peer_of(removed, ws)
            if survivor is not None:
                await _send(survivor, {"type": "peer-disconnected"})
