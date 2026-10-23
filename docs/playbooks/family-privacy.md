# Playbook — family board and privacy

## Invariant

**Weight data is personal.** Family and kiosk responses must never include weight entries, prefs, or reminders.

## Symptom → where to look

| Concern | File | Symbols |
| --- | --- | --- |
| Shape family JSON | `server/src/domain/familyView.ts` | `toFamilyBoard`, `assertFamilyBoardIsPublic` |
| Dashboard vs family routes | `server/src/routes/boardRoutes.ts` | family handler |
| Kiosk session | `server/src/http/access.ts`, auth routes | kiosk kind |
| Schema comments | `server/src/db/database.ts` | weight_* tables |

## Tests (required before changing family APIs)

| File | What |
| --- | --- |
| `server/src/test/unit/domain/familyView.test.ts` | `assertFamilyBoardIsPublic` |
| `server/src/test/integration/api.test.ts` | cookie `GET /api/family` must not expose weight |

Run: repo root `npm test`.

## Maintenance

Any new field on family/kiosk payloads → extend `assertFamilyBoardIsPublic` and integration checks. Document in [ARCHITECTURE.md](../ARCHITECTURE.md) privacy section if the rule changes.
