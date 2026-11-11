# Testing and typecheck standards

## Repo gate: `npm test`

From the repo root, **`npm test`** is the single pre-deploy quality gate (unless `./deploy.sh --skip-test`). It runs **`scripts/run-tests.sh`**, which must pass **all** of the following. A green server test count alone is **not** enough.

| Order | Gate | Command (effective) | What it catches |
| --- | --- | --- | --- |
| 1a | **Server typecheck (app)** | `server`: `tsc -p tsconfig.json --noEmit` | Type errors in production `server/src/` before anything runs |
| 1b | **Server typecheck (tests)** | `server`: `tsc -p tsconfig.test.json --noEmit` | Type errors in test sources and test-only imports |
| 2 | **Server tests** | `server`: compile test output + `node --test dist-test/**/*.test.js` | Regressions in domain logic, integrations, and HTTP APIs |
| 3 | **Web typecheck** | `web`: `tsc -p tsconfig.json --noEmit` | Broken React/TS, DTO drift vs API shapes |

Full transcript: **`local/test-last-run.log`**. The summary block lists **Server typecheck**, **Server tests**, and **Web typecheck** explicitly.

### Clean-code expectations

1. **Fix type errors first** — do not skip or `--skip-test` deploy to work around `tsc` failures.
2. **Both server tsconfigs** — production and test configs are checked separately; a file can compile in one and fail in the other.
3. **Web check on every change** — any `web/` or shared-type change should pass gate 3; server-only edits still run gate 3 in CI/deploy.
4. **Behavior tests** — non-trivial server behavior gets tests under `server/src/test/` (see [server/src/test/README.md](../server/src/test/README.md)); prefer layout-pattern fixtures over one-off product strings (see [AGENTS.md](../AGENTS.md)).
5. **No duplicate “check” scripts** — use `npm test` at repo root; package scripts are `server` `check` / `check:test` / `test:run` and `web` `check`.

### Related commands

| Command | Use |
| --- | --- |
| `npm test` | Full gate (typecheck + server tests) |
| `npm run check` | Alias to `npm test` at repo root |
| `npm run build` | Production build (web + server emit); does not replace `npm test` |
| `npm --prefix server run check` | Server app typecheck only |
| `npm --prefix web run check` | Web typecheck only |

HTTPS smoke runs in **`./deploy.sh`** after Docker health, not during `npm test`.

## UI changes

Interactive and async UI work should meet workspace interaction feedback rules (hover/focus/disabled, loading and outcome on buttons). No automated browser suite yet — manual check on phone-sized layout when touching controls.
