# Security

## Threat model

Teleport's design goal: **the only thing leaving your device unencrypted is the data your operating system already sees.**

We assume an attacker who:

- Controls the network between the two peers (ISP, coffee shop wifi, nation-state).
- Controls or compromises the signaling server.
- Can observe DNS lookups and TLS metadata.

We **do not** assume an attacker who:

- Controls one of the peers' browsers (game over — they have the cleartext anyway).
- Has installed a malicious browser extension on either peer (same).
- Has compromised the user's TLS certificate authority (would let them MITM the *initial page load*; doesn't compromise WebRTC's DTLS).

## What is encrypted, by what

| Layer | Protects | Encryption |
|---|---|---|
| HTTPS (page load) | The Teleport HTML/JS itself | TLS 1.3, browser-managed |
| WebSocket (signaling) | The SDP offer/answer + ICE candidates | TLS 1.3 (when served over `wss://`) |
| WebRTC data channel | Files, clipboard, control messages | DTLS 1.2/1.3, fingerprint-pinned in SDP |
| WebRTC media track | Audio, video, screen | SRTP, derived from the DTLS handshake |

DTLS keys are **never sent over the wire**. The peers exchange certificate fingerprints inside the SDP, then perform a fresh DTLS handshake directly between themselves. A signaling server that swaps SDPs at the wrong moment can disrupt connections, but cannot decrypt them.

## What the signaling server learns

Even a fully malicious signaling server only sees:

- Two IP addresses (one per peer).
- A 6-digit code.
- The two SDPs (codec lists, DTLS fingerprints, ICE candidates).
- Connection timing.

It **cannot** decrypt file contents, clipboard text, video, or audio. Self-host the signaling server if you want to control even that surface.

## Code privacy

The 6-digit code is the only piece of secrecy in the join flow. It is:

- Generated client-side via `Math.random()` (currently — we plan to migrate to `crypto.getRandomValues` for stronger entropy; tracked in [issue #N](https://github.com/OWNER/teleport/issues)).
- Single-use (a room can only be joined once).
- TTL-bounded (default 60 seconds of inactivity → cleanup).

A malicious actor would need to **guess the code** (1 in 900,000) **before the legitimate joiner connects** (typically a few seconds) **and** establish a WebSocket connection within that window. We consider this acceptable for the casual file-transfer use case.

If you need stronger guarantees:

- Increase code length in `src/lib/words.ts` (drop-in change to `generateCode()`).
- Add an additional shared-secret check in `useWebRTC.ts` after channels open.

## NAT traversal

WebRTC works flawlessly when at least one peer has a public IP or symmetric NAT. For two peers behind symmetric NAT (corporate firewalls, mobile carrier-grade NAT), direct P2P often fails.

The standard solution is a **TURN server** that relays traffic between peers. By default, Teleport **drops relay candidates** to enforce direct connections — this is a privacy choice. To enable TURN:

1. Run your own TURN server (we recommend [coturn](https://github.com/coturn/coturn)) or use a free tier from [metered.ca](https://www.metered.ca/tools/openrelay/) or [Twilio](https://www.twilio.com/docs/stun-turn).
2. Set `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USERNAME`, `NEXT_PUBLIC_TURN_CREDENTIAL` in your frontend env.
3. Remove the `relay` filter in `src/lib/webrtc.ts:filterCandidate`.

When TURN is active, file bytes are **still** DTLS-encrypted through the relay — the TURN operator sees ciphertext, not plaintext. The privacy concern is metadata (you connected to TURN, you sent ~N bytes), not content.

## Reporting a vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Instead, email **security@your-domain.example** with:

- A description of the issue.
- Steps to reproduce.
- Your assessment of severity and impact.
- Whether you'd like public credit on disclosure.

You'll get a response within **72 hours**. Confirmed vulnerabilities will be fixed in the next minor release with credit to you (unless you prefer anonymity), and disclosed publicly once a patched version is available.

## Out of scope

- Vulnerabilities in WebRTC implementations themselves (report to the browser vendor).
- DoS against the signaling server (it's by design unauthenticated; if you're under attack, put Cloudflare in front of it).
- Social engineering of one of the peers (e.g., tricking them into reading their code aloud).

## Security-relevant defaults

- Frontend has **no third-party scripts**, no analytics, no telemetry, no fonts loaded from a CDN.
- Backend has **no logging of WebSocket message contents**, only metadata (room created, peer joined, peer left).
- No persistence: rooms live in RAM only. Killing the signaling server wipes all room state.
- CORS defaults to `*` only in development. Production deployments must explicitly set `CORS_ORIGINS`.
