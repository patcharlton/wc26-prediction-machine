// Shared data contract for the WC2026 Prediction Machine.
// These shapes are what the engine writes to /data/*.json and what the
// frontend reads. Keep them in sync with web/src/types.ts.

export type Outcome = "homeWin" | "draw" | "awayWin";

export type Confidence =
  | "Low"
  | "Medium-Low"
  | "Medium"
  | "Medium-High"
  | "High";

export type FixtureStatus = "scheduled" | "live" | "finished";

// groupA..groupL for the 12 groups, then the knockout rounds.
export type Stage =
  | "groupA" | "groupB" | "groupC" | "groupD"
  | "groupE" | "groupF" | "groupG" | "groupH"
  | "groupI" | "groupJ" | "groupK" | "groupL"
  | "R32" | "R16" | "QF" | "SF" | "Final";

export type Matchday = "MD1" | "MD2" | "MD3";

// 1X2 probabilities. Stored as fractions in [0,1] that sum to ~1.
export interface ProbTriple {
  homeWin: number;
  draw: number;
  awayWin: number;
}

export interface MarketTriple extends ProbTriple {
  // "book" = derived from a real bookmaker's 1X2 odds (de-vigged).
  // "derived" = no book available; estimated from the prediction context.
  source: "book" | "derived";
}

// ---- Prediction (engine output, frozen at lock) ----
export interface Prediction {
  fixtureId: string;
  probs: ProbTriple;
  scoreline: { home: number; away: number };
  confidence: Confidence;
  reasoning: string; // 2-4 sentences, plain language
  market: MarketTriple; // snapshot of the market at prediction time
  lockedAt: string | null; // ISO timestamp; null until locked
  modelVersion: string; // e.g. "claude-sonnet-4-6"
  // --- bookkeeping (not in the brief schema, used internally) ---
  generatedAt: string; // ISO; when this prediction was produced
  locked: boolean; // true once frozen ~2h before kickoff
  webSearchUsed?: boolean;
}

// ---- Fixture (normalised from API-Football) ----
export interface Fixture {
  fixtureId: string; // string form of API-Football fixture id
  stage: Stage;
  matchday: Matchday | null; // only meaningful for group stage
  kickoff: string; // ISO timestamp (UTC)
  status: FixtureStatus;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  // Live/final score as reported by API-Football (null until played).
  homeScore: number | null;
  awayScore: number | null;
  elapsed: number | null; // minutes elapsed when live
  venue: { name: string | null; city: string | null; country: string | null };
  // Slot definitions for knockout fixtures whose teams aren't known yet,
  // e.g. "Winner Group A", "3rd Group C/E/F/H/I", "Winner Match 73".
  homeSlot?: string;
  awaySlot?: string;
  // Knockout score breakdown (regulation / extra time / penalties), populated
  // for non-group fixtures once finished. Used by the knockout-game self-scoring.
  koScore?: KoScore | null;
}

// Regulation vs extra-time vs shootout breakdown for a knockout match.
export interface KoScore {
  rt: { home: number; away: number } | null; // score after 90' (regulation)
  et: { home: number; away: number } | null; // score after 120' (= ft + et goals); null if no ET
  pens: { home: number; away: number } | null; // shootout score
  advanced: "home" | "away" | null; // which side progressed
}

// ---- Result / accuracy record (per fixture) ----
export interface ResultRecord {
  fixtureId: string;
  status: FixtureStatus;
  kickoff: string; // ISO (UTC)
  stage: Stage;
  homeTeam: string;
  awayTeam: string;
  actualScore: { home: number | null; away: number | null };
  actualOutcome: Outcome | null;
  machineOutcomeHit: boolean | null;
  marketOutcomeHit: boolean | null;
  exactScoreHit: boolean | null;
  machineBrierScore: number | null;
  marketBrierScore: number | null;
  resolvedAt: string | null; // ISO
}

