# Server tests

All server tests compile to `dist-test/` and run via `npm test` in this package (see `package.json`). The repo root `./deploy.sh` runs the same suite through `npm test` unless you pass `--skip-test`.

## Layout

| Path | Kind |
| --- | --- |
| `test/helpers.ts` | Ephemeral SQLite + HTTP server harness for integration tests |
| `test/integration/*.test.ts` | End-to-end API tests (`api.test.ts`, `coverage.test.ts`, …) |
| `test/unit/domain/*.test.ts` | Pure domain logic (parsers, alerts, family board shaping, trends math, etc.) |
| `test/unit/integrations/*.test.ts` | Unit tests for `src/integrations/` (SSRF rules, HTML helpers) |

Production code lives under `src/domain/`, `src/integrations/`, and routes — **not** beside `*.test.ts` files, so it is obvious what ships in the container vs what runs only on the host during deploy.

## Runner

`npm test` deletes `dist-test/`, recompiles with `tsc -p tsconfig.test.json`, then runs **every** `dist-test/**/*.test.js` file. Do not narrow the glob to a single folder — that silently skips nested paths (e.g. integrations unit tests).

## Related docs

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) — testing gates and privacy rules
- [docs/CODE-MAP.md](../../docs/CODE-MAP.md) — feature → source paths
