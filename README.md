# Nutrition Tracker

A household nutrition app for phones, tablets, and a Home Assistant panel. One server, separate people, a shared food library, and a family dashboard (weight stays private).

The mark is a simplified protein alpha helix.

**Docs:** [docs/README.md](./docs/README.md) · [Architecture](./docs/ARCHITECTURE.md) · [Code map](./docs/CODE-MAP.md)

---

## Setup guide (in order)

Work through these steps once on the machine that will run the server. Do not skip ahead—later steps assume earlier ones are done.

### Step 1 — Choose how Caddy runs

Pick one mode and use it in **Step 4** (`CADDY_STYLE` in `.env`).

| Mode | Best for | Who publishes port **3010** | Deploy script |
| --- | --- | --- | --- |
| **STANDALONE** (default) | New install, Windows WSL, Raspberry Pi, single repo | **This repo** (bundled `nutrition-caddy`) | `./standalone-deploy.sh` |
| **EXTERNAL** | Homelab with sibling `infrastructure/` | **Shared** Caddy on `media-network` | `./external-deploy.sh` |

`./deploy.sh` reads `CADDY_STYLE` and calls the matching script. On **Windows**, run all shell commands in **WSL Ubuntu**, not PowerShell.

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
| `PUBLIC_URL` | `http://100.x.x.x:3010` | Kiosk links in Settings (Tailscale IP or later HTTPS URL) |

Optional later: `USDA_API_KEY`, `VAPID_*` (Web Push). See [.env.example](./.env.example).

Optional deploy hints (not read by the app container):

```bash
mkdir -p local
cp local.example/deploy.env.example local/deploy.env
# set REMOTE_BASE_URL to the same URL you use on phones
```

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

You can run `./standalone-deploy.sh` or `./external-deploy.sh` directly; they accept the same flags as `./deploy.sh`.

---

### Step 6 — Verify the server

On the **server**:

```bash
curl -s http://localhost:3010/api/health
```

Expect JSON with `"ok": true` (or setup prompt fields on first boot).

From a **phone** on the same Tailscale network, open:

| Page | URL |
| --- | --- |
| Personal app | `http://YOUR_TAILSCALE_IP:3010` (or your `PUBLIC_URL`) |
| Family board | same host **`/family`** |

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
4. (Optional) **Settings** → create a **family / kiosk link** (requires `PUBLIC_URL`) for a wall tablet or Home Assistant iframe.

---

### Step 8 — HTTPS on Tailscale (optional; recommended for Web Push)

Do this **after** Step 6 succeeds over HTTP.

1. In [Tailscale admin → DNS](https://login.tailscale.com/admin/dns), enable **MagicDNS** and **HTTPS certificates**.  
2. On the server: `sudo tailscale serve --bg http://127.0.0.1:3010`  
3. Set **`PUBLIC_URL=https://YOUR-MACHINE.your-tailnet.ts.net`** in `.env`.  
4. Redeploy (Step 5 script again, or `./deploy.sh --skip-test --skip-git`).

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

| Script | When |
| --- | --- |
| `./standalone-deploy.sh` | `CADDY_STYLE=STANDALONE` |
| `./external-deploy.sh` | `CADDY_STYLE=EXTERNAL` |
| `./deploy.sh` | Dispatches from `.env` |

Common flags: `--help`, `--skip-test`, `--skip-git`, `-m "commit message"`, `--pull`, `--down`  
**EXTERNAL only:** `--infra` restarts sibling infrastructure Caddy.

Default pipeline (when not skipping): **`npm test` on the host** (requires Node 22+; see Step 2) → optional git commit/push → Docker build/up → health check on port **3010**. Use **`--skip-test`** when Node is not installed.

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
npm test       # server tests + web tsc → local/test-last-run.log
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
| `standalone-deploy.sh` / `external-deploy.sh` | Deploy entrypoints |
| `data/` | Database and uploads (runtime; not in git) |
