# Windows / WSL troubleshooting

For setup order, see [SETUP-WINDOWS-WSL.md](./SETUP-WINDOWS-WSL.md). Deploy: **`./deploy.sh`** in Ubuntu (WSL preflight runs automatically), or **`deploy-from-windows.bat`** (same script via WSL).

---

## 1. Unix line endings (LF)

**Requirement:** Shell scripts (`.sh`) and `.env` must use **LF**, not CRLF. CRLF causes `$'\r': command not found`, `bad interpreter`, or subtle `source .env` failures.

**Repository:**

- Root **`.gitattributes`** sets `*.sh text eol=lf` and `.env.example text eol=lf`.
- **`.editorconfig`** — LF for `*.sh` and typical source; CRLF only for `*.bat`.

**On WSL after clone:**

```bash
git config core.autocrlf false
git pull   # get .gitattributes from main
```

If scripts were already saved with CRLF:

```bash
sed -i 's/\r$//' deploy.sh *-deploy.sh scripts/*.sh
chmod +x deploy.sh *-deploy.sh scripts/*.sh
```

**`./deploy.sh`** (and **`deploy-from-windows.bat`**, which calls it) automatically runs **`scripts/wsl-preflight.sh`** when started under WSL. Set **`SKIP_WSL_PREFLIGHT=1`** to bypass.

---

## 2. `.env` syntax

**Requirement:** No spaces around `=` — use `CADDY_STYLE=STANDALONE`, not `CADDY_STYLE = STANDALONE`. Bash `source .env` treats spaced forms as invalid assignments.

Copy from [`.env.example`](../.env.example). Save `.env` as **UTF-8 LF** (VS Code status bar: LF).

Preflight warns if it detects `KEY =value` patterns.

---

## 3. PowerShell execution policy (optional native Windows tools)

This project’s **deploy and tests are intended to run in WSL**, not PowerShell. If you add or run **`.ps1`** wrappers locally (e.g. calling npm on Windows):

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Run PowerShell **as Administrator** only if your org requires a machine-wide policy change.

---

## 4. Native C++ build tools (Windows-native `npm install` only)

**Requirement:** Packages like **`better-sqlite3`** compile native code. If you run **`npm install`** on **Windows** (outside WSL), you need MSVC build tools.

**Action:** Install [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **“Desktop development with C++”** workload. Avoid legacy **`windows-build-tools`** on modern Node.

**Recommended:** Install **Node 22+ inside WSL** (nvm or NodeSource — [SETUP-WINDOWS-WSL.md § B2](./SETUP-WINDOWS-WSL.md#b2-nodejs-optional--for-deploy-tests)) and run **`npm test`** / deploy there so the Linux container path matches the host test path.

---

## 5. WSL-native paths (avoid `/mnt/c/...`)

**Requirement:** Node/npm on **Windows** resolving paths under **`/mnt/c/...`** from WSL leads to **`ENOENT`**, slow I/O, and broken native modules.

**Action:**

- Clone to **`~/Nutrition-Tracker`** in Ubuntu.
- Install **Node and npm inside WSL**, not only on Windows.
- Run **`./deploy.sh`** or **`deploy-from-windows.bat`** — the batch file maps the repo with `wslpath` but still warns when the tree lives under `/mnt/`.

---

## 6. Docker Desktop + WSL integration and permissions

**Requirement:** `docker` / `docker compose` inside WSL must talk to Docker Desktop’s daemon.

**Action:**

1. Docker Desktop → **Settings → General** → **Use the WSL 2 based engine**.
2. **Settings → Resources → WSL Integration** → enable your **Ubuntu** distro.
3. In WSL:

```bash
sudo usermod -aG docker "$USER"
newgrp docker
docker info
docker compose version
```

**`wsl-preflight.sh`** fails fast if `docker info` does not succeed.

---

## Batch wrapper behavior (`deploy-from-windows.bat`)

| Step | Behavior |
| --- | --- |
| WSL detection | Exits if `wsl.exe` missing |
| Path | Maps repo to a WSL path with `wslpath -u`; runs **`bash -ic`** so login profiles (e.g. nvm) load |
| Deploy | **`./deploy.sh`** — includes WSL preflight, then standalone/external deploy |

---

## Quick symptom table

| Symptom | Likely fix |
| --- | --- |
| `$'\r'` / `bad interpreter` | LF on `.sh`; preflight or `sed`; `.gitattributes` + `core.autocrlf false` |
| `.env: line N: syntax error` | Remove spaces around `=`; LF line endings |
| `docker: permission denied` | Docker group + `newgrp docker`; Desktop running |
| `docker: command not found` | WSL integration for Ubuntu |
| `ENOENT` during npm on WSL | Move repo to `~`; use WSL Node, not `/mnt/c` + Windows Node |
| `npm test` / native module build fail on Windows | Use WSL Node, or install VS C++ Build Tools |
| Batch opens then errors | Read WSL stderr; run `./scripts/wsl-preflight.sh` manually in Ubuntu |

---

## Related

- [SETUP-WINDOWS-WSL.md](./SETUP-WINDOWS-WSL.md) — install and first deploy
- [playbooks/server-deploy-frankenstein.md](./playbooks/server-deploy-frankenstein.md) — Linux server deploy (not Windows)
