// Client-side sweepstake scoring. Computes the leaderboard from results + fixtures,
// so it auto-updates whenever the engine commits new results (no engine changes).
import type {
  Sweepstake, ResultRecord, Fixture,
} from "./types";

export type TeamStatus = "champion" | "eliminated" | "active" | "pending";

export interface TeamStat {
  name: string;
  group: string;
  played: number;
  w: number;
  d: number;
  l: number;
  goalsFor: number;
  matchPoints: number;
  bonusPoints: number;
  points: number;
  status: TeamStatus;
}

export interface SweepRow {
  person: string;
  points: number;
  goalsFor: number;
  teamsAlive: number;
  teams: TeamStat[];
}

export interface SweepResult {
  rows: SweepRow[];
  champion: string | null; // actual champion once the final is decided
  championOwner: string | null;
  started: boolean; // true once any match has finished
}

const KO_STAGES = ["R32", "R16", "QF", "SF", "Final"] as const;

// The API feed and the draw sometimes spell the same nation differently
// (e.g. "Czechia" vs "Czech Republic"). Scoring matches teams by name, so an
// unnormalised mismatch silently zeroes a team forever. Normalise both sides:
// lowercase, strip accents/punctuation, and fold known aliases to one key.
const NAME_ALIASES: Record<string, string> = {
  czechia: "czech republic",
  "korea republic": "south korea",
  "republic of korea": "south korea",
  "ir iran": "iran",
  "iran islamic republic": "iran",
  "united states": "usa",
  "united states of america": "usa",
  "usmnt": "usa",
  "cote divoire": "ivory coast",
  "turkiye": "turkiye",
  turkey: "turkiye",
  "dr congo": "congo dr",
  "congo dr": "congo dr",
  "cape verde": "cape verde islands",
  "bosnia and herzegovina": "bosnia & herzegovina",
};

function norm(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9& ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return NAME_ALIASES[base] ?? base;
}