// ---- Aggregate tournament ledger (recomputed every run) ----
export interface StageStats {
  completed: number;
  machineCorrect: number;
  marketCorrect: number;
  exactScoreHits: number;
  machineBrierAvg: number | null;
  marketBrierAvg: number | null;
}

export interface Ledger {
  totals: {
    completed: number;
    machineCorrect: number;
    marketCorrect: number;
    exactScoreHits: number;
  };
  rates: {
    machineOutcomeAccuracy: number;
    marketOutcomeAccuracy: number;
    exactScoreAccuracy: number;
  };
  brier: {
    machineAvg: number | null;
    marketAvg: number | null;
  };
  headToHead: {
    machineLead: number; // count of completed matches machine got but market missed
    level: number;
    marketLead: number;
    verdict: "machine leading" | "level" | "market leading";
  };
  byStage: Record<string, StageStats>;
  byMatchday: Record<string, StageStats>;
  lastUpdatedAt: string;
}

// ---- Standings (group tables) ----
export interface StandingRow {
  teamId: number | null;
  team: string;
  rank: number;
  played: number;
  win: number;
  draw: number;
  lose: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}

export type Standings = Record<string, StandingRow[]>; // key: "groupA".."groupL"

// ---- Tournament winner forecast (re-generated as the tournament progresses) ----
export interface WinnerContender {
  team: string;
  prob: number; // outright win probability in [0,1]
}

export interface WinnerPrediction {
  champion: string;
  runnerUp: string | null;
  darkHorse: string | null; // a lower-probability team the model rates
  confidence: Confidence;
  contenders: WinnerContender[]; // top ~8, highest first
  reasoning: string; // 3-5 sentences
  basis: string; // "pre-tournament" | "group stage (N played)" | "knockouts" etc.
  modelVersion: string;
  updatedAt: string; // ISO
}

// ---- Knockout "beat the game" entries (EV-optimised 3-prediction picks) ----
export interface ScoreProb {
  home: number;
  away: number;
  prob: number;
}

// What the model returns: probability distributions to optimise over.
export interface KoDistributions {
  advance: { home: number; away: number }; // P(side advances), incl. ET + pens
  regulation: ScoreProb[]; // most likely 90' scorelines
  extraTimeProb: number; // model's own P(extra time) — cross-check
  extraTime: ScoreProb[]; // most likely 120' scorelines, CONDITIONAL on ET
}

export interface KoPick {
  home: number;
  away: number;
}

export interface KnockoutEntry {
  fixtureId: string;
  stage: Stage;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  // The three EV-optimised predictions:
  pred1Advance: "home" | "away";
  pred1Team: string;
  pred2Reg: KoPick; // score after regulation
  pred3Et: KoPick; // score after extra time
  // Expected points (per pick + total, max 7):
  ev: { p1: number; p2: number; p3: number; total: number };
  pEtUsed: number; // P(extra time) used in the optimisation (regulation draw mass)
  distributions: KoDistributions;
  reasoning: string;
  modelVersion: string;
  generatedAt: string;
  lockedAt: string | null;
  locked: boolean;
  webSearchUsed?: boolean;
  // Realised once the match is played:
  actual?: KoScore | null;
  scored?: { p1: number; p2: number; p3: number; total: number } | null;
}

export interface KnockoutGame {
  entries: KnockoutEntry[];
  summary: {
    matchesScored: number;
    machinePoints: number;
    maxPoints: number; // 7 * matchesScored
    expectedTotal: number; // sum of expected points across all entries
    lastUpdatedAt: string;
  };
}

// ---- Engine run metadata ----
export interface Meta {
  lastRun: Record<string, string>; // jobName -> ISO timestamp
  apiFootball: {
    requestsToday: number;
    dayUtc: string; // YYYY-MM-DD that requestsToday is counted against
    lastResetAt: string;
  };
  tournament: {
    startsAt: string;
    leagueId: number;
    season: number;
  };
  notes?: string;
}
