// Decides which fixtures to predict and when to lock them, snapshots the market,
// and persists predictions. Used by main-update (generate in 48h window) and
// lock-job (freeze ~2h before kickoff). Knockout fixtures additionally get an
// EV-optimised "beat the game" entry (see knockoutGame.ts), reusing the same
// market pull so no extra API requests are spent.
import { CONFIG } from "./config.js";
import { store, upsertById } from "./store.js";
import { getOddsRaw, deriveMarketFromOdds, RequestBudgetError } from "./footballApi.js";
import { predictFixture } from "./predict.js";
import { predictKnockoutEntry, upsertEntry } from "./knockoutGame.js";
import { buildPredictionInputs } from "./sync.js";
import type { Fixture, Prediction, MarketTriple } from "./types.js";

const HOUR = 3600_000;
const isKnockout = (f: Fixture) => !f.stage.startsWith("group");

function hoursUntil(kickoffIso: string, nowIso: string): number {
  return (new Date(kickoffIso).getTime() - new Date(nowIso).getTime()) / HOUR;
}

// Pull + de-vig the current 1X2 market for a fixture (1 API request). Null if thin.
async function pullMarket(fixtureId: string): Promise<MarketTriple | null> {
  try {
    const raw = await getOddsRaw(fixtureId);
    return deriveMarketFromOdds(raw);
  } catch (err) {
    if (err instanceof RequestBudgetError) throw err;
    console.warn(`[predict] odds pull failed for ${fixtureId}:`, (err as Error).message);
    return null;
  }
}

// Generate a fresh prediction for a fixture (optionally locking + freezing market).
// Returns the market so a knockout-game entry can reuse it without a second pull.
async function makePrediction(
  fixture: Fixture,
  now: string,
  opts: { lock: boolean }
): Promise<{ pred: Prediction; market: MarketTriple | null }> {
  const market = await pullMarket(fixture.fixtureId);
  const inputs = buildPredictionInputs(fixture, store.results());
  inputs.market = market;
  const pred = await predictFixture(inputs, now);
  if (market) pred.market = market; // ensure the frozen snapshot is the real book market
  if (opts.lock) {
    pred.locked = true;
    pred.lockedAt = now;
  }
  return { pred, market };
}

// Generate (and optionally lock) one knockout-game entry.
async function makeKnockoutEntry(
  fixture: Fixture,
  market: MarketTriple | null,
  now: string,
  opts: { lock: boolean }
): Promise<void> {
  const inputs = buildPredictionInputs(fixture, store.results());
  const entry = await predictKnockoutEntry(
    { fixture, market, homeForm: inputs.homeForm, awayForm: inputs.awayForm },
    now
  );
  if (opts.lock) {
    entry.locked = true;
    entry.lockedAt = now;
  }
  store.saveKnockoutGame(upsertEntry(store.knockoutGame(), entry));
  console.log(
    `[knockout-game] ${opts.lock ? "LOCKED" : "entry"} ${fixture.homeTeam} v ${fixture.awayTeam}: ` +
      `advance ${entry.pred1Team}, reg ${entry.pred2Reg.home}-${entry.pred2Reg.away}, ` +
      `ET ${entry.pred3Et.home}-${entry.pred3Et.away} (E[pts] ${entry.ev.total})`
  );
}

