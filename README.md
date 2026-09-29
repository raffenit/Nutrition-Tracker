# Nutrition Tracker

A household nutrition app for phones, tablets, and a Home Assistant panel. One server, separate people, and a shared food library.

The mark is a simplified protein alpha helix.

## Access

Like Folio, Caddy publishes it on the Tailscale address:

- Personal app: `http://100.100.67.105:3010`
- Family board: `http://100.100.67.105:3010/family`

An admin can create a family display link under Settings and paste it into a Home Assistant panel iframe. That board shows meals, macros, and hydration. Weight check-ins are personal and are left out of the family payload.

## Run

Start the infrastructure stack first so `media-network` exists, then:

```bash
docker compose up -d --build
```

The first visit asks for the household and the first admin. Other people are added in Settings.

Optional ingredient data: set `USDA_API_KEY` from a free [api.data.gov](https://api.data.gov/signup/) key. Packaged foods use [Open Food Facts](https://world.openfoodfacts.org/) with no key.

## Layout

- `server/` — Node API, SQLite, label and PDF reading
- `web/` — React app
- `docker-compose.yml` — joins the Frankenstein `media-network`
- `data/` — database and uploads, not committed
