// Loads the engine-written JSON data files. In production they're fetched
// straight from the repo's main branch (visible seconds after each data commit —
// no site rebuild needed); the copy bundled by copy-data.mjs is the fallback,
// and the only source in dev so seeded local data keeps working.
import type {
  AppData, Fixture, Prediction, ResultRecord, Ledger, Standings, Meta, WinnerPrediction, Sweepstake, KnockoutGame,
} from "./types";

const RAW_BASE =
  "https://raw.githubusercontent.com/patcharlton/wc26-prediction-machine/main/data/";

async function getJson<T>(name: string, fallback: T): Promise<T> {
  const bases = import.meta.env.DEV
    ? [`${import.meta.env.BASE_URL}data/`]
    : [RAW_BASE, `${import.meta.env.BASE_URL}data/`];
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${name}?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      // try the next source
    }
  }
  return fallback;
}

export async function loadAppData(): Promise<AppData> {
  const [fixtures, predictions, results, ledger, standings, meta, winner, sweepstake, knockoutGame] = await Promise.all([
    getJson<Fixture[]>("fixtures.json", []),
    getJson<Prediction[]>("predictions.json", []),
    getJson<ResultRecord[]>("results.json", []),
    getJson<Ledger | null>("ledger.json", null),
    getJson<Standings>("standings.json", {}),
    getJson<Meta>("meta.json", {}),
    getJson<WinnerPrediction | null>("winner.json", null),
    getJson<Sweepstake | null>("sweepstake.json", null),
    getJson<KnockoutGame | null>("knockout-game.json", null),
  ]);

  return {
    fixtures,
    predictions: Object.fromEntries(predictions.map((p) => [p.fixtureId, p])),
    results: Object.fromEntries(results.map((r) => [r.fixtureId, r])),
    ledger: ledger && (ledger as Ledger).totals ? (ledger as Ledger) : null,
    standings,
    meta,
    winner: winner && (winner as WinnerPrediction).champion ? (winner as WinnerPrediction) : null,
    sweepstake: sweepstake && (sweepstake as Sweepstake).assignments ? (sweepstake as Sweepstake) : null,
    knockoutGame: knockoutGame && (knockoutGame as KnockoutGame).entries ? (knockoutGame as KnockoutGame) : null,
  };
}
