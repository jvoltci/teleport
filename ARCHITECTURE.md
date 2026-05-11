# Architecture

A deep-dive into how Teleport works. If you're trying to **use** Teleport, [README.md](./README.md) is enough. This document is for people who want to **understand**, **extend**, or **fork** it.

## Contents

1. [The two-piece design](#the-two-piece-design)
2. [The WebRTC handshake, step by step](#the-webrtc-handshake-step-by-step)
3. [Signaling protocol](#signaling-protocol)
4. [Data channels](#data-channels)
5. [File transfer pipeline](#file-transfer-pipeline)
6. [Media renegotiation (in-band signaling)](#media-renegotiation-in-band-signaling)
7. [ICE candidate filtering](#ice-candidate-filtering)
8. [State machine](#state-machine)
9. [What the server can and cannot see](#what-the-server-can-and-cannot-see)
10. [Performance tuning](#performance-tuning)

---

## The two-piece design

Teleport is two services. Forever. We deliberately resist the temptation to merge them.

```
┌──────────────────────┐     handshake only        ┌──────────────────────┐
│  Frontend (static)   │ ◄────────────────────────►│  Signaling (FastAPI) │
│  Next.js → HTML+JS   │     <1 KB per session     │  ~150 lines, async   │
└──────────────────────┘                            └──────────────────────┘
        ▲   ▲                                                 ▲
        │   │                                                 │
   serves to                                              keeps room
   any browser                                            state in RAM
        │   │
        │   └─────────────────── peer-to-peer ────────────────────┐
        │              ╔═══════════════════════════╗              │
        ▼              ║   DTLS-SRTP encrypted     ║              ▼
   ┌────────┐          ║   data + media channels   ║         ┌────────┐
   │Device A│ ════════►║                           ║◄════════│Device B│
   └────────┘          ╚═══════════════════════════╝         └────────┘
```

**Why two pieces?**

- The frontend is **pure static** — it can live on a CDN, GitHub Pages, an S3 bucket, or your laptop's `python -m http.server`.
- The signaling server is **stateful but tiny** — its only job is to forward two SDP blobs and a handful of ICE candidates between exactly two clients. Most rooms exist for under 5 seconds.
- Splitting them means: scaling the frontend = free CDN. Scaling the signaling = adding RAM (each room is ~2 KB).

## The WebRTC handshake, step by step

Two browsers cannot talk to each other directly without first agreeing on:

1. **What codecs they each support** (audio/video/data) → SDP
2. **What network paths exist between them** (LAN IP, public IP, relay) → ICE candidates
3. **What encryption keys to use** (DTLS fingerprints, embedded in SDP)

The signaling server's only job is to swap (1) and (2). After that, the browsers exchange (3) directly through the encrypted channel, and the server is irrelevant.

### Sequence diagram

```
Device A (host)           Signaling (FastAPI)         Device B (joiner)
     │                            │                            │
     │── connect WebSocket ──────►│                            │
     │  generate code "482917"    │                            │
     │  create RTCPeerConnection  │                            │
     │  create 3 data channels    │                            │
     │  createOffer() → SDP       │                            │
     │  gather ICE candidates     │                            │
     │                            │                            │
     │── create-room ───────────► │                            │
     │   {code, offer, ice[]}     │                            │
     │                       store room                        │
     │◄── ack {success} ──────────│                            │
     │                            │◄── connect WebSocket ──────│
     │                            │      user types "482917"   │
     │                            │◄── join-room {code} ───────│
     │                       lookup room                       │
     │                            │── ack {offer, ice[]} ─────►│
     │                            │                  setRemoteDescription
     │                            │                  createAnswer() → SDP
     │                            │                  gather ICE candidates
     │                            │◄── submit-answer ──────────│
     │                            │   {code, answer, ice[]}    │
     │◄── answer-received ────────│                            │
     │   {answer, ice[]}          │                            │
     │ setRemoteDescription       │                            │
     │ addIceCandidate × N        │                            │
     │                            │                            │
     │═══════════════════ DTLS handshake ═══════════════════════│
     │═══════════════════ peer-to-peer ═════════════════════════│
     │                                                          │
     │  data-channel.open                       data-channel.open
     │                                                          │
     │  ──── file bytes / video frames / clipboard ────────────►│
     │  ◄─── ack messages / clipboard ──────────────────────────│
     │                            │                            │
     │  (signaling server can be killed here, session survives) │
```

## Signaling protocol

The signaling server is a single WebSocket endpoint at `/ws`. Messages are JSON, identified by a `type` field. Every client-to-server message includes a `reqId` so the server can address replies (acks) back to the right call.

### Client → server

| `type` | Body | Sent by |
|---|---|---|
| `create-room` | `{ code, offer, iceCandidates }` | host |
| `join-room` | `{ code }` | joiner |
| `submit-answer` | `{ code, answer, iceCandidates }` | joiner |
| `ice-candidate` | `{ code, candidate }` | both, during trickle ICE |

### Server → client

| `type` | Body | Sent to | When |
|---|---|---|---|
| `ack` | `{ reqId, success?, error?, ...payload }` | originator of `reqId` | reply to a request |
| `answer-received` | `{ answer, answerCandidates }` | host | joiner submitted an answer |
| `ice-candidate` | `{ candidate }` | the other peer | trickle ICE during negotiation |
| `peer-disconnected` | `{}` | the other peer | a peer's WebSocket closed |

### Wire format example

Joiner asks for an offer:

```json
{ "reqId": "r-3", "type": "join-room", "data": { "code": "482917" } }
```

Server replies:

```json
{
  "type": "ack",
  "reqId": "r-3",
  "success": true,
  "offer": { "type": "offer", "sdp": "v=0\r\no=- 4611..." },
  "offerCandidates": [
    { "candidate": "candidate:1 1 UDP 2122260223 192.168.1.42 56789 typ host", "sdpMid": "0", "sdpMLineIndex": 0 }
  ]
}
```

### Compatibility note

This is **not** Socket.io. The original altrusian.com signaling server used Socket.io's auto-generated framing; the standalone FastAPI server uses plain JSON over a raw WebSocket. The protocol surface above is identical — only the transport changed. The `socket.io-client` dependency was dropped from the frontend.

## Data channels

After the handshake, three SCTP data channels are open:

| Label | Ordered | Use |
|---|---|---|
| `file-transfer` | yes | binary file chunks (256 KB each) |
| `clipboard-sync` | yes | UTF-8 JSON text payloads |
| `control` | yes | metadata: file headers, transfer progress, in-band SDP renegotiation |

All three are encrypted at the DTLS layer — there is no point at which the file bytes are unencrypted in transit.

## File transfer pipeline

```
sender                                                receiver
  │                                                       │
  │── { type: 'file-meta', name, size, mime } ───────────►│
  │   over `control` channel                              │
  │                                                       │  prepare buffer / IndexedDB
  │── chunk 0 (256 KB) ──────────────────────────────────►│
  │── chunk 1 (256 KB) ──────────────────────────────────►│
  │   over `file-transfer` channel                        │
  │   ...                                                 │
  │── chunk N (last, may be < 256 KB) ───────────────────►│
  │── { type: 'file-eof', sha?: '...' } ─────────────────►│
  │                                                       │  reassemble, hand to user
  │◄── { type: 'file-ack' } ──────────────────────────────│
  │   over `control` channel                              │
```

### Why 256 KB chunks?

WebRTC's SDP negotiates `max-message-size: 262144`. We pick the largest chunk size that won't cause fragmentation. Smaller chunks mean more syscalls and more JS event loop overhead — the difference between 16 KB and 256 KB chunks is roughly **5×** throughput on LAN.

### Backpressure

We watch `dataChannel.bufferedAmount`:

- `bufferedAmount > 1 MB` → pause sending
- `bufferedAmount < 256 KB` → resume

This keeps the SCTP send buffer (~16 MB on Chrome) hot without overflowing it. Without backpressure, sending a 5 GB file would crash the browser tab.

## Media renegotiation (in-band signaling)

Adding a camera/screen track *after* the connection is established requires renegotiating the SDP. We don't go back to the signaling server for this — instead we tunnel the renegotiation through the `control` data channel.

```
A enables camera
  │
  │  pc.addTrack(cameraTrack)
  │  → fires 'negotiationneeded'
  │  → A creates new SDP offer
  │  → A sends { type: 'ctrl-sdp-offer', sdp } via `control` channel
  │  → B receives, setRemoteDescription, createAnswer
  │  → B sends { type: 'ctrl-sdp-answer', sdp } via `control` channel
  │  → A applies answer
  │  → ICE candidates flow as { type: 'ctrl-ice-candidate', candidate }
  │
  │  Camera track is now flowing.
```

The signaling server is not involved. This works even after the server is shut down.

### Glare resolution

If both peers try to renegotiate at the same time ("glare"), the **polite peer** (joiner) backs off and applies the impolite peer's offer. This follows the [Perfect Negotiation pattern](https://www.w3.org/TR/webrtc/#perfect-negotiation-example) from the WebRTC spec.

## ICE candidate filtering

By default we **drop relay candidates** to force direct connections. This is a deliberate choice:

- Relay candidates route traffic through a TURN server, which means **someone else sees your bytes**.
- Teleport's threat model is "the network never sees plaintext file content" — TURN would compromise that, even though it's still DTLS-encrypted hop-to-hop.
- If you control your own TURN server (e.g., for users behind symmetric NATs), set `NEXT_PUBLIC_TURN_URL` and remove the relay filter in `src/lib/webrtc.ts:filterCandidate`. We've kept the hook intentional.

We **keep** `host` (LAN) and `srflx` (NAT-reflexive) candidates. These cover ~95% of real-world networks.

## State machine

The frontend's connection state, exposed by `useWebRTC()`:

```
                        ┌──────────┐
                        │   idle   │◄────────────────┐
                        └────┬─────┘                 │
                             │                       │
            host ────────────┼──────── join          │
                             │                       │
                       ┌─────▼─────┐                 │
                       │ creating  │   ┌──────────┐  │
                       │ /joining  │   │  failed  │  │
                       └─────┬─────┘   └────▲─────┘  │
                             │              │        │
                       ┌─────▼─────┐        │        │
                       │  waiting  │── error┘        │
                       └─────┬─────┘                 │
                             │                       │
                       ┌─────▼─────┐                 │
                       │connecting │                 │
                       └─────┬─────┘                 │
                             │                       │
                       ┌─────▼─────┐                 │
                       │ connected │── disconnect ───┘
                       └───────────┘
```

## What the server can and cannot see

| Server sees | Server does NOT see |
|---|---|
| Each peer's IP address (during WebSocket connect) | File names, file content, file size |
| The 6-digit code | Video / audio / screen content |
| Encoded SDP (codec list, DTLS fingerprint) | Clipboard text |
| Encoded ICE candidates (network paths) | Anything sent on data channels |
| Connection timing | Anything sent over media tracks |

Once both peers complete the DTLS handshake, the server is **out of band**. You can rotate the signaling server's IP, kill it, restart it — established peer connections are unaffected.

## Performance tuning

Numbers from internal benchmarks (Chrome 131 on M2 Mac, Gigabit LAN):

| Workload | Throughput |
|---|---|
| File transfer (sustained, 5 GB single file) | ~110 MB/s |
| Screen share (4K@30, low-motion) | ~3.5 Mbps |
| Video call (720p) | ~1.5 Mbps |

### Tuning knobs

- **Chunk size** (`backend/app/core/manager.py` does not affect this — it's frontend-only): bump `CHUNK_SIZE_LARGE` in `src/lib/teleport-constants.ts` to 512 KB if you've negotiated a higher `max-message-size`.
- **Backpressure thresholds**: `BUFFER_HIGH_THRESHOLD` and `BUFFER_LOW_THRESHOLD` in the same file.
- **Bitrate caps for media**: per-track caps in `src/hooks/useMediaStreams.ts` (camera 2.5 Mbps, screen 4 Mbps).

These are the levers we tuned to hit the numbers above. The defaults are a good starting point — but on a 10 GbE LAN, raising chunk size and disabling host candidate filtering further will get you closer to wire speed.

---

For the security model, threat assumptions, and responsible disclosure process, see [SECURITY.md](./SECURITY.md).
