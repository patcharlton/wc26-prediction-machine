// Shared engine core used by all four cron jobs:
//  - pull + normalise fixtures and standings from API-Football
//  - populate knockout fixtures from the encoded FIFA bracket once groups resolve
//  - derive recent-form context for the prediction engine (no extra API calls)
//  - recompute the accuracy ledger from finished results
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";
import { store } from "./store.js";
import {
  getAllFixtures,
  getStandings,
  normalizeStatus,
  parseMatchday,
  isGroupStageRound,
  type RawFixture,
  type RawStandingsGroup,
} from "./footballApi.js";
import {
  ALL_KO,
  resolveSlots,
  resolveTeam,
  slotLabel,
  type SlotMatch,
} from "./bracket.js";
import {
  scoreFixture,
  buildLedger,
  finalizeLedgerMatchdays,
  outcomeFromScore,
} from "./accuracy.js";
import { recomputeKnockoutGame } from "./knockoutGame.js";
import type {
  Fixture,
  Stage,
  Standings,
  StandingRow,
  ResultRecord,
} from "./types.js";
import type { FormLine, PredictionInputs } from "./predict.js";

// ---------- standings ----------
function groupLetterFromName(name: string): string | null {
  const m = name.match(/group\s+([a-l])/i);
  return m ? m[1]!.toUpperCase() : null;
}

export function normalizeStandings(raw: RawStandingsGroup[]): {
  standings: Standings;
  teamGroup: Map<number, string>;
} {
  const standings: Standings = {};
  const teamGroup = new Map<number, string>();
  const groups = raw[0]?.league.standings ?? [];
  for (const group of groups) {
    for (const row of group) {
      const letter = groupLetterFromName(row.group);
      if (!letter) continue;
      teamGroup.set(row.team.id, letter);
      const key = "group" + letter;
      (standings[key] ??= []).push({
        teamId: row.team.id,
        team: row.team.name,
        rank: row.rank,
        played: row.all.played,
        win: row.all.win,
        draw: row.all.draw,
        lose: row.all.lose,
        goalsFor: row.all.goals.for,
        goalsAgainst: row.all.goals.against,
        goalDiff: row.goalsDiff,
        points: row.points,
      } satisfies StandingRow);
    }
  }
  for (const key of Object.keys(standings)) {
    standings[key]!.sort((a, b) => a.rank - b.rank);
  }
  return { standings, teamGroup };
}

// ---------- fixtures ----------
function mapKnockoutRound(round: string): Stage | null {
  if (/round of 32/i.test(round)) return "R32";
  if (/round of 16/i.test(round)) return "R16";
  if (/quarter/i.test(round)) return "QF";
  if (/semi/i.test(round)) return "SF";
  if (/final/i.test(round)) return "Final"; // covers Final + 3rd place play-off
  return null;
}

export function normalizeFixture(rf: RawFixture, teamGroup: Map<number, string>): Fixture {
  const status = normalizeStatus(rf.fixture.status.short);
  const round = rf.league.round;
  let stage: Stage;
  let matchday: Fixture["matchday"] = null;

  const homeGroup = teamGroup.get(rf.teams.home.id);
  const awayGroup = teamGroup.get(rf.teams.away.id);
  const group = homeGroup ?? awayGroup;

  let isGroup = false;
  if (isGroupStageRound(round) && group) {
    stage = ("group" + group) as Stage;
    matchday = parseMatchday(round);
    isGroup = true;
  } else {
    stage = mapKnockoutRound(round) ?? "R32";
  }

  return {
    fixtureId: String(rf.fixture.id),
    stage,
    matchday,
    kickoff: new Date(rf.fixture.date).toISOString(),
    status,
    homeTeam: rf.teams.home.name,
    awayTeam: rf.teams.away.name,
    homeTeamId: rf.teams.home.id ?? null,
    awayTeamId: rf.teams.away.id ?? null,
    homeScore: rf.goals.home,
    awayScore: rf.goals.away,
    elapsed: rf.fixture.status.elapsed,
    venue: {
      name: rf.fixture.venue.name,
      city: rf.fixture.venue.city,
      country: null,
    },
    koScore: isGroup ? null : deriveKoScore(rf),
  };
}

