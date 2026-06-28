// Mirror of the engine data contract (engine/src/types.ts) — the subset the UI reads.
export type Outcome = "homeWin" | "draw" | "awayWin";
export type FixtureStatus = "scheduled" | "live" | "finished";
export type Stage =
  | "groupA" | "groupB" | "groupC" | "groupD" | "groupE" | "groupF"
  | "groupG" | "groupH" | "groupI" | "groupJ" | "groupK" | "groupL"
  | "R32" | "R16" | "QF" | "SF" | "Final";
export type Matchday = "MD1" | "MD2" | "MD3";

export interface ProbTriple { homeWin: number; draw: number; awayWin: number; }
export interface MarketTriple extends ProbTriple { source: "book" | "derived"; }

export interface Fixture {
  fixtureId: string;
  stage: Stage;
  matchday: Matchday | null;
  kickoff: string;
  status: FixtureStatus;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  elapsed: number | null;
  homeSlot?: string;
  awaySlot?: string;
  venue: { name: string | null; city: string | null; country: string | null };
}

export interface Prediction {
  fixtureId: string;
  probs: ProbTriple;
  scoreline: { home: number; away: number };
  confidence: "Low" | "Medium-Low" | "Medium" | "Medium-High" | "High";
  reasoning: string;
  market: MarketTriple;
  lockedAt: string | null;
  modelVersion: string;
  generatedAt: string;
  locked: boolean;
  webSearchUsed?: boolean;
}

export interface ResultRecord {
  fixtureId: string;
  status: FixtureStatus;
  kickoff: string;
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
  resolvedAt: string | null;
}

export interface StageStats {
  completed: number;
  machineCorrect: number;
  marketCorrect: number;
  exactScoreHits: number;
  machineBrierAvg: number | null;
  marketBrierAvg: number | null;
}

export interface Ledger {
  totals: { completed: number; machineCorrect: number; marketCorrect: number; exactScoreHits: number };
  rates: { machineOutcomeAccuracy: number; marketOutcomeAccuracy: number; exactScoreAccuracy: number };
  brier: { machineAvg: number | null; marketAvg: number | null };
  headToHead: {
    machineLead: number; level: number; marketLead: number;
    verdict: "machine leading" | "level" | "market leading";
  };
  byStage: Record<string, StageStats>;
  byMatchday: Record<string, StageStats>;
  lastUpdatedAt: string;
}

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
export type Standings = Record<string, StandingRow[]>;

export interface Meta {
  lastRun?: Record<string, string>;
  apiFootball?: { requestsToday: number; dayUtc: string };
  notes?: string;
}

export interface WinnerContender {
  team: string;
  prob: number;
}

export interface WinnerPrediction {
  champion: string;
  runnerUp: string | null;
  darkHorse: string | null;
  confidence: "Low" | "Medium-Low" | "Medium" | "Medium-High" | "High";
  contenders: WinnerContender[];
  reasoning: string;
  basis: string;
  modelVersion: string;
  updatedAt: string;
}

export interface SweepTeam { name: string; group: string; }
export interface SweepAssignment { person: string; teams: SweepTeam[]; }
export interface Sweepstake {
  title: string;
  createdAt: string;
  stakes: string;
  people: string[];
  scoring: { win: number; draw: number; stageBonus: Record<string, number> };
  assignments: SweepAssignment[];
}

// ---- Knockout "beat the game" ----
export interface ScoreProb { home: number; away: number; prob: number; }
export interface KoDistributions {
  advance: { home: number; away: number };
  regulation: ScoreProb[];
  extraTimeProb: number;
  extraTime: ScoreProb[];
}
export interface KoScore {
  rt: { home: number; away: number } | null;
  et: { home: number; away: number } | null;
  pens: { home: number; away: number } | null;
  advanced: "home" | "away" | null;
}
export interface KnockoutEntry {
  fixtureId: string;
  stage: Stage;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  pred1Advance: "home" | "away";
  pred1Team: string;
  pred2Reg: { home: number; away: number };
  pred3Et: { home: number; away: number };
  ev: { p1: number; p2: number; p3: number; total: number };
  pEtUsed: number;
  distributions: KoDistributions;
  reasoning: string;
  modelVersion: string;
  generatedAt: string;
  lockedAt: string | null;
  locked: boolean;
  webSearchUsed?: boolean;
  actual?: KoScore | null;
  scored?: { p1: number; p2: number; p3: number; total: number } | null;
}
export interface KnockoutGame {
  entries: KnockoutEntry[];
  summary: {
    matchesScored: number;
    machinePoints: number;
    maxPoints: number;
    expectedTotal: number;
    lastUpdatedAt: string;
  };
}

export interface AppData {
  fixtures: Fixture[];
  predictions: Record<string, Prediction>;
  results: Record<string, ResultRecord>;
  ledger: Ledger | null;
  standings: Standings;
  meta: Meta;
  winner: WinnerPrediction | null;
  sweepstake: Sweepstake | null;
  knockoutGame: KnockoutGame | null;
}
