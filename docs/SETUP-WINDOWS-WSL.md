# Setup on Windows (WSL2 + Docker Desktop)

Use this document for **[README Setup Step 2](../README.md#step-2--install-dependencies-on-the-server-machine)** when the server is a **Windows PC**.

Then continue the **main README in order** (Steps 3–9). This guide expands Windows-only install details for Steps 2–7 and assumes **`CADDY_STYLE=STANDALONE`**. For shared homelab Caddy, use [README Step 5B](../README.md#5b--external-shared-homelab-caddy) instead of section 6 below.

**Shell scripts:** run `./standalone-deploy.sh` in **Ubuntu (WSL)**, not PowerShell.

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

## C. Tailscale (README Step 2 — phones reach the PC)

**GUI**

1. Install [Tailscale for Windows](https://tailscale.com/download/windows).
2. Sign in to the same tailnet as your phones.
3. Install Tailscale on each phone (App Store / Play Store).

Note the PC’s Tailscale IP from the tray icon (you will use it in `.env` as `PUBLIC_URL`).

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
PUBLIC_URL=http://YOUR_TAILSCALE_IP:3010
```

Optional: `mkdir -p local && cp local.example/deploy.env.example local/deploy.env` and set `REMOTE_BASE_URL`.

---

## F. Start the stack (README Step 5A)

First boot:

```bash
./standalone-deploy.sh --skip-test --skip-git
```

Later, with tests/git:

```bash
./standalone-deploy.sh -m "Describe your change"
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

## I. HTTPS on Tailscale (README Step 8 — optional)

After HTTP works: MagicDNS + HTTPS in [Tailscale admin](https://login.tailscale.com/admin/dns), then `sudo tailscale serve --bg http://127.0.0.1:3010`, update `PUBLIC_URL` to `https://….ts.net`, redeploy (section F).

---

## J. Updates (README Step 9)

```bash
cd ~/Nutrition-Tracker
git pull
./standalone-deploy.sh --skip-git
```

---

## Troubleshooting

| Problem | Check |
| --- | --- |
| `docker: command not found` in WSL | Docker Desktop running; WSL integration on |
| `permission denied` on `./standalone-deploy.sh` | `chmod +x standalone-deploy.sh` |
| Phone cannot reach `:3010` | Tailscale on both; try PC firewall |
| Health check fails | Section G logs command |

---

## CLI-only cheat sheet

| Task | Command |
| --- | --- |
| WSL | `wsl --install -d Ubuntu` |
| Clone | `git clone https://github.com/raffenit/Nutrition-Tracker.git` |
| Deploy | `./standalone-deploy.sh --skip-test --skip-git` |
| Tailscale IP | Windows tray icon |