// Build the knockout regulation/ET/penalty breakdown from API-Football's score
// object. The 120' score = fulltime + extratime goals. Returns null if unplayed.
function deriveKoScore(rf: RawFixture): Fixture["koScore"] {
  if (normalizeStatus(rf.fixture.status.short) !== "finished") return null;
  const s = rf.score ?? {};
  const ft = s.fulltime;
  const etGoals = s.extratime;
  const pens = s.penalty;
  const short = rf.fixture.status.short;

  const rt =
    ft && ft.home != null && ft.away != null ? { home: ft.home, away: ft.away } : null;
  const etPlayed =
    short === "AET" || short === "PEN" || (etGoals != null && (etGoals.home != null || etGoals.away != null));
  const et =
    etPlayed && rt
      ? { home: rt.home + (etGoals?.home ?? 0), away: rt.away + (etGoals?.away ?? 0) }
      : null;
  const pensScore =
    pens && pens.home != null && pens.away != null ? { home: pens.home, away: pens.away } : null;

  // Who advanced: by shootout if there was one, else by the final (120'/90') goals.
  let advanced: "home" | "away" | null = null;
  if (pensScore) advanced = pensScore.home > pensScore.away ? "home" : "away";
  else {
    const fh = rf.goals.home, fa = rf.goals.away;
    if (fh != null && fa != null && fh !== fa) advanced = fh > fa ? "home" : "away";
  }
  return { rt, et, pens: pensScore, advanced };
}

// Names API-Football uses before a knockout slot resolves.
function isPlaceholderName(name: string): boolean {
  return !name || /winner|runner|loser|^3rd|tbd|to be determined|\//i.test(name);
}

// Attach bracket slot tokens to knockout fixtures and, where API-Football hasn't
// resolved the real teams yet, fill in resolved bracket teams / slot labels.
export function populateKnockouts(fixtures: Fixture[], standings: Standings): Fixture[] {
  const ko = fixtures.filter((f) => !f.stage.startsWith("group"));
  if (ko.length === 0) return fixtures;

  // Winners/losers of finished knockout matches, keyed by our bracket match number.
  // We map API-Football KO fixtures to bracket match numbers by (stage, kickoff order).
  const stageOrder: Stage[] = ["R32", "R16", "QF", "SF", "Final"];
  const byMatchNum = new Map<string, number>(); // fixtureId -> bracket match number
  for (const stage of stageOrder) {
    const slots = ALL_KO.filter((s) => s.stage === stage).sort((a, b) => a.match - b.match);
    const fxs = ko
      .filter((f) => f.stage === stage)
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.fixtureId.localeCompare(b.fixtureId));
    fxs.forEach((f, i) => {
      if (slots[i]) byMatchNum.set(f.fixtureId, slots[i]!.match);
    });
  }

  // Determine knockout match results we already know (from results store).
  const results = store.results();
  const resultByFixture = new Map(results.map((r) => [r.fixtureId, r]));
  const winnersByMatch: Record<number, { winner: string; loser: string }> = {};
  for (const [fixtureId, matchNum] of byMatchNum) {
    const r = resultByFixture.get(fixtureId);
    if (r && r.status === "finished" && r.actualOutcome) {
      const homeWon = r.actualOutcome === "homeWin";
      winnersByMatch[matchNum] = homeWon
        ? { winner: r.homeTeam, loser: r.awayTeam }
        : { winner: r.awayTeam, loser: r.homeTeam };
    }
  }

  const resolved = resolveSlots(standings, winnersByMatch, loadAnnexC());
  const slotByMatch = new Map(ALL_KO.map((s) => [s.match, s]));

  return fixtures.map((f) => {
    const matchNum = byMatchNum.get(f.fixtureId);
    if (matchNum == null) return f;
    const slot = slotByMatch.get(matchNum) as SlotMatch | undefined;
    if (!slot) return f;
    const next: Fixture = { ...f, homeSlot: slot.home, awaySlot: slot.away };
    // API-Football's real team names win; otherwise show resolved bracket team or label.
    if (isPlaceholderName(f.homeTeam)) next.homeTeam = resolveTeam(slot.home, resolved);
    if (isPlaceholderName(f.awayTeam)) next.awayTeam = resolveTeam(slot.away, resolved);
    return next;
  });
}