// Knockout-game pass — INDEPENDENT of normal predictions. Generates an entry for
// every resolved knockout fixture in the window that doesn't already have one
// (window pass), or re-predicts + locks it near kickoff (lock pass). This is what
// keeps the "beat the game" page populated regardless of the main prediction state.
async function knockoutPass(now: string, opts: { lock: boolean }): Promise<number> {
  const fixtures = store.fixtures();
  const windowH = opts.lock ? CONFIG.lockWindowHours : CONFIG.predictWindowHours;
  const have = new Set(
    (store.knockoutGame()?.entries ?? [])
      .filter((e) => (opts.lock ? e.locked : true))
      .map((e) => e.fixtureId)
  );

  const due = fixtures.filter((f) => {
    if (!isKnockout(f)) return false;
    if (opts.lock ? f.status === "finished" : f.status !== "scheduled") return false;
    if (!f.homeTeamId || !f.awayTeamId) return false; // teams not resolved yet
    const h = hoursUntil(f.kickoff, now);
    if (h < 0 || h > windowH) return false;
    return !have.has(f.fixtureId);
  });

  let count = 0;
  for (const f of due) {
    try {
      const market = await pullMarket(f.fixtureId);
      await makeKnockoutEntry(f, market, now, opts);
      count += 1;
    } catch (err) {
      if (err instanceof RequestBudgetError) {
        console.warn("[knockout-game] stopping early:", err.message);
        break;
      }
      console.error(`[knockout-game] failed for ${f.fixtureId}:`, (err as Error).message);
    }
  }
  return count;
}

// MAIN-UPDATE: predict any not-yet-locked fixture entering the 48h window that
// has no current prediction. Skips fixtures already locked or already predicted.
export async function generateWindowPredictions(now: string): Promise<{ generated: number }> {
  const fixtures = store.fixtures();
  const preds = store.predictions();
  const predById = new Map(preds.map((p) => [p.fixtureId, p]));
  let list = preds;
  let generated = 0;

  const due = fixtures.filter((f) => {
    if (f.status !== "scheduled") return false;
    const h = hoursUntil(f.kickoff, now);
    if (h < 0 || h > CONFIG.predictWindowHours) return false;
    if (!f.homeTeam || !f.awayTeam) return false;
    // Only generate when there's no prediction yet; lock-job handles re-prediction.
    return !predById.has(f.fixtureId);
  });

  for (const f of due) {
    try {
      const { pred } = await makePrediction(f, now, { lock: false });
      list = upsertById(list, pred);
      generated += 1;
      console.log(`[main-update] predicted ${f.homeTeam} vs ${f.awayTeam} (${f.stage})`);
    } catch (err) {
      if (err instanceof RequestBudgetError) {
        console.warn("[main-update] stopping early:", err.message);
        break;
      }
      console.error(`[main-update] failed to predict ${f.fixtureId}:`, (err as Error).message);
    }
  }

  if (generated) store.savePredictions(list);

  // Knockout-game entries (independent of the prediction state above).
  const koEntries = await knockoutPass(now, { lock: false });
  return { generated: generated + koEntries };
}

// LOCK-JOB: for any fixture within the lock window (≈2h) that isn't locked yet,
// re-predict with the freshest inputs, lock it, and freeze the market snapshot.
export async function lockDuePredictions(now: string): Promise<{ locked: number }> {
  const fixtures = store.fixtures();
  let list = store.predictions();
  const predById = new Map(list.map((p) => [p.fixtureId, p]));
  let locked = 0;

  const due = fixtures.filter((f) => {
    if (f.status === "finished") return false;
    const h = hoursUntil(f.kickoff, now);
    if (h < 0 || h > CONFIG.lockWindowHours) return false; // within lock window, not yet kicked off
    if (!f.homeTeam || !f.awayTeam) return false;
    const existing = predById.get(f.fixtureId);
    return !existing || !existing.locked;
  });

  for (const f of due) {
    try {
      const { pred } = await makePrediction(f, now, { lock: true });
      list = upsertById(list, pred);
      locked += 1;
      console.log(`[lock-job] LOCKED ${f.homeTeam} vs ${f.awayTeam} at ${now}`);
    } catch (err) {
      if (err instanceof RequestBudgetError) {
        console.warn("[lock-job] stopping early:", err.message);
        break;
      }
      console.error(`[lock-job] failed to lock ${f.fixtureId}:`, (err as Error).message);
    }
  }

  if (locked) store.savePredictions(list);

  // Lock (re-predict + freeze) knockout-game entries near kickoff.
  const koLocked = await knockoutPass(now, { lock: true });
  return { locked: locked + koLocked };
}
