# Family Command Centre

A private family dashboard — calendar, tasks, chores, meals, shopping, finances —
originally prototyped by Rhian Oliver, now being rebuilt as a maintainable
open-source-stack app deployed on Railway.

## Status

Early. The app currently running here is a **skeleton** (7 modules, basic styling).
The design system recovered from Rhian's prototype is being applied module by
module. See `reference/RECOVERY-FINDINGS.md` for the full picture.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite |
| Backend | Express 5 (Node 20+) |
| Database | PostgreSQL via Prisma |
| AI | Claude (Anthropic) — assistant, vision, web search |
| Integrations | Microsoft Graph (To Do, Calendar) via Entra ID |
| Hosting | Railway (single service — Express serves the built web bundle) |

## Local development

```bash
cp .env.example .env      # then fill it in
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev               # http://localhost:5173
```

## Deployment

Railway builds with `npm run railway:build` and starts with `npm run railway:start`,
which applies committed Prisma migrations before booting. Config lives in `railway.json`.

Environment variables are set in Railway, never in the repo:

```
DATABASE_URL              Railway Postgres reference
SESSION_SECRET            long random value
ANTHROPIC_API_KEY         Claude
Microsoft_Client_ID       Entra ID app registration
Microsoft_Client_Secret
Microsoft_Tenant_ID
TOKEN_ENCRYPTION_KEY      encrypts stored Microsoft refresh tokens at rest
```

## Repository layout

```
apps/
  web/        React + Vite frontend
  server/     Express API + Prisma schema, migrations, seed
reference/
  screenshots/   14 captures of Rhian's live prototype
  recovered/     stylesheet and bundles extracted from the live prototype
  handover/      Rhian's original ChatGPT handover document
  RECOVERY-FINDINGS.md
```

`reference/` is documentation, not shipped code. Nothing in it is imported by the app.

## History

`git tag baseline-as-received` marks the folder exactly as Rhian handed it over,
before any changes.
