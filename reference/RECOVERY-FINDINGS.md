# Family Command Centre — Recovery Findings & Decisions

*Supersedes `handover/Family Handover.docx`, which describes a rebuilt skeleton
rather than the live app and is wrong about most architectural specifics.*

Last updated: 29 Aug 2026

---

## 1. The core problem

The code originally shipped in `apps/` is **not** the live app.

ChatGPT's own README admitted it:

> "This package is a clean local rebuild based on the Family Command Centre
> requirements. It is not a byte-for-byte export of the existing `chatgpt.site`
> source because that hosted source is not directly available from this chat."

| | Skeleton as received | Rhian's live prototype |
|---|---|---|
| Frontend | Plain Vite SPA | **React Server Components** (vite-rsc + Rolldown) |
| Styling | 103 lines of CSS | **Tailwind v4.2.1 + 132KB custom CSS** |
| App code | 269 lines JSX | ~250KB minified bundle |
| Modules | 7 | 12 |
| Backend | Express + Prisma + Postgres | Platform-hosted, no own DB |
| Auth | Shared family password | ChatGPT Sites sign-in |
| Integrations | none | Microsoft Graph, OpenAI Realtime |

ChatGPT confirmed directly (29 Aug 2026) that it has no access to the live
source, cannot produce a file manifest, and that ChatGPT Sites offers no
source-code export.

## 2. What was recovered

Extracted from the live site via the browser console → `reference/recovered/`

| File | Value |
|---|---|
| `app-custom.css` | **8,224 lines, 437 semantic class names — the complete design system, readable** |
| `app-full-pretty.css` | Same, plus the Tailwind base layer |
| `dashboard-qDUduSMX.js` | 251KB app bundle (minified, no source maps) |
| `index-BIjQOlLc.js` | 81KB app shell / router |
| `index.html` + inline scripts | RSC bootstrap payload |

**Not recovered:** component source (minified, no source maps published) and the
live data (`/api/state` returns 401 — authentication sits above the app at the
platform layer).

## 3. Design tokens (verbatim)

```css
--ink: #192452;      --muted: #69708e;    --line: #dce5f5;
--paper: #f4faff;    --white: #fff;       --navy: #5146d8;

/* per-person identity colours, threaded through the whole UI */
--rhian: #2684ff;    --danielle: #ff5f87; --lachie: #ff9f1c;
--jack: #10b9a7;     --maddie: #8a5cff;   --family: #13a9d6;

/* accents */
--sky: #35bdf4;      --sun: #ffd166;      --coral: #ff6b6b;
--mint: #30d5c8;     --purple: #7457e8;
```

## 4. API surface (the backend contract)

```
/api/state                  full app state — the data model
/api/family/items           family items CRUD
/api/assistant              "Sol" — text assistant
/api/realtime/session       voice session
/api/inputs                 the Inputs module
/api/attachments            file attachments
/api/receipts               receipt capture
/api/recipes/extract        photo -> recipe (AI vision)
/api/recipes/image          recipe imagery
/api/recipes/meal-plan      meal planning
/api/shopping/compare       supermarket price comparison
/api/microsoft/connect      Entra OAuth start
/api/microsoft/sync         Graph sync (To Do / Calendar)
/api/microsoft/disconnect   revoke
/api/system/status          health
```

All third-party calls happen **server-side**. The client only ever talks to
`/api/*` — no Graph or AI vendor hosts appear anywhere in the bundle. Clean
separation, and it means the frontend can be rebuilt independently of the
integrations.

## 5. Environment variables in the live prototype

```
Microsoft_Client_ID
Microsoft_Client_Secret
Microsoft_Tenant_ID
OPENAI_API_KEY
TOKEN_ENCRYPTION_KEY
```

**What's there:**
- An **Entra ID app registration already exists** (confidential client, specific
  tenant). A real asset: it can serve both family sign-in *and* Graph access for
  To Do / Calendar in a single OAuth flow.
