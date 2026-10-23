# Playbook — deploy Nutrition Tracker on Frankenstein

## Source of truth

| Layer | Path | Use for |
| --- | --- | --- |
| **Application git repo** | `Projects/Apps/Nutrition-Tracker/` | Feature fixes, tests, `docs/CODE-MAP.md` |
| **Live stack on server** | `Projects/docker-files/Nutrition-Tracker/` (SSHFS mount) | `./deploy.sh`, compose, server `.env`, `./data` volume |

Edit code in **Apps**, push to GitHub, then on the server (in the mounted tree) `git pull` and deploy. Do not rely on the mount copy for navigation docs — it may lag until pull.

## Before touching `docker-files/`

1. Read [`.devinFrankenstein/AGENTS.md`](../../../../.devinFrankenstein/AGENTS.md).
2. Confirm the mount is live and lists expected stacks (`infrastructure`, `Nutrition-Tracker`, …).
3. If the mount is empty or wrong, stop and use [`.devinFrankenstein/RUNBOOK.md`](../../../../.devinFrankenstein/RUNBOOK.md).

## Typical deploy

On Frankenstein, in `Nutrition-Tracker/` (mount path):

```bash
git pull
./deploy.sh --skip-git    # after you already pushed from dev machine
```

Optional: `--skip-test` only when you intentionally skip host tests (see repo `AGENTS.md`).

## Find code while debugging production

1. [CODE-MAP.md](../CODE-MAP.md) or [label-ocr-and-parsing.md](./label-ocr-and-parsing.md) in **Apps** repo.
2. Confirm running image matches expected commit (`docker inspect`, frontend bundle hash, server logs).
3. Local `npm run dev` ≠ Docker (EasyOCR, production build, `./data` paths).

## Workspace index

[Projects/docs/AGENT-INDEX.md](../../../../docs/AGENT-INDEX.md)
