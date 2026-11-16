# Testing and typecheck standards

## Two tiers

| Tier | Command | Scope | When |
| --- | --- | --- | --- |
| **Quick** | `npm run test:quick` | Typecheck (server prod + test, web) + server tests **excluding** `*localFixtures*` | After code changes; agent default |
| **Full** | `npm test` | Same typechecks + **all** `dist-test/**/*.test.js` | Deploy (`./deploy.sh`), pre-merge, or after OCR/local-fixture work |

Logs: **`local/test-last-run-quick.log`** (quick), **`local/test-last-run.log`** (full).

### What quick still includes

- **`test/integration/`** — ephemeral SQLite + HTTP (`api.test.ts`, …) — fast API contract checks.
- **`test/unit/`** — parsers, geometry synthetics, SSRF, stitch logic — not “integration vs unit” as speed split.

### What full adds

- **`*.localFixtures.test.ts`** — real photos under `local/test-images/` when present; may run `extractImageLabel` / Tesseract.
- Full-pipeline OCR in these tests goes through `extractImageLabelCached` (`server/src/test/fixtures/cachedLocalImageOcr.ts`): results are cached in `local/.ocr-test-cache/`, keyed by image bytes + a hash of all compiled production modules, so repeat runs with no source change (and tests that OCR the same photo) skip OCR. `OCR_TEST_CACHE=0` forces fresh OCR.
- Integration tests run offline: `testConfig()` sets `openFoodFactsEnabled: false`, so no network calls.

### Comprehensive (manual — not `npm test`)

Long OCR sweeps on gitignored photos. Ask before running; capture exit code + stderr.

| Command | Role |
| --- | --- |
| `npm --prefix server run ocr:local-test-images` | All JPGs in `local/test-images/`; **% ok** score per label + dark HTML under `server/diagnostics/ground-truth-compare/`. Exit **0** by default; set `GROUND_TRUTH_STRICT=1` to enforce manifest targets. |
| `localTestImagesNutrientGroundTruth.localFixtures.test.ts` | Same compare when photos exist (full `npm test`); emits score diagnostics; strict only with `GROUND_TRUTH_STRICT=1` |
| `node scripts/run-local-test-images-ocr.mjs` | Filterable manifest/photo runs |
| `node scripts/run-test-images-pipeline.mjs` | Geometry vs manifest |

Workspace: `.devin/rules/testing-tiers.md`, `.cursor/rules/testing-tiers-and-commits.mdc`.

---

## Full gate detail (`npm test`)

Runs **`scripts/run-tests.sh`**. All must pass before deploy (unless `./deploy.sh --skip-test`).

| Order | Gate | Command (effective) | What it catches |
| --- | --- | --- | --- |
| 1a | **Server typecheck (app)** | `server`: `tsc -p tsconfig.json --noEmit` | Type errors in production `server/src/` |
| 1b | **Server typecheck (tests)** | `server`: `tsc -p tsconfig.test.json --noEmit` | Type errors in test sources |
| 2 | **Server tests** | `server`: `test:run` → all `dist-test/**/*.test.js` | Full regression suite |
| 3 | **Web typecheck** | `web`: `tsc -p tsconfig.json --noEmit` | React/TS drift |

### Clean-code expectations

1. **Fix type errors first** — do not `--skip-test` deploy to work around `tsc`.
2. **Both server tsconfigs** — checked separately.
3. **Web check on every change** — quick and full gates both run web `tsc`.
4. **Behavior tests** — under `server/src/test/`; pattern fixtures over brand strings ([AGENTS.md](../AGENTS.md)).
5. **Scripts** — root `npm run test:quick` | `npm test`; server `test:run:quick` | `test:run`.

### Related commands

| Command | Use |
| --- | --- |
| `npm run test:quick` | Default after edits |
| `npm test` | Full / deploy parity |
| `npm run check` | Alias to **full** `npm test` at repo root |
| `npm run build` | Production build; does not replace tests |

HTTPS smoke runs in **`./deploy.sh`** after Docker health, not during `npm test`.

## Manual OCR debugging

See [`.devin/rules/debugging-standards.md`](../../../.devin/rules/debugging-standards.md).

When running one-off scripts: exit code + stderr + semantic counts (strips, columns, macros). Prefer log files over `tail` only.

## UI changes

Workspace interaction feedback rules apply. No automated browser suite yet — manual check on phone layout when touching controls.