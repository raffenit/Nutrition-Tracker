# Server tests

All server tests compile to `dist-test/` and run via the repo root **`npm test`** gate (see `package.json` scripts `check`, `check:test`, `test:run`, `test`). The root runner typechecks **production and test** tsconfigs before `node --test`. `./deploy.sh` uses the same gate unless `--skip-test`. Standards: [docs/testing-standards.md](../../docs/testing-standards.md).

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
| `npm run test:run` | Emit `dist-test/`, run **every** `dist-test/**/*.test.js` |
| `npm test` | All three in order |

Do not narrow the test glob to a single folder — that silently skips nested paths (e.g. integrations unit tests).

## Related docs

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) — testing gates and privacy rules
- [docs/CODE-MAP.md](../../docs/CODE-MAP.md) — feature → source paths
