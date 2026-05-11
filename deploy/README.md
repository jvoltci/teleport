# Deployment

Two pieces. Deploy them in any order.

## 1. Frontend (any static host)

The frontend is a static export. Deploy `frontend/out/` after `npm run build` to:

- **GitHub Pages** — already wired via `.github/workflows/pages.yml`. Push to main.
- **Cloudflare Pages / Netlify** — point the build to `frontend/`, command `npm run build`, output `frontend/out`.
- **Your own nginx / Caddy / S3 + CloudFront** — serve the `out/` directory as a static site.

Set `NEXT_PUBLIC_SIGNALING_URL` at build time to the WebSocket URL of your signaling server.

## 2. Signaling server (any Linux host)

Quickest path: a small VM with Docker.

```bash
ssh you@your-vm
git clone https://github.com/YOUR_USERNAME/teleport.git
cd teleport/deploy
cp .env.example .env
$EDITOR .env                 # set DOMAIN, ACME_EMAIL, CORS_ORIGINS
docker compose up -d
```

What this does:

- Starts the FastAPI signaling server on an internal port.
- Starts Caddy in front of it. Caddy auto-provisions a Let's Encrypt cert for `$DOMAIN` and renews it forever.
- Restarts both containers if they crash, and on host reboot.

**DNS:** point an `A` record for `$DOMAIN` at your VM's public IP. Caddy needs that to validate the cert.

**Firewall:** open ports 80 and 443. Nothing else needs to be open.

### Verify it works

```bash
curl https://signal.yourdomain.com/
# → {"service":"teleport-signaling","status":"ok","uptime":...,"rooms":0}
```

### Updating

```bash
cd teleport
git pull
cd deploy
docker compose up -d --build
```

### Logs

```bash
docker compose logs -f signaling
docker compose logs -f caddy
```

## Local development

```bash
cd deploy
docker compose -f docker-compose.dev.yml up
# Frontend on http://localhost:3000
# Signaling on http://localhost:4000
```

Or run them natively — see the root README.

## Provider-specific notes

### Oracle Cloud Free Tier (1 OCPU / 1 GB AMD)

Works without modification. Open ports 80/443 in the VCN security list AND in `iptables`:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### Hetzner Cloud / DigitalOcean / Linode

Just `apt install docker.io docker-compose-plugin`, then follow the steps above.

### Render.com / Railway / Fly.io

Use the `backend/Dockerfile` directly. Set the same env vars from `.env.example`. Note: free tiers that sleep idle services (Render free) are a poor fit — first request after sleep takes 30s, which times out a peer waiting to connect.
