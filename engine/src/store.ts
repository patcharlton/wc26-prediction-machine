// JSON file store. All tournament state lives in /data/*.json, committed to the
// repo so the static frontend can read it and GitHub Actions can diff/commit it.
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";
import type {
  Fixture,
  Prediction,
  ResultRecord,
  Ledger,
  Standings,
  Meta,
} from "./types.js";

const DATA = CONFIG.dataDir;

function file(name: string): string {
  return path.join(DATA, name);
}

function readJson<T>(name: string, fallback: T): T {
  const p = file(name);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch (err) {
    console.error(`[store] failed to parse ${name}, using fallback:`, err);
    return fallback;
  }
}

function writeJson(name: string, value: unknown): void {
  fs.mkdirSync(DATA, { recursive: true });
  // Pretty-print with a trailing newline so git diffs stay clean and reviewable.
  fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + "\n", "utf8");
}

// ---- typed accessors ----
export const store = {
  dataDir: DATA,

  fixtures: () => readJson<Fixture[]>("fixtures.json", []),
  saveFixtures: (f: Fixture[]) => writeJson("fixtures.json", f),

  predictions: () => readJson<Prediction[]>("predictions.json", []),
  savePredictions: (p: Prediction[]) => writeJson("predictions.json", p),

  results: () => readJson<ResultRecord[]>("results.json", []),
  saveResults: (r: ResultRecord[]) => writeJson("results.json", r),

  ledger: () => readJson<Ledger | null>("ledger.json", null),
  saveLedger: (l: Ledger) => writeJson("ledger.json", l),

  standings: () => readJson<Standings>("standings.json", {}),
  saveStandings: (s: Standings) => writeJson("standings.json", s),

  meta: (): Meta =>
    readJson<Meta>("meta.json", {
      lastRun: {},
      apiFootball: {
        requestsToday: 0,
        dayUtc: new Date().toISOString().slice(0, 10),
        lastResetAt: new Date().toISOString(),
      },
      tournament: {
        startsAt: CONFIG.tournamentStartsAt,
        leagueId: CONFIG.leagueId,
        season: CONFIG.season,
      },
    }),
  saveMeta: (m: Meta) => writeJson("meta.json", m),
};

export function upsertById<T extends { fixtureId: string }>(
  list: T[],
  item: T
): T[] {
  const idx = list.findIndex((x) => x.fixtureId === item.fixtureId);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}
