# Server tests

Server tests compile to `dist-test/`. Repo root **`npm run test:quick`** (default after edits) or **`npm test`** (full, deploy). The root runner typechecks **production and test** tsconfigs before `node --test`. `./deploy.sh` uses **full** `npm test` unless `--skip-test`. Standards: [docs/testing-standards.md](../../docs/testing-standards.md).

## Layout

| Path | Kind |
| --- | --- |
| `test/helpers.ts` | Ephemeral SQLite + HTTP server harness for integration tests |
| `test/integration/*.test.ts` | End-to-end API tests (`api.test.ts`, `coverage.test.ts`, …) |
| `test/unit/domain/*.test.ts` | Pure domain logic (parsers, alerts, family board shaping, trends math, etc.) |
| `test/unit/integrations/*.test.ts` | Unit tests for `src/integrations/` (SSRF rules, HTML helpers) |

Production code lives under `src/domain/`, `src/integrations/`, and routes — **not** beside `*.test.ts` files, so it is obvious what ships in the container vs what runs only on the host during deploy.

## Runner

| Script | Purpose |
| --- | --- |
| `npm run check` | Production `server/src` typecheck (`--noEmit`) |
| `npm run check:test` | Test sources typecheck (`--noEmit`) |
| `npm run test:run:quick` | Emit `dist-test/`, run all tests **except** `*.localFixtures.test.js` |
| `npm run test:run` | Emit `dist-test/`, run **every** `dist-test/**/*.test.js` |
| `npm test` | All three in order (server package) |

Quick tier excludes `*localFixtures*` only — not whole folders — so nested unit/integration paths still run.

Local fixture sources: `*localFixtures.test.ts` (gitignored photos under `local/test-images/`).

## Related docs

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) — testing gates and privacy rules
- [docs/CODE-MAP.md](../../docs/CODE-MAP.md) — feature → source paths
