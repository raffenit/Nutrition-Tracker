# Nutrition Tracker

A household nutrition app for phones, tablets, and a Home Assistant panel. One server, separate people, a shared food library, and a family dashboard (weight stays private).

The mark is a simplified protein alpha helix.

---

## After setup — how you open the app

Replace `YOUR_SERVER_TAILSCALE_IP` with your home server’s Tailscale address (see [Tailscale](#step-1--tailscale-remote-access-from-phones) below).

| What | URL |
| --- | --- |
| Personal app (log meals, library, settings) | `http://YOUR_SERVER_TAILSCALE_IP:3010` |
| Family board (shared day view for the household) | `http://YOUR_SERVER_TAILSCALE_IP:3010/family` |

On the server itself you can also use `http://localhost:3010` (via Caddy on port 3010).

**Add to your phone home screen:** open the personal URL in Safari/Chrome → share → **Add to Home Screen**. The app ships a web manifest for a standalone icon.

---

## Setup guide

This app runs on a home server with Docker. It does **not** expose a port on the host by itself; **Caddy** in a shared **infrastructure** stack publishes port **3010** and forwards traffic to the app container on the `media-network` Docker network.

### What you need

- A machine with **Docker** and **Docker Compose**
- **Tailscale** on that machine and on each phone/tablet you use away from home
- An **infrastructure** directory (Caddy reverse proxy + `media-network`) — typically a **sibling** of this repo
- This **Nutrition-Tracker** repository

Example layout (your paths may differ):

```text
~/servers/
├── infrastructure/     ← start this first (Caddy + media-network)
└── Nutrition-Tracker/  ← this app
```

**Host-specific values** (real paths, Tailscale IP, infra location) go in `local/` — that folder is gitignored. Copy from `local.example/`:

```bash
cp local.example/deploy.env.example local/deploy.env
# edit local/deploy.env — e.g. REMOTE_BASE_URL, INFRA_COMPOSE_DIR
```

### Step 1 — Tailscale (remote access from phones)

1. Install [Tailscale](https://tailscale.com/download) on the home server and sign in to your tailnet.
2. Install Tailscale on each phone/tablet and sign in with an account that can reach the server (per your tailnet ACLs).
3. On the **server**, find its Tailscale IPv4 address:

   ```bash
   tailscale ip -4
   ```

4. From a phone on Tailscale, you should reach `http://YOUR_SERVER_TAILSCALE_IP:3010` **after** Steps 2–4 below. You do not need router port-forwarding; Tailscale carries traffic on your private mesh.

**Note:** The app is usually served over **HTTP** on a Tailscale IP. That is normal for a private tailnet. Do not expose port 3010 to the public internet unless you add TLS and appropriate access controls in front of it.

### Step 2 — Infrastructure (Caddy proxy + Docker network)

Start the shared stack **before** Nutrition Tracker:

```bash
cd /path/to/infrastructure
docker compose up -d
```

That should create the **`media-network`** bridge and run **Caddy** with host port **3010** mapped for this app.

**Caddy must proxy to this app.** Add a block like the following to your infrastructure `Caddyfile`:

```caddy
# Nutrition Tracker
:3010 {
    reverse_proxy nutrition-tracker:3010
    encode gzip
}
```

Publish the port on the Caddy service (example):

```yaml
ports:
  - "3010:3010"
```

The upstream hostname **`nutrition-tracker`** must match `container_name` in this repo’s `docker-compose.yml`.

After changing the Caddyfile or infrastructure compose file:

```bash
cd /path/to/infrastructure
docker compose up -d
```

If infrastructure is not at `../infrastructure` relative to this repo, set `INFRA_COMPOSE_DIR` in `local/deploy.env`.

### Step 3 — Configure this app (optional `.env`)

```bash
cd /path/to/Nutrition-Tracker
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `TZ` | Household timezone for “today” and logs (default `America/Chicago`) |
| `USDA_API_KEY` | Optional — ingredient search in custom meals ([USDA FoodData Central](https://fdc.nal.usda.gov/api-key-signup.html)) |
| `PUBLIC_URL` | Base URL for **family kiosk links** in Settings, e.g. `http://YOUR_SERVER_TAILSCALE_IP:3010` |

If you skip `.env`, defaults still work; set `PUBLIC_URL` if you use the Home Assistant / kiosk display link.

### Step 4 — Deploy Nutrition Tracker

On the server, from this directory:

```bash
./deploy.sh
```

`deploy.sh` checks that `media-network` exists, builds the image, starts the container, and waits for `GET /api/health`. It reads optional overrides from `local/deploy.env`.

Useful flags:

- `./deploy.sh --test` — run `npm test` on the host first (requires Node/npm there)
- `./deploy.sh --infra` — also run `docker compose up -d` in your infrastructure directory
- `./deploy.sh --down` — tear down this stack before redeploying

Manual equivalent:

```bash
docker compose up -d --build
```

**Data** (SQLite and uploads) lives in `./data` on the server. That folder is not in git; back it up with your other server data.

### Step 5 — First visit (create the household)

1. On a phone or PC on Tailscale, open `http://YOUR_SERVER_TAILSCALE_IP:3010`.
2. Complete **Setup**: household name, timezone, first admin user and password.
3. Sign in. Set daily targets under **Settings** (calories, protein, fiber, sodium/salt, hydration, optional extra nutrients).
4. Add foods from the **Library** (scan a label, type values manually, or build a custom meal).

### Step 6 — Family board and Home Assistant (optional)

- Open **Family** in the app or go to `/family` to see everyone’s meals and macros for the day (not weight).
- An **admin** can open **Settings** → create a **kiosk / display link** (requires `PUBLIC_URL`). Paste that URL into a Home Assistant **panel iframe** for a wall tablet.

---

## How traffic flows

```text
Phone (Tailscale)
    → YOUR_SERVER_TAILSCALE_IP:3010
        → Caddy (host port 3010, infrastructure container)
            → nutrition-tracker:3010 (Docker media-network)
                → Node app (API + static web UI)
```

The Nutrition Tracker container only joins **`media-network`**; it does not bind port 3010 on the host. If Caddy is not running, or the proxy block is missing, `:3010` on the server will not reach the app.

---

## Verify everything works

On the **server**:

```bash
curl -s http://localhost:3010/api/health
```

On a **phone** (Tailscale connected):

- Open `http://YOUR_SERVER_TAILSCALE_IP:3010` and sign in.

Logs:

```bash
docker compose logs -f
```

---

## Updates

After pulling or syncing new code on the server:

```bash
./deploy.sh
```

---

## Development (laptop)

**Test** (from repo root):

```bash
npm test
```

**Production build:**

```bash
npm run build
```

**Local run without Docker:**

Terminal 1:

```bash
cd server && npm install && npm run build && DATA_DIR=./data PORT=3010 node dist/index.js
```

Terminal 2:

```bash
cd web && npm install && npm run dev
```

Vite proxies `/api` to port `3010`. Tailscale and Caddy are not required for local dev.

---

## Documentation

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — stack, data model, API, privacy rules
- [docs/ROADMAP.md](./docs/ROADMAP.md) — planned features and phases
- [local.example/](./local.example/) — template for gitignored `local/` host overrides

GitHub: `https://github.com/raffenit/Nutrition-Tracker`

## Layout

- `server/` — Node API, SQLite, label and PDF reading
- `web/` — React app
- `docs/` — architecture and roadmap
- `local.example/` — copy into gitignored `local/` for your server
- `deploy.sh` — deploy + health check
- `docker-compose.yml` — joins external `media-network`
- `data/` — database and uploads (runtime only, not committed)
