"""
End-to-end tests for the signaling WebSocket protocol.

We use FastAPI's TestClient to drive a real WebSocket pair through the
host/joiner handshake, verify acks and pushes, and check disconnect behavior.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi.testclient import TestClient

OFFER = {"type": "offer", "sdp": "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n"}
ANSWER = {"type": "answer", "sdp": "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n"}
ICE_HOST = [{"candidate": "candidate:1 1 UDP 1 127.0.0.1 1 typ host", "sdpMid": "0"}]
ICE_JOIN = [{"candidate": "candidate:2 1 UDP 1 127.0.0.1 2 typ host", "sdpMid": "0"}]


def _send(ws: Any, payload: dict[str, Any]) -> None:
    ws.send_text(json.dumps(payload))


def _recv(ws: Any) -> dict[str, Any]:
    return json.loads(ws.receive_text())


def test_create_room_returns_ack(client: TestClient) -> None:
    with client.websocket_connect("/ws") as host:
        _send(
            host,
            {
                "reqId": "r1",
                "type": "create-room",
                "data": {"code": "111111", "offer": OFFER, "iceCandidates": ICE_HOST},
            },
        )
        ack = _recv(host)
        assert ack["type"] == "ack"
        assert ack["reqId"] == "r1"
        assert ack["success"] is True
        assert ack["code"] == "111111"


def test_duplicate_room_rejected(client: TestClient) -> None:
    with client.websocket_connect("/ws") as host1, client.websocket_connect("/ws") as host2:
        _send(
            host1,
            {"reqId": "a", "type": "create-room", "data": {"code": "222222", "offer": OFFER, "iceCandidates": []}},
        )
        assert _recv(host1)["success"] is True
        _send(
            host2,
            {"reqId": "b", "type": "create-room", "data": {"code": "222222", "offer": OFFER, "iceCandidates": []}},
        )
        nack = _recv(host2)
        assert nack["error"] == "Room already exists"


def test_join_unknown_room_returns_error(client: TestClient) -> None:
    with client.websocket_connect("/ws") as joiner:
        _send(joiner, {"reqId": "j", "type": "join-room", "data": {"code": "999999"}})
        ack = _recv(joiner)
        assert ack["error"] == "Room not found"


def test_full_handshake(client: TestClient) -> None:
    with client.websocket_connect("/ws") as host, client.websocket_connect("/ws") as joiner:
        # 1. Host creates room
        _send(
            host,
            {
                "reqId": "h1",
                "type": "create-room",
                "data": {"code": "333333", "offer": OFFER, "iceCandidates": ICE_HOST},
            },
        )
        assert _recv(host)["success"] is True

        # 2. Joiner pulls offer
        _send(joiner, {"reqId": "j1", "type": "join-room", "data": {"code": "333333"}})
        ack = _recv(joiner)
        assert ack["success"] is True
        assert ack["offer"] == OFFER
        assert ack["offerCandidates"] == ICE_HOST

        # 3. Joiner submits answer
        _send(
            joiner,
            {
                "type": "submit-answer",
                "data": {"code": "333333", "answer": ANSWER, "iceCandidates": ICE_JOIN},
            },
        )

        # 4. Host gets answer-received push
        push = _recv(host)
        assert push["type"] == "answer-received"
        assert push["answer"] == ANSWER
        assert push["answerCandidates"] == ICE_JOIN


def test_ice_trickle_relays(client: TestClient) -> None:
    with client.websocket_connect("/ws") as host, client.websocket_connect("/ws") as joiner:
        _send(
            host,
            {"reqId": "h", "type": "create-room", "data": {"code": "444444", "offer": OFFER, "iceCandidates": []}},
        )
        _recv(host)
        _send(joiner, {"reqId": "j", "type": "join-room", "data": {"code": "444444"}})
        _recv(joiner)

        candidate = {"candidate": "candidate:9 1 UDP 1 1.2.3.4 9 typ srflx", "sdpMid": "0"}
        _send(host, {"type": "ice-candidate", "data": {"code": "444444", "candidate": candidate}})

        push = _recv(joiner)
        assert push["type"] == "ice-candidate"
        assert push["candidate"] == candidate


def test_peer_disconnect_notifies_other(client: TestClient) -> None:
    with client.websocket_connect("/ws") as host:
        _send(
            host,
            {"reqId": "h", "type": "create-room", "data": {"code": "555555", "offer": OFFER, "iceCandidates": []}},
        )
        _recv(host)

        with client.websocket_connect("/ws") as joiner:
            _send(joiner, {"reqId": "j", "type": "join-room", "data": {"code": "555555"}})
            _recv(joiner)
        # joiner context closed → host should get peer-disconnected
        push = _recv(host)
        assert push["type"] == "peer-disconnected"


def test_room_full_rejects_third_peer(client: TestClient) -> None:
    with (
        client.websocket_connect("/ws") as host,
        client.websocket_connect("/ws") as joiner,
        client.websocket_connect("/ws") as third,
    ):
        _send(
            host,
            {"reqId": "h", "type": "create-room", "data": {"code": "666666", "offer": OFFER, "iceCandidates": []}},
        )
        _recv(host)
        _send(joiner, {"reqId": "j", "type": "join-room", "data": {"code": "666666"}})
        _recv(joiner)
        _send(third, {"reqId": "t", "type": "join-room", "data": {"code": "666666"}})
        ack = _recv(third)
        assert ack["error"] == "Room is full"
