// Loads the engine-written JSON data files (copied into /data by copy-data.mjs).
// Cache-busted so a fresh deploy / refresh always shows current state.
import type {
  AppData, Fixture, Prediction, ResultRecord, Ledger, Standings, Meta,
} from "./types";

async function getJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${name}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export async function loadAppData(): Promise<AppData> {
  const [fixtures, predictions, results, ledger, standings, meta] = await Promise.all([
    getJson<Fixture[]>("fixtures.json", []),
    getJson<Prediction[]>("predictions.json", []),
    getJson<ResultRecord[]>("results.json", []),
    getJson<Ledger | null>("ledger.json", null),
    getJson<Standings>("standings.json", {}),
    getJson<Meta>("meta.json", {}),
  ]);

  return {
    fixtures,
    predictions: Object.fromEntries(predictions.map((p) => [p.fixtureId, p])),
    results: Object.fromEntries(results.map((r) => [r.fixtureId, r])),
    ledger: ledger && (ledger as Ledger).totals ? (ledger as Ledger) : null,
    standings,
    meta,
  };
}
