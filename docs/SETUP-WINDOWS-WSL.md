# Setup on Windows (WSL2 + Docker Desktop)

Use this document for **[README Setup Step 2](../README.md#step-2--install-dependencies-on-the-server-machine)** when the server is a **Windows PC**.

Then continue the **main README in order** (Steps 3–9). This guide expands Windows-only install details for Steps 2–7 and assumes **`CADDY_STYLE=STANDALONE`**. For shared homelab Caddy, use [README Step 5B](../README.md#5b--external-shared-homelab-caddy) instead of section 6 below.

**Shell scripts:** run `./deploy.sh` in **Ubuntu (WSL)**, not PowerShell (`CADDY_STYLE` in `.env` picks STANDALONE vs EXTERNAL).

**From Windows (File Explorer / cmd):** double-click or run **`deploy-from-windows.bat`** in the repo root — it calls the same script inside WSL. Example:

```cmd
deploy-from-windows.bat --skip-test --skip-git
```

Prefer cloning under **`~/Nutrition-Tracker`** in Ubuntu for Docker speed; the batch file still works if the repo lives on `C:\` (slower builds).

---

## A. Install WSL2 and Ubuntu (README Step 2)

**GUI**

1. **Settings → System → Optional features** (or “Turn Windows features on or off”).
2. Enable **Virtual Machine Platform** and **Windows Subsystem for Linux**.
3. **Microsoft Store** → install **Ubuntu** (22.04 or 24.04).
4. Launch **Ubuntu** once; create a UNIX username and password.

**CLI (PowerShell as Administrator)**

```powershell
wsl --install -d Ubuntu
```

Reboot if Windows asks you to.

---

## B. Docker Desktop (README Step 2)

1. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
2. **Settings → General** → **Use the WSL 2 based engine**.
3. **Settings → Resources → WSL Integration** → enable your **Ubuntu** distro.
4. Wait until Docker Desktop shows **Running**.

In **Ubuntu (WSL)**:

```bash
docker version
docker compose version
```

---

## B2. Node.js (optional — for deploy tests)

Docker alone is enough to **run** the app. Install Node only if you want **`./deploy.sh`** to run **`npm test`** before each build (default). Without Node, always add **`--skip-test`**.

In **Ubuntu (WSL)**:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v    # v22.x or newer
npm -v
```

Alternative: [nvm](https://github.com/nvm-sh/nvm) — `nvm install 22` after installing nvm (see [README Host Node.js](../README.md#host-nodejs-for-deploysh-tests)).

Skip tests on deploy:

```bash
./deploy.sh --skip-test --skip-git
```

---

## C. Tailscale (README Step 2 — phones reach the PC)

**GUI**

1. Install [Tailscale for Windows](https://tailscale.com/download/windows).
2. Sign in to the same tailnet as your phones.
3. Install Tailscale on each phone (App Store / Play Store).

Note the PC’s Tailscale IP from the tray icon (you will use it as **`TAILSCALE_SERVER_URL`** in `.env`).

Optional CLI in WSL: [Tailscale on Linux](https://tailscale.com/download/linux). Windows Tailscale alone is enough for most setups.

---

## D. Get the code (README Step 3)

**GitHub Desktop**

1. Install [GitHub Desktop](https://desktop.github.com/).
2. **File → Clone repository** → `Nutrition-Tracker`.
3. Prefer cloning into WSL for Docker speed: in Ubuntu, `cd ~` and clone with git (below) even if you also use Desktop.

**Ubuntu terminal**

```bash
cd ~
git clone https://github.com/raffenit/Nutrition-Tracker.git
cd Nutrition-Tracker
```

Avoid `/mnt/c/...` for the repo if you can — `~/Nutrition-Tracker` is faster for Docker builds.

---

## E. Configure `.env` (README Step 4)

```bash
cd ~/Nutrition-Tracker
cp .env.example .env
```

Edit `.env`:

| Tool | How |
| --- | --- |
| **VS Code** (recommended) | [WSL extension](https://code.visualstudio.com/docs/remote/wsl) → `code .` |
| **vim** | `vim .env` — `i` insert, `Esc` then `:wq` save |
| **nano** | `nano .env` |

Minimum:

```env
CADDY_STYLE=STANDALONE
TZ=America/Chicago
TAILSCALE_SERVER_URL=http://YOUR_TAILSCALE_IP
NUTRITION_PORT=3010
```

All config lives in **`.env` only** (no `local/deploy.env`).

---

## F. Start the stack (README Step 5A)

Ensure `.env` has `CADDY_STYLE=STANDALONE`.

**Ubuntu terminal** or **`deploy-from-windows.bat`** (same flags):

First boot (Docker only — no Node):

```bash
./deploy.sh --skip-test --skip-git
```

Later, with Node 22+ installed (section B2):

```bash
./deploy.sh --skip-git
```

With git commit on a dev machine:

```bash
./deploy.sh -m "Describe your change"
```

---

## G. Verify (README Step 6)

```bash
curl -s http://localhost:3010/api/health
```

On the PC browser: `http://localhost:3010`  
On a phone (Tailscale on): `http://YOUR_TAILSCALE_IP:3010`

Logs if needed:

```bash
docker compose -f docker-compose.yml -f docker-compose.standalone.yml logs -f
```

---

## H. First visit in the app (README Step 7)

1. **Setup** — household name, admin password.  
2. **Settings** → daily targets.  
3. **Library** / **+** on Today to log meals.  
4. Phone: Share → **Add to Home Screen**.

---

## I. HTTPS on your tailnet (README Step 8 — recommended)

Follow **[README Step 8](../README.md#step-8--https-on-your-tailnet-recommended)** in full. Short version after HTTP works:

1. [Tailscale admin → DNS](https://login.tailscale.com/admin/dns) — **MagicDNS** + **HTTPS certificates** on.  
2. `sudo tailscale serve --bg http://127.0.0.1:3010` in WSL.  
3. `.env`: `TAILSCALE_SERVER_URL=https://YOUR-PC.your-tailnet.ts.net` (no port).  
4. Redeploy (section F).

---

## J. Updates (README Step 9)

```bash
cd ~/Nutrition-Tracker
git pull
./deploy.sh --skip-git
# or, if you did not install Node (section B2):
./deploy.sh --skip-test --skip-git
```

---

## Troubleshooting

| Problem | Check |
| --- | --- |
| `docker: command not found` in WSL | Docker Desktop running; WSL integration on |
| `permission denied` on `./deploy.sh` | `chmod +x deploy.sh standalone-deploy.sh external-deploy.sh` |
| Phone cannot reach `:3010` | Tailscale on both; try PC firewall |
| Health check fails | Section G logs command |

---

## CLI-only cheat sheet

| Task | Command |
| --- | --- |
| WSL | `wsl --install -d Ubuntu` |
| Clone | `git clone https://github.com/raffenit/Nutrition-Tracker.git` |
| Deploy (no Node) | `./deploy.sh --skip-test --skip-git` or `deploy-from-windows.bat --skip-test --skip-git` |
| Deploy (with Node) | `./deploy.sh --skip-git` or `deploy-from-windows.bat --skip-git` |
| Tailscale IP | Windows tray icon |