function sameTeam(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

function ownerOf(sweep: Sweepstake, team: string): string | null {
  for (const a of sweep.assignments) if (a.teams.some((t) => sameTeam(t.name, team))) return a.person;
  return null;
}

// The actual championship match = the latest-kickoff fixture in the "Final" stage
// (later than the 3rd-place play-off which shares the stage).
function findChampion(results: Record<string, ResultRecord>, fixtures: Fixture[]): string | null {
  const finals = fixtures
    .filter((f) => f.stage === "Final")
    .sort((a, b) => b.kickoff.localeCompare(a.kickoff));
  const final = finals[0];
  if (!final) return null;
  const r = results[final.fixtureId];
  if (!r || r.status !== "finished" || !r.actualOutcome) return null;
  return r.actualOutcome === "homeWin" ? r.homeTeam : r.awayTeam;
}

export function computeSweepstake(
  sweep: Sweepstake,
  resultsArr: ResultRecord[],
  fixtures: Fixture[]
): SweepResult {
  const results: Record<string, ResultRecord> = Object.fromEntries(resultsArr.map((r) => [r.fixtureId, r]));
  const finished = resultsArr.filter((r) => r.status === "finished" && r.actualOutcome);

  // Teams that reached each knockout stage (appear in a fixture of that stage).
  // Stored normalised so lookups are spelling-agnostic.
  const reached: Record<string, Set<string>> = {};
  for (const s of KO_STAGES) reached[s] = new Set();
  for (const f of fixtures) {
    if ((KO_STAGES as readonly string[]).includes(f.stage)) {
      if (f.homeTeamId) reached[f.stage]!.add(norm(f.homeTeam));
      if (f.awayTeamId) reached[f.stage]!.add(norm(f.awayTeam));
    }
  }

  // ---- Who's been knocked out ----
  // Teams appearing in any knockout round strictly after `stage` have advanced.
  const advancedPast = (stage: string): Set<string> => {
    const idx = (KO_STAGES as readonly string[]).indexOf(stage);
    const out = new Set<string>();
    for (let i = idx + 1; i < KO_STAGES.length; i++) {
      for (const t of reached[KO_STAGES[i]!]!) out.add(t);
    }
    return out;
  };

  const eliminated = new Set<string>();

  // 1) Losers of finished knockout matches. A decisive result names the loser
  //    directly; a draw means penalties — the loser is whichever side did NOT
  //    turn up in a later round (resolved once that round is populated).
  for (const r of finished) {
    if (!(KO_STAGES as readonly string[]).includes(r.stage)) continue;
    if (r.actualOutcome === "homeWin") eliminated.add(norm(r.awayTeam));
    else if (r.actualOutcome === "awayWin") eliminated.add(norm(r.homeTeam));
    else {
      const later = advancedPast(r.stage);
      const homeAdv = later.has(norm(r.homeTeam));
      const awayAdv = later.has(norm(r.awayTeam));
      if (homeAdv !== awayAdv) eliminated.add(norm(homeAdv ? r.awayTeam : r.homeTeam));
    }
  }

  // 2) Group-stage non-qualifiers: once every group match is played and the R32
  //    line-up is known, any team that was in the groups but isn't in R32 is out.
  const groupFixtures = fixtures.filter((f) => f.stage.startsWith("group"));
  const groupStageComplete =
    groupFixtures.length > 0 && groupFixtures.every((f) => f.status === "finished");
  if (groupStageComplete && reached.R32!.size > 0) {
    for (const f of groupFixtures) {
      if (f.homeTeamId && !reached.R32!.has(norm(f.homeTeam))) eliminated.add(norm(f.homeTeam));
      if (f.awayTeamId && !reached.R32!.has(norm(f.awayTeam))) eliminated.add(norm(f.awayTeam));
    }
  }

  const champion = findChampion(results, fixtures);
  const tournamentStarted = finished.length > 0;

  const teamStat = (name: string, group: string): TeamStat => {
    let played = 0, w = 0, d = 0, l = 0, gf = 0;
    for (const r of finished) {
      const isHome = sameTeam(r.homeTeam, name);
      const isAway = sameTeam(r.awayTeam, name);
      if (!isHome && !isAway) continue;
      played++;
      const myGoals = isHome ? r.actualScore.home! : r.actualScore.away!;
      const oppGoals = isHome ? r.actualScore.away! : r.actualScore.home!;
      gf += myGoals;
      if (myGoals > oppGoals) w++;
      else if (myGoals < oppGoals) l++;
      else d++;
    }
    const matchPoints = w * sweep.scoring.win + d * sweep.scoring.draw;
    let bonus = 0;
    for (const s of KO_STAGES) if (reached[s]!.has(norm(name))) bonus += sweep.scoring.stageBonus[s] ?? 0;
    if (champion && sameTeam(champion, name)) bonus += sweep.scoring.stageBonus.Champion ?? 0;

    let status: TeamStatus = tournamentStarted ? "active" : "pending";
    if (champion && sameTeam(champion, name)) status = "champion";
    else if (eliminated.has(norm(name))) status = "eliminated";

    return { name, group, played, w, d, l, goalsFor: gf, matchPoints, bonusPoints: bonus, points: matchPoints + bonus, status };
  };

  const rows: SweepRow[] = sweep.assignments.map((a) => {
    const teams = a.teams
      .map((t) => teamStat(t.name, t.group))
      .sort((x, y) => y.points - x.points || y.goalsFor - x.goalsFor);
    return {
      person: a.person,
      points: teams.reduce((s, t) => s + t.points, 0),
      goalsFor: teams.reduce((s, t) => s + t.goalsFor, 0),
      teamsAlive: teams.filter((t) => t.status !== "eliminated").length,
      teams,
    };
  });

  // Only rank once the tournament has started; before that keep the original
  // draw order so everyone appears equal (no leader, no implied standing).
  if (tournamentStarted) {
    rows.sort((a, b) => b.points - a.points || b.goalsFor - a.goalsFor || b.teamsAlive - a.teamsAlive);
  }

  return {
    rows,
    champion,
    championOwner: champion ? ownerOf(sweep, champion) : null,
    started: tournamentStarted,
  };
}