- `TOKEN_ENCRYPTION_KEY` — Microsoft refresh tokens are encrypted at rest. Keep
  this pattern.

**What's conspicuously absent:**
- **No `DATABASE_URL`.** There is no database Rhian controls. State is persisted
  by ChatGPT Sites' own storage, which is why it cannot be exported.
- **No session/auth secret.** Sign-in belongs to the platform, not the app.
- **No supermarket API key.** `/api/shopping/compare` is the LLM estimating
  prices, not real retail data. The app's own copy concedes this ("sensible
  estimates where required"). Rhian should be told.

## 6. Consequences

1. The live data cannot be dumped — no database to export from. *(Confirmed a
   prototype, so this is not a blocker. Nothing needs migrating.)*
2. We bring our own datastore. The skeleton's Prisma + Postgres wiring is
   genuinely useful; that part is not wasted work.
3. We own authentication. The platform will no longer provide it.
4. **Entra sign-in should be built early, not late.** The handover puts
   "individual family logins" at step 6, after the Microsoft integration. That
   ordering is now wrong: one Microsoft OAuth flow delivers *both* per-person
   login and the Graph token needed for To Do / Calendar sync. Do them together.
5. Reproducing the look and feel is a copy job, not a guess — the real
   stylesheet is in hand.

## 7. Decisions taken

**Stack:** keep the skeleton's Vite SPA + Express + Prisma. Simpler than React
Server Components and maintainable by two people. The recovered stylesheet drops
in regardless of framework.

**AI vendor: Claude, not OpenAI.** Mapping of the five OpenAI touchpoints:

| Endpoint | On Claude |
|---|---|
| `/api/assistant` | Direct swap to the Messages API; stronger tool use |
| `/api/recipes/extract` | Direct swap to Claude vision |
| `/api/shopping/compare` | **Upgrade** — Claude's web search tool can fetch real prices instead of estimating |
| `/api/recipes/image` | No Claude image generation. Prototype used emoji placeholders anyway |
| `/api/realtime/session` | **No equivalent — needs re-architecting** |

**Voice.** Claude has no developer-facing speech-to-speech API (verified against
platform.claude.com, Aug 2026). OpenAI Realtime is one model hearing and
speaking; on Claude it becomes a pipeline: speech → text → Claude → speech.
Sol will feel less conversational. Approach:

1. **Start:** browser Web Speech API both directions. Free, no extra vendors,
   works in Chrome/Edge. The skeleton already uses it for capture.
2. **Upgrade if used:** Deepgram/AssemblyAI for STT + ElevenLabs/Cartesia for
   TTS, Claude in the middle.
3. **Rejected:** keeping OpenAI purely for voice — two AI vendors and two SDKs
   for one feature.

**Sol as an MCP agent.** Rather than hand-wiring one endpoint per capability,
give Sol tools (`add_task`, `plan_meals`, `check_calendar`, `sync_microsoft`)
and let it choose. New capability then means one new tool, not an endpoint plus
UI plumbing.

**Models:** Sonnet 5 for Sol; Haiku 4.5 for cheap high-frequency work such as
parsing quick-capture text. Opus is overkill for a family app.

**Target environment variables:**

```
DATABASE_URL              Railway Postgres reference   (new)
SESSION_SECRET            long random value            (new)
ANTHROPIC_API_KEY         replaces OPENAI_API_KEY
Microsoft_Client_ID       unchanged
Microsoft_Client_Secret   unchanged
Microsoft_Tenant_ID       unchanged
TOKEN_ENCRYPTION_KEY      unchanged
```

## 8. Open questions

- Does Rhian know the price comparison is AI estimation, not live retail pricing?
- Who owns the Entra app registration and the AI vendor account — Rhian
  personally, or Consolidare Advisory?
- Long term, does the database and hosting sit under Rhian's accounts rather
  than Duane's? Worth settling before real family data lands in Postgres.
