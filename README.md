# Nutrition Tracker

A household nutrition app for phones, tablets, and a Home Assistant panel. One server, separate people, a shared food library, and a family dashboard (weight stays private).

The mark is a simplified protein alpha helix.

**Docs:** [docs/README.md](./docs/README.md) · [Architecture](./docs/ARCHITECTURE.md) · [Code map](./docs/CODE-MAP.md)

---

## Setup guide (in order)

Work through these steps once on the machine that will run the server. Do not skip ahead—later steps assume earlier ones are done.

### Step 1 — Choose how Caddy runs

Pick one mode and use it in **Step 4** (`CADDY_STYLE` in `.env`).

| Mode | Best for | Who publishes port **3010** | Set in `.env` (Step 4) |
| --- | --- | --- | --- |
| **STANDALONE** (default) | New install, Windows WSL, Raspberry Pi, single repo | **This repo** (bundled `nutrition-caddy`) | `CADDY_STYLE=STANDALONE` |
| **EXTERNAL** | Homelab with sibling `infrastructure/` | **Shared** Caddy on `media-network` | `CADDY_STYLE=EXTERNAL` |

Always run **`./deploy.sh`** after Step 4 — it reads `CADDY_STYLE` from `.env` (defaults to STANDALONE if unset). On **Windows**, run all shell commands in **WSL Ubuntu**, not PowerShell.

---

### Step 2 — Install dependencies on the server machine

**Windows PC (recommended path for non-developers)**

Follow **[docs/SETUP-WINDOWS-WSL.md](./docs/SETUP-WINDOWS-WSL.md)** steps **1–4** in order:

1. WSL2 + Ubuntu  
2. Docker Desktop (WSL integration on)  
3. Tailscale for Windows  
4. Clone the repo (GitHub Desktop and/or `git` in Ubuntu)

That document also covers **VS Code** or **vim** for editing config files, and **optional Node.js** for deploy tests (section **B2**).

**Linux or macOS (GUI or CLI)**