function loadAnnexC(): Record<string, Record<string, string>> | null {
  // Optional FIFA Annex C third-place allocation table. See bracket.ts THIRDS_TABLE_NOTE.
  // Lives at data/thirds-allocation.json if the official table is dropped in.
  try {
    const p = path.join(CONFIG.dataDir, "thirds-allocation.json");
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// Pull fixtures + standings, normalise, populate knockouts, persist. 2 API requests.
export async function syncFixturesAndStandings(): Promise<{
  fixtures: Fixture[];
  standings: Standings;
}> {
  const [rawStandings, rawFixtures] = await Promise.all([
    safeStandings(),
    getAllFixtures(),
  ]);
  const { standings, teamGroup } = normalizeStandings(rawStandings);
  let fixtures = rawFixtures.map((rf) => normalizeFixture(rf, teamGroup));
  fixtures = populateKnockouts(fixtures, standings);
  fixtures.sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  store.saveFixtures(fixtures);
  if (Object.keys(standings).length) store.saveStandings(standings);
  return { fixtures, standings };
}

async function safeStandings() {
  try {
    return await getStandings();
  } catch (err) {
    console.warn("[sync] standings unavailable, continuing:", (err as Error).message);
    return [] as Awaited<ReturnType<typeof getStandings>>;
  }
}

// ---------- recent form (from our own finished results — no API calls) ----------
export function buildForm(team: string, beforeIso: string, results: ResultRecord[]): FormLine[] {
  return results
    .filter(
      (r) =>
        r.status === "finished" &&
        r.actualScore.home != null &&
        r.kickoff < beforeIso &&
        (r.homeTeam === team || r.awayTeam === team)
    )
    .sort((a, b) => b.kickoff.localeCompare(a.kickoff))
    .slice(0, 6)
    .map((r) => {
      const isHome = r.homeTeam === team;
      const gf = isHome ? r.actualScore.home! : r.actualScore.away!;
      const ga = isHome ? r.actualScore.away! : r.actualScore.home!;
      const wdl = gf > ga ? "W" : gf < ga ? "L" : "D";
      const opponent = isHome ? r.awayTeam : r.homeTeam;
      return {
        date: r.kickoff.slice(0, 10),
        opponent,
        result: `${gf}-${ga} ${wdl} (${isHome ? "home" : "away"})`,
      } satisfies FormLine;
    });
}

export function buildPredictionInputs(fixture: Fixture, results: ResultRecord[]): PredictionInputs {
  // The frozen market is carried on any existing prediction's market snapshot;
  // callers pass the freshest market in. Here we only assemble form + venue.
  return {
    fixture,
    market: null,
    homeForm: buildForm(fixture.homeTeam, fixture.kickoff, results),
    awayForm: buildForm(fixture.awayTeam, fixture.kickoff, results),
  };
}

// ---------- accuracy recompute ----------
export function recomputeAccuracy(now: string): { results: ResultRecord[]; ledgerUpdated: boolean } {
  const fixtures = store.fixtures();
  const predictions = new Map(store.predictions().map((p) => [p.fixtureId, p]));
  const existing = new Map(store.results().map((r) => [r.fixtureId, r]));

  const results: ResultRecord[] = [];
  for (const f of fixtures) {
    const pred = predictions.get(f.fixtureId);
    if (f.status === "finished" && f.homeScore != null && f.awayScore != null) {
      const prev = existing.get(f.fixtureId);
      // Keep the original resolvedAt if we already scored it.
      const rec = scoreFixture(f, pred, f.homeScore, f.awayScore, prev?.resolvedAt ?? now);
      results.push(rec);
    } else {
      results.push({
        fixtureId: f.fixtureId,
        status: f.status,
        kickoff: f.kickoff,
        stage: f.stage,
        homeTeam: f.homeTeam,
        awayTeam: f.awayTeam,
        actualScore: { home: null, away: null },
        actualOutcome: null,
        machineOutcomeHit: null,
        marketOutcomeHit: null,
        exactScoreHit: null,
        machineBrierScore: null,
        marketBrierScore: null,
        resolvedAt: null,
      });
    }
  }
  store.saveResults(results);

  let ledger = buildLedger(results, now);
  const mdByFixture = new Map(fixtures.map((f) => [f.fixtureId, f.matchday]));
  ledger = finalizeLedgerMatchdays(ledger, results, mdByFixture);
  store.saveLedger(ledger);

  // Refresh the knockout-game self-scoring (no-op until knockout entries exist).
  recomputeKnockoutGame(now);
  return { results, ledgerUpdated: true };
}

// ---------- render redeploy ----------
export async function triggerRenderDeploy(): Promise<void> {
  if (!CONFIG.renderDeployHook) return;
  try {
    await fetch(CONFIG.renderDeployHook, { method: "POST" });
    console.log("[render] deploy hook triggered.");
  } catch (err) {
    console.warn("[render] deploy hook failed:", (err as Error).message);
  }
}

// re-export for jobs
export { outcomeFromScore, slotLabel };
