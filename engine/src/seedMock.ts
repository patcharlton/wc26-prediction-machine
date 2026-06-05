// Seed realistic-shaped MOCK data so the frontend can be built and demoed before
// API keys / cron are live. The real cron jobs overwrite all of this with live
// data. Run: cd engine && npm run seed-mock
import { store } from "./store.js";
import { recomputeAccuracy } from "./sync.js";
import type { Fixture, Prediction, Standings, Stage, Matchday, ProbTriple } from "./types.js";

const NOTE = "MOCK DATA — replaced by live data on the first cron run.";

interface Team { name: string; id: number; }
const groups: Record<string, Team[]> = {
  A: [
    { name: "Mexico", id: 16 }, { name: "Croatia", id: 3 },
    { name: "Ecuador", id: 2382 }, { name: "South Africa", id: 1530 },
  ],
  B: [
    { name: "Canada", id: 1530 + 1 }, { name: "Belgium", id: 1 },
    { name: "Morocco", id: 31 }, { name: "Uzbekistan", id: 1568 },
  ],
};

const VENUES: Record<string, { name: string; city: string; country: string }> = {
  A: { name: "Estadio Azteca", city: "Mexico City", country: "Mexico" },
  B: { name: "BMO Field", city: "Toronto", country: "Canada" },
};

let fid = 1000;
function fixtureId(): string { return String(fid++); }

// round-robin schedule for a group of 4 across 3 matchdays
const PAIRINGS: [number, number][][] = [
  [[0, 1], [2, 3]], // MD1
  [[0, 2], [3, 1]], // MD2
  [[3, 0], [1, 2]], // MD3
];

function mkProbs(h: number, d: number, a: number): ProbTriple {
  const s = h + d + a;
  return { homeWin: r3(h / s), draw: r3(d / s), awayWin: r3(a / s) };
}
function r3(n: number) { return Math.round(n * 1000) / 1000; }

const fixtures: Fixture[] = [];
const predictions: Prediction[] = [];
const standings: Standings = {};

const baseDate: Record<Matchday, string> = {
  MD1: "2026-06-11", MD2: "2026-06-16", MD3: "2026-06-21",
};

for (const [letter, teams] of Object.entries(groups)) {
  const stage = ("group" + letter) as Stage;
  standings["group" + letter] = teams.map((t, i) => ({
    teamId: t.id, team: t.name, rank: i + 1,
    played: 2, win: 2 - i > 0 ? 2 - i : 0, draw: i === 1 ? 1 : 0,
    lose: i >= 2 ? i - 1 : 0,
    goalsFor: 5 - i, goalsAgainst: i + 1, goalDiff: 5 - i - (i + 1), points: Math.max(0, 6 - i * 2),
  }));

  PAIRINGS.forEach((md, mdIdx) => {
    const matchday = (["MD1", "MD2", "MD3"][mdIdx]) as Matchday;
    md.forEach(([hi, ai], gi) => {
      const home = teams[hi]!, away = teams[ai]!;
      const id = fixtureId();
      const hour = 18 + gi * 3;
      const kickoff = `${baseDate[matchday]}T${String(hour).padStart(2, "0")}:00:00.000Z`;
      // MD1 finished, MD2 first match live + rest scheduled, MD3 scheduled
      let status: Fixture["status"] = "scheduled";
      let homeScore: number | null = null, awayScore: number | null = null, elapsed: number | null = null;
      if (matchday === "MD1") { status = "finished"; homeScore = 2 - gi; awayScore = gi; }
      else if (matchday === "MD2" && gi === 0) { status = "live"; homeScore = 1; awayScore = 0; elapsed = 63; }

      fixtures.push({
        fixtureId: id, stage, matchday, kickoff, status,
        homeTeam: home.name, awayTeam: away.name, homeTeamId: home.id, awayTeamId: away.id,
        homeScore, awayScore, elapsed, venue: VENUES[letter]!,
      });

      // a prediction for every fixture; finished + live ones are locked
      const locked = status !== "scheduled";
      const probs = mkProbs(0.45 + gi * 0.05, 0.27, 0.28 - gi * 0.03);
      predictions.push({
        fixtureId: id,
        probs,
        scoreline: { home: 2, away: gi },
        confidence: gi === 0 ? "High" : gi === 1 ? "Medium" : "Medium-Low",
        reasoning:
          `${home.name} carry the better recent form and squad depth, and the venue suits them. ` +
          `${away.name} can frustrate but should fall short over 90 minutes. ${NOTE}`,
        market: { ...mkProbs(0.42, 0.29, 0.29), source: "book" },
        lockedAt: locked ? kickoff.replace("T", "T").slice(0, 19) + "Z" : null,
        modelVersion: "claude-sonnet-4-6",
        generatedAt: "2026-06-10T00:00:00.000Z",
        locked,
        webSearchUsed: true,
      });
    });
  });
}

// a couple of R32 placeholder fixtures so the knockout UI has something to show
fixtures.push({
  fixtureId: fixtureId(), stage: "R32", matchday: null,
  kickoff: "2026-06-28T20:00:00.000Z", status: "scheduled",
  homeTeam: "Winner Group A", awayTeam: "Runner-up Group B",
  homeTeamId: null, awayTeamId: null, homeScore: null, awayScore: null, elapsed: null,
  homeSlot: "RU:A", awaySlot: "RU:B",
  venue: { name: "MetLife Stadium", city: "New York", country: "USA" },
});

store.saveFixtures(fixtures.sort((a, b) => a.kickoff.localeCompare(b.kickoff)));
store.savePredictions(predictions);
store.saveStandings(standings);
const meta = store.meta();
meta.notes = NOTE;
store.saveMeta(meta);
recomputeAccuracy("2026-06-16T12:00:00.000Z");

console.log(`Seeded ${fixtures.length} mock fixtures, ${predictions.length} predictions, ${Object.keys(standings).length} groups.`);
console.log("Wrote data/{fixtures,predictions,results,ledger,standings,meta}.json");
