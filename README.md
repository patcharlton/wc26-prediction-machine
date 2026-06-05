# WC2026 Prediction Machine

A self-updating web app that predicts **every match of the 2026 World Cup** and
scores itself against the betting market — with **zero manual input** once it's
live. It pulls fixtures, results and odds, re-predicts before each match, locks
and freezes each prediction ~2h before kickoff, auto-scores its own accuracy, and
expands automatically from the group stage into the knockouts.

**Machine = lime.  Market = pink.**  The headline test is outcome hit-rate vs the market.

---

## How it works

```
GitHub Actions (cron)                         Render (static)
┌─────────────────────────────┐               ┌────────────────────┐
│  main-update   (every 6h)   │   commit      │  React + Vite site │
│  lock-job      (hourly)     │   /data/*.json│  reads /data/*.json│
│  live-status   (every 15m)  │ ───────────▶  │  redeploys on push │
│  daily-housekeeping (06:00) │               └────────────────────┘
└─────────────────────────────┘
        │   ▲
   API-Football │ Anthropic (Claude + web search)
   (hard stats, │  (the prediction brain — reasons from the
    odds)       │   rubric to 1X2 + scoreline, structured JSON)
```

- **Engine** (`/engine`, TypeScript/Node): pulls data, runs predictions, scores
  results, writes JSON. Run by the cron workflows.
- **Frontend** (`/web`, React + Vite): static site, reads the JSON data files.
- **Storage** (`/data`): JSON files committed to the repo — the single source of truth.

The model **hedge**: group stage runs on `PREDICTION_MODEL_GROUP`
(`claude-sonnet-4-6`), knockouts on `PREDICTION_MODEL_KO` (`claude-opus-4-8`).
Flip either via env var without a redeploy.

---

## Project layout

```
data/                 JSON state: fixtures, predictions, results, ledger, standings, meta
engine/               TS engine + jobs + tests
  src/
    config.ts         env vars, constants, time windows
    types.ts          the shared data contract
    footballApi.ts    API-Football wrapper + daily request budgeting
    predict.ts        Anthropic prediction engine (rubric, web search, JSON parse)
    bracket.ts        official FIFA R32→Final structure + thirds resolver
    accuracy.ts       Brier, outcome/exact hits, head-to-head, ledger
    sync.ts           normalise data, populate knockouts, recompute accuracy
    predictRunner.ts  window selection + lock/freeze logic
    jobs/             the 4 cron entrypoints
    verify.ts         pre-build API-Football verification
    seedMock.ts       seed demo data for the frontend
  test/               offline tests against documented API shapes (node --test)
web/                  React + Vite frontend
.github/workflows/    4 cron workflows + 1 reusable runner
render.yaml           Render static-site blueprint
```

---

## Setup (what Patrick needs to do)

### 1. Secrets

Set these as **GitHub Actions secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `FOOTBALL_API_KEY` | API-Football key (**free tier** — 100 req/day) |
| `PREDICTION_MODEL_GROUP` | `claude-sonnet-4-6` |
| `PREDICTION_MODEL_KO` | `claude-opus-4-8` |
| `RENDER_DEPLOY_HOOK` | *(optional)* Render deploy hook URL |

> **Tip:** make the GitHub repo **public** so Actions minutes are unlimited
> (`live-status` runs every 15 min). On a private repo this can exceed the free
> 2,000 min/month. No secrets live in the code — they're all Actions secrets.

### 2. Pre-build verification (do this once the key exists)

```bash
cd engine && npm install
FOOTBALL_API_KEY=xxxx npm run verify
```

Confirms WC2026 coverage before trusting live data:
1. `/leagues?id=1&season=2026` → `coverage.odds === true`
2. `/fixtures?league=1&season=2026` → 104 fixtures
3. `/odds?fixture={a fixture}` → at least one 1X2 market

If odds are thin, it stops and tells you — **report back before going live.**

### 3. Deploy the frontend (Render)

New → **Blueprint** → point at this repo. Render reads `render.yaml`, builds
`web/`, serves `web/dist`, and auto-redeploys on every push to `main`.

### 4. Let it run

The cron workflows take over. You can also trigger any of them manually from the
**Actions** tab (`workflow_dispatch`).

---

## Local development

```bash
# Engine
cd engine
npm install
npm test            # offline tests (no keys needed)
npm run typecheck
npm run seed-mock   # write demo data into /data for the frontend

# Frontend
cd ../web
npm install
npm run dev         # http://localhost:5173 (reads the seeded /data)
```

Set `DRY_RUN=1` to run the engine jobs without calling Anthropic (emits a
market-mirroring stub prediction) — useful for testing the data pipeline cheaply.

---

## API-Football budget

Free tier = 100 requests/day. Worst-case daily usage ≈ **52**, target **< 80**:

| Job | Cadence | Requests |
|---|---|---|
| main-update | every 6h | 2 (sync) + 1 per newly-predicted fixture |
| lock-job | hourly | 1 per fixture locked; 0 when idle |
| live-status | every 15m | 1 only while a match is in a live window |
| daily-housekeeping | 06:00 | 2 |

Every call is counted against a persisted daily budget in `data/meta.json`; the
engine **refuses to exceed the soft cap (80)** to protect the free tier.
**Do not upgrade API-Football without asking.**

---

## The prediction rubric (fixed, ported from the prototype)

Every match is scored on the same seven factors so predictions stay comparable:
squad quality · recent form (last 5–6) · availability (injuries/XI) · style
matchup · venue (altitude!) · rest & scheduling · stakes & pressure.

Claude is given the hard inputs (recent results, venue, de-vigged market) and uses
**web search** for live soft inputs (injuries, likely line-ups, news), then returns
strict JSON. It is **not** handed the final probabilities — it reasons to them.

---

## Knockout bracket

`engine/src/bracket.ts` encodes the **official FIFA WC2026** knockout structure
(matches 73–104): the R32 slot definitions, each third-place slot's eligible
groups, and the R16→Final feed. Once groups resolve, knockout fixtures populate
automatically; API-Football's real team names always take precedence.

> **One known gap:** FIFA's "Annex C" — the 495-row table that maps *which 8 of 12
> groups* produced qualifying third-placed teams to specific R32 slots — is **not**
> hardcoded (it would be guesswork to reproduce by hand). Until it's dropped into
> `data/thirds-allocation.json`, thirds are assigned by a constraint-respecting
> matching that honours every slot's official eligibility. This only matters from
> **June 27** (group stage ends) and API-Football's published team names override
> it anyway. See `THIRDS_TABLE_NOTE` in `bracket.ts`.

---

## Status / acceptance

- [x] Engine: data layer, prediction engine, accuracy, bracket, jobs — typechecked & tested (26 tests)
- [x] Frontend: scoreboard, match cards, dual prob bars, reasoning, standings — builds clean
- [x] Cron workflows + commit-back + Render blueprint
- [ ] **End-to-end live run** — needs `ANTHROPIC_API_KEY` + `FOOTBALL_API_KEY` (run `npm run verify` first)

Not included by design: betting/stakes, user accounts, manual score entry, other competitions.
