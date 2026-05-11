<div align="center">

# Teleport

**Zero-cloud, peer-to-peer file transfer, screen sharing, and video calls — in your browser.**

Drop a file, share a 6-digit code, watch it teleport directly to the other device. Your data never touches a server.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![CI](https://github.com/jvoltci/teleport/actions/workflows/ci.yml/badge.svg)](https://github.com/jvoltci/teleport/actions/workflows/ci.yml)
[![Deploy](https://github.com/jvoltci/teleport/actions/workflows/pages.yml/badge.svg)](https://github.com/jvoltci/teleport/actions/workflows/pages.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

[**Live demo**](https://jvoltci.github.io/teleport) · [**Self-host**](#self-hosting) · [**Architecture**](./ARCHITECTURE.md) · [**Security**](./SECURITY.md)

</div>

---

## What it is

Teleport is a browser-only WebRTC app that connects two devices directly over the internet (or your local network) and lets them:

- **Send files** of any size, with no upload step. Bytes flow device-to-device.
- **Share a screen or window** at up to 4 Mbps with audio.
- **Video call** with mic, camera, and one-tap camera switching.
- **Sync clipboard text** across devices in real time.

The only thing the server ever sees is the WebRTC handshake — a few hundred bytes of SDP. After that, the two devices are talking directly. The server can be turned off and active sessions keep running.

## Why it's different

| | Teleport | WeTransfer / Send | AirDrop |
|---|---|---|---|
| File size limit | None | 2 GB free / 200 GB paid | None |
| Files touch a server | **No** | Yes — uploaded, then downloaded | No |
| Cross-platform | **Any browser** | Any browser | Apple-only |
| Sign-up required | **No** | Sometimes | No |
| Screen share + video | **Yes** | No | No |
| Self-hostable | **Yes** | No | N/A |
| Open source | **Yes (MIT)** | No | No |

## Quickstart — try it in 60 seconds

1. Open the [live demo](https://jvoltci.github.io/teleport) on **Device A**.
2. Click **Start session** — a 6-digit code appears.
3. Open the same URL on **Device B**, type the code (or scan the QR).
4. Drop a file on either device. It teleports.

That's it. No accounts, no uploads, no waiting.

## Self-hosting

Teleport has two pieces:

- **Frontend** — a static Next.js app. Deploys anywhere that serves HTML (GitHub Pages, Cloudflare Pages, Netlify, S3, your own nginx).
- **Signaling server** — a tiny FastAPI WebSocket service (~100 lines) that brokers the WebRTC handshake. Runs on any Linux box with 256 MB of RAM.

### Option 1: GitHub Pages + a free VM (recommended)

```bash
# 1. Fork this repo, then in your fork's Settings → Pages, set Source = GitHub Actions.
# 2. Provision any cheap Linux VM (Oracle Cloud Always Free, Hetzner €4/mo, etc.).
# 3. SSH in and run:

git clone https://github.com/YOUR_USERNAME/teleport.git
cd teleport/deploy
cp .env.example .env
# Edit .env: set DOMAIN=signal.yourdomain.com, CORS_ORIGINS=https://your-username.github.io
docker compose up -d

# 4. In your fork, set the GitHub Actions secret:
#    NEXT_PUBLIC_SIGNALING_URL = https://signal.yourdomain.com
# 5. Push to main. GitHub Pages builds and deploys.
```

That's the full setup. Caddy auto-provisions HTTPS, the signaling server runs under systemd, and you're done.

### Option 2: Local development

```bash
# Terminal 1 — backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 4000

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
# Open http://localhost:3000
```

### Option 3: Docker (everything)

```bash
docker compose -f deploy/docker-compose.dev.yml up
# Frontend on :3000, signaling on :4000
```

## How it works (30-second version)

```
   Device A                  Signaling Server                  Device B
   ┌──────┐                   ┌──────────────┐                ┌──────┐
   │      │ ── 1. offer ───►  │              │                │      │
   │      │                   │  Tiny relay  │ ◄─ 2. join ──  │      │
   │      │ ◄── 3. answer ──  │  (FastAPI)   │ ── 3. answer ─►│      │
   │      │                   └──────────────┘                │      │
   │      │ ═══════════════ 4. WebRTC P2P ════════════════════│      │
   │      │ ═══════════ files / video / clipboard ═══════════ │      │
   └──────┘                                                   └──────┘
```

1. Device A creates a session, generates a 6-digit code, sends an SDP offer to the signaling server.
2. Device B types the code, receives the offer.
3. Device B replies with an SDP answer.
4. Both devices now have each other's network info. They open a direct WebRTC connection. The server is no longer in the loop. Data flows peer-to-peer over three data channels: `file-transfer`, `clipboard-sync`, and `control`.

For the full version — including how renegotiation works, ICE candidate filtering, and the chunking strategy that gets us 100+ MB/s on LAN — see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Project layout

```
teleport/
├── frontend/            Next.js 15 (App Router), static export, TypeScript strict
│   ├── src/app/         Page + layout
│   ├── src/components/  UI (Portal, CodeDisplay, MediaStage, FileTransferManager, …)
│   ├── src/hooks/       useWebRTC, useFileTransfer, useMediaStreams, useClipboard
│   └── src/lib/         WebRTC core, signaling adapter, constants
├── backend/             FastAPI WebSocket signaling server
│   ├── app/main.py      ASGI entry
│   ├── app/routers/     /healthz, /signaling
│   ├── app/core/        Room manager, config
│   └── tests/           pytest
├── deploy/              docker-compose, Caddyfile, systemd unit, .env.example
├── docs/                Diagrams, screenshots
└── .github/             CI workflows, issue/PR templates
```

## Configuration

### Frontend

| Var | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SIGNALING_URL` | `ws://localhost:4000` | WebSocket URL of the signaling server |
| `NEXT_PUBLIC_STUN_URLS` | Google public STUN | Comma-separated STUN server URLs |
| `NEXT_PUBLIC_TURN_URL` | _(empty)_ | Optional TURN server URL — see [SECURITY.md § NAT traversal](./SECURITY.md#nat-traversal) |
| `NEXT_PUBLIC_TURN_USERNAME` | _(empty)_ | TURN username |
| `NEXT_PUBLIC_TURN_CREDENTIAL` | _(empty)_ | TURN password |
| `NEXT_PUBLIC_BASE_PATH` | _(empty)_ | Set to `/teleport` if hosting at `username.github.io/teleport` |

### Backend

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Listen port |
| `CORS_ORIGINS` | `*` (dev), required in prod | Comma-separated list of allowed origins |
| `ROOM_TTL_SECONDS` | `60` | How long an inactive room is kept before cleanup |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |

## Roadmap

Want to help? Pick anything below — or open an issue with a new idea.

- [ ] Multi-peer rooms (3+ participants)
- [ ] End-to-end encrypted text chat alongside file transfer
- [ ] Resumable transfers across reconnects
- [ ] Mobile PWA wrapper with native share-sheet integration
- [ ] Optional E2EE password layer on top of DTLS
- [ ] Bring-your-own-TURN admin UI

## Contributing

We welcome contributions of every size — from typo fixes to new features. Start with [CONTRIBUTING.md](./CONTRIBUTING.md). All contributors agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

**Good first issues** are tagged [`good-first-issue`](https://github.com/jvoltci/teleport/issues?q=label%3Agood-first-issue) — they're small, well-scoped, and reviewed quickly.

## Security

Found a vulnerability? Please **don't** file a public issue — email security disclosures per [SECURITY.md](./SECURITY.md).

## License

MIT — see [LICENSE](./LICENSE). Use it, fork it, ship it commercially. Just keep the copyright notice.

## Acknowledgements

Teleport stands on the shoulders of:

- **WebRTC** — the W3C/IETF standard that makes browser-to-browser connections possible.
- **FastAPI** — for a signaling server you can read in one sitting.
- **Next.js** — for the app shell.
- **Caddy** — for HTTPS that just works.

If Teleport saves you a WeTransfer subscription, consider starring the repo. ⭐
