// Decides which fixtures to predict and when to lock them, snapshots the market,
// and persists predictions. Used by main-update (generate in 48h window) and
// lock-job (freeze ~2h before kickoff).
import { CONFIG } from "./config.js";
import { store, upsertById } from "./store.js";
import { getOddsRaw, deriveMarketFromOdds, RequestBudgetError } from "./footballApi.js";
import { predictFixture } from "./predict.js";
import { buildPredictionInputs } from "./sync.js";
import type { Fixture, Prediction, MarketTriple } from "./types.js";

const HOUR = 3600_000;

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
async function makePrediction(
  fixture: Fixture,
  now: string,
  opts: { lock: boolean }
): Promise<Prediction> {
  const market = await pullMarket(fixture.fixtureId);
  const inputs = buildPredictionInputs(fixture, store.results());
  inputs.market = market;
  const pred = await predictFixture(inputs, now);
  if (market) pred.market = market; // ensure the frozen snapshot is the real book market
  if (opts.lock) {
    pred.locked = true;
    pred.lockedAt = now;
  }
  return pred;
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
      const pred = await makePrediction(f, now, { lock: false });
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
  return { generated };
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
      const pred = await makePrediction(f, now, { lock: true });
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
  return { locked };
}