| Need | GUI | CLI |
| --- | --- | --- |
| Docker | [Docker Desktop](https://docs.docker.com/desktop/) or your distro’s Docker package | `docker` + `docker compose` on PATH |
| Git | [GitHub Desktop](https://desktop.github.com/) | `git` |
| Remote phones | [Tailscale](https://tailscale.com/download) app | `tailscale` package + `tailscale up` |
| Deploy tests (optional) | [Node.js 22+](https://nodejs.org/) installer | See **Host Node.js** below |

Confirm Docker works:

```bash
docker version
docker compose version
```

#### Host Node.js (for `./deploy.sh` tests)

The app runs in **Docker**; you do **not** need Node to *use* Nutrition Tracker. You **do** need **Node.js 22+** and **npm** on the **host** (WSL Ubuntu, Linux, or macOS) if you want the default deploy script to run **`npm test`** before `docker compose up`. Tests are **not** run inside the container during deploy.

Check:

```bash
node -v   # expect v22.x or newer
npm -v
```

**Ubuntu / WSL (recommended — NodeSource 22.x)**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

**macOS (Homebrew)**

```bash
brew install node@22
brew link node@22 --force --overwrite   # if `node` is not on PATH yet
node -v
```

**Any OS (nvm)**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# open a new shell, then:
nvm install 22
nvm use 22
node -v
```

If you **skip Node**, pass **`--skip-test`** on every deploy (there is no `--no-test` flag):

```bash
./deploy.sh --skip-test --skip-git
```

Docker-only manual start (no deploy script, no tests): see Step **5** manual `docker compose` blocks.

---

### Step 3 — Clone this repository

**GitHub Desktop:** clone to a folder you can open in WSL (or clone inside WSL home for best Docker performance).

**Terminal:**

```bash
git clone https://github.com/raffenit/Nutrition-Tracker.git
cd Nutrition-Tracker
```

---

### Step 4 — Create and edit `.env`

```bash
cp .env.example .env
```

Edit `.env` (VS Code, vim, or nano). Minimum for a first run:

| Variable | Example | Purpose |
| --- | --- | --- |
| `CADDY_STYLE` | `STANDALONE` or `EXTERNAL` | From Step 1 |
| `TZ` | `America/Chicago` | Household “today” |
| **`TAILSCALE_SERVER_URL`** | `http://100.x.x.x` then `https://pc-name.your-tailnet.ts.net` | **Tailscale server URL** — tailnet-only (not public internet). Host only; no `:3010`. Start with HTTP IP; switch to HTTPS after **Step 8**. |
| `NUTRITION_PORT` | `3010` | Port Caddy publishes for **HTTP** via Tailscale IP (phones skip this when using HTTPS URL) |

The legacy name `PUBLIC_URL` still works if you already use it; prefer **`TAILSCALE_SERVER_URL`** for new installs.

Optional later: `USDA_API_KEY`, `VAPID_*` (Web Push — needs HTTPS in Step 8). See [.env.example](./.env.example).

**One file only:** `./deploy.sh` and Docker both read **`.env`**. Do not create `local/deploy.env` — if an old copy exists, deploy removes it automatically.

Optional in **`.env`** (read by `./deploy.sh`, not passed to the app container unless listed in `docker-compose.yml`):

- `INFRA_COMPOSE_DIR` — EXTERNAL only, if `infrastructure/` is not `../infrastructure`
- `DEPLOY_COMMIT_MSG` — default message when deploy commits dirty git state

---

### Step 5 — Start the stack

Use **`./deploy.sh`** — it reads **`CADDY_STYLE`** from `.env` (Step 4) and runs the right compose files.

| Your machine | Command |
| --- | --- |
| **Node 22+ installed** (Step 2) | `./deploy.sh --skip-git` (runs `npm test`, then Docker) |
| **Docker only** (no Node) | `./deploy.sh --skip-test --skip-git` |
| **Dev machine** with git remotes configured | `./deploy.sh -m "Describe your change"` |

#### 5A — STANDALONE (bundled Caddy)

No separate infrastructure repo required.

```bash
./deploy.sh --skip-test --skip-git
```

Replace `--skip-test` once Node is installed (see Step 2).

Manual equivalent (no tests, no deploy script):

```bash
docker compose -f docker-compose.yml -f docker-compose.standalone.yml up -d --build
```

#### 5B — EXTERNAL (shared homelab Caddy)

1. Ensure **`infrastructure/`** is running and defines Docker network **`media-network`**.
2. Ensure infrastructure **`Caddyfile`** includes:

```caddy
:3010 {
    reverse_proxy nutrition-tracker:3010
    encode gzip
}
```

3. Deploy the app (with **`CADDY_STYLE=EXTERNAL`** in `.env`):

```bash
./deploy.sh --skip-test --skip-git
```

After Caddyfile or infrastructure compose changes: `./deploy.sh --infra --skip-git` (add `--skip-test` if you have no Node).

---

### Step 6 — Verify the server

On the **server**:

```bash
curl -s http://localhost:3010/api/health
```

Expect JSON with `"ok": true` (or setup prompt fields on first boot).

From a **phone** on the **same Tailscale tailnet** (not public internet), open:

| Page | URL (HTTP — before Step 8) |
| --- | --- |
| Personal app | `http://YOUR_TAILSCALE_IP:3010` |
| Family board | `http://YOUR_TAILSCALE_IP:3010/family` |

These should match `TAILSCALE_SERVER_URL` + `NUTRITION_PORT` in `.env`. After HTTPS (Step 8), use `https://YOUR-MACHINE.your-tailnet.ts.net` instead (no port).

Add to the phone home screen: Safari/Chrome → Share → **Add to Home Screen**.

If health fails, check logs:

```bash
# STANDALONE
docker compose -f docker-compose.yml -f docker-compose.standalone.yml logs -f

# EXTERNAL
docker compose -f docker-compose.yml logs -f
```

---

### Step 7 — First visit in the app

1. Open the personal URL → complete **Setup** (household name, admin user, password).  
2. **Settings** → set daily targets (calories, protein, etc.).  
3. **Library** → add foods; on **Today**, use **+** to log meals.  
4. (Optional) **Settings** → create a **family / kiosk link** (requires **`TAILSCALE_SERVER_URL`** in `.env`) for a wall tablet or Home Assistant iframe.

---

### Step 8 — HTTPS on your tailnet (recommended)

Nutrition Tracker is meant for your **Tailscale tailnet**, not the open internet. You can start with **HTTP + Tailscale IP** (Step 6). **HTTPS** gives nicer URLs (no `:3010`), trusted certificates on phones, and is **required for Web Push** goal alerts.

Do this **after** Step 6 works over HTTP.

#### What changes

| Mode | `.env` | Open on phone (Tailscale on) |
| --- | --- | --- |
| **HTTP** (first install) | `TAILSCALE_SERVER_URL=http://100.x.x.x` and `NUTRITION_PORT=3010` | `http://100.x.x.x:3010` |
| **HTTPS** (after this step) | `TAILSCALE_SERVER_URL=https://YOUR-MACHINE.your-tailnet.ts.net` | `https://YOUR-MACHINE.your-tailnet.ts.net` |

#### Setup (once per server)

1. **Enable tailnet HTTPS** — [Tailscale admin → DNS](https://login.tailscale.com/admin/dns): turn on **MagicDNS** and **HTTPS certificates** (Let’s Encrypt for `*.ts.net` names on your tailnet only).
2. **Find your machine name** — Tailscale app or `tailscale status` on the server. You will use `https://<machine>.<tailnet>.ts.net` (exact suffix is shown in the admin UI).
3. **Proxy HTTPS to the app** — on the server (WSL or Linux), with the stack already running on port 3010:
   ```bash
   sudo tailscale serve --bg http://127.0.0.1:3010
   ```
   Tailscale terminates HTTPS on **443** and forwards to local Caddy/app on **3010**.
4. **Update `.env`** — set the HTTPS URL (no port):
   ```env
   TAILSCALE_SERVER_URL=https://YOUR-MACHINE.your-tailnet.ts.net
   ```
   Keep `NUTRITION_PORT=3010` for local health checks and Caddy; phones use the HTTPS URL without a port.
5. **Redeploy** — `./deploy.sh --skip-git` (add `--skip-test` if you have no Node).
6. **Phone** — open the `https://…ts.net` URL with Tailscale connected; update home-screen bookmark; in **Settings**, enable push if you configured `VAPID_*`.
7. **Verify in tests** — `npm test` runs an HTTPS smoke check when `TAILSCALE_SERVER_URL` is `https://…` (same machine must reach that URL over Tailscale). Use `SKIP_HTTPS_SMOKE=1` to bypass.

To stop HTTPS proxying later: `sudo tailscale serve reset`.

---

### Step 9 — Updates

Pull new code, then redeploy (same **`--skip-test`** choice as Step 5):

```bash
git pull
./deploy.sh --skip-git
# Docker only (no Node on host):
./deploy.sh --skip-test --skip-git
```

---

## Deploy script reference

| Command | When |
| --- | --- |
| **`./deploy.sh`** | **Always** — reads `CADDY_STYLE` from `.env` (Step 4) |

Common flags: `--help`, `--skip-test`, `--skip-git`, `-m "commit message"`, `--pull`, `--down`  
**EXTERNAL only:** `--infra` restarts sibling infrastructure Caddy.

Default pipeline (when not skipping): **`npm test` on the host** (requires Node 22+; see Step 2) → optional git commit/push → Docker build/up → health check on port **3010**. Use **`--skip-test`** when Node is not installed.

`standalone-deploy.sh` and `external-deploy.sh` are internal helpers invoked by `./deploy.sh`. Run them directly only to force STANDALONE/EXTERNAL when `.env` is wrong or missing and you cannot edit it yet (unusual).

---

## Technology

| Part | Stack |
| --- | --- |
| **`web/`** | React 19, Vite, TypeScript |
| **`server/`** | Node.js 22+, SQLite, OCR/PDF import |
| **Runtime** | Docker; STANDALONE adds Caddy 2 in `caddy/Caddyfile` |

---

## Development (laptop)

```bash
npm test       # server tests + web tsc + optional HTTPS smoke → local/test-last-run.log
npm run build
```

Without Docker: run built `server/` on port 3010 and `web/` `npm run dev` (Vite proxies `/api`).

---

## More documentation

- [docs/SETUP-WINDOWS-WSL.md](./docs/SETUP-WINDOWS-WSL.md) — expanded Windows/WSL steps (matches Setup **Step 2** here)  
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — data model, API, privacy  
- [docs/ROADMAP.md](./docs/ROADMAP.md) — feature phases  

GitHub: `https://github.com/raffenit/Nutrition-Tracker`

---

## Repository layout

| Path | Role |
| --- | --- |
| `server/` | API, SQLite, OCR/PDF |
| `web/` | React UI |
| `caddy/` | Standalone Caddyfile (`:3010`) |
| `docker-compose.yml` | App container |
| `docker-compose.standalone.yml` | STANDALONE: Caddy + network |
| `deploy.sh` | Deploy entrypoint (`CADDY_STYLE` in `.env`) |
| `standalone-deploy.sh` / `external-deploy.sh` | Used by `deploy.sh`; rarely run by hand |
| `data/` | Database and uploads (runtime; not in git) |
