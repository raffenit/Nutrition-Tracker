# Nutrition Tracker

Server code lives in `server/`. The web app lives in `web/`. Household data stays in `data/` and is not committed.

Weight records are personal. Family and kiosk responses go through `server/src/domain/familyView.ts` and must not include them.

Do not restart the Frankenstein Caddy stack or this container until the pending change has been reviewed.
