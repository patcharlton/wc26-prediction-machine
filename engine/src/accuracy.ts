// Accuracy engine. Given fixtures (with real results), predictions and frozen
// market snapshots, produce per-fixture ResultRecords and the tournament ledger.
import type {
  Fixture,
  Prediction,
  ResultRecord,
  Ledger,
  StageStats,
  Outcome,
  ProbTriple,
} from "./types.js";

export function argmaxOutcome(p: ProbTriple): Outcome {
  if (p.homeWin >= p.draw && p.homeWin >= p.awayWin) return "homeWin";
  if (p.awayWin >= p.draw && p.awayWin >= p.homeWin) return "awayWin";
  return "draw";
}

export function outcomeFromScore(home: number, away: number): Outcome {
  if (home > away) return "homeWin";
  if (home < away) return "awayWin";
  return "draw";
}

// Multi-class Brier score over {homeWin, draw, awayWin}. Range 0 (perfect) .. 2.
export function brier(p: ProbTriple, actual: Outcome): number {
  const o = {
    homeWin: actual === "homeWin" ? 1 : 0,
    draw: actual === "draw" ? 1 : 0,
    awayWin: actual === "awayWin" ? 1 : 0,
  };
  const s =
    (p.homeWin - o.homeWin) ** 2 +
    (p.draw - o.draw) ** 2 +
    (p.awayWin - o.awayWin) ** 2;
  return Math.round(s * 1000) / 1000;
}

function isGroup(stage: string): boolean {
  return stage.startsWith("group");
}

function emptyStage(): StageStats {
  return {
    completed: 0,
    machineCorrect: 0,
    marketCorrect: 0,
    exactScoreHits: 0,
    machineBrierAvg: null,
    marketBrierAvg: null,
  };
}

// Score a single finished fixture against its (locked) prediction.
export function scoreFixture(
  fixture: Fixture,
  prediction: Prediction | undefined,
  actualHome: number,
  actualAway: number,
  resolvedAt: string
): ResultRecord {
  const actualOutcome = outcomeFromScore(actualHome, actualAway);
  const rec: ResultRecord = {
    fixtureId: fixture.fixtureId,
    status: "finished",
    kickoff: fixture.kickoff,
    stage: fixture.stage,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    actualScore: { home: actualHome, away: actualAway },
    actualOutcome,
    machineOutcomeHit: null,
    marketOutcomeHit: null,
    exactScoreHit: null,
    machineBrierScore: null,
    marketBrierScore: null,
    resolvedAt,
  };

  if (prediction) {
    const machinePick = argmaxOutcome(prediction.probs);
    rec.machineOutcomeHit = machinePick === actualOutcome;
    rec.exactScoreHit =
      prediction.scoreline.home === actualHome &&
      prediction.scoreline.away === actualAway;
    rec.machineBrierScore = brier(prediction.probs, actualOutcome);

    const market = prediction.market;
    // Only score the market if we actually have one with signal.
    const hasMarket = market.homeWin + market.draw + market.awayWin > 0;
    if (hasMarket) {
      const marketPick = argmaxOutcome(market);
      rec.marketOutcomeHit = marketPick === actualOutcome;
      rec.marketBrierScore = brier(market, actualOutcome);
    }
  }
  return rec;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000;
}

function accumulate(into: StageStats, rec: ResultRecord, briers: { m: number[]; k: number[] }) {
  into.completed += 1;
  if (rec.machineOutcomeHit) into.machineCorrect += 1;
  if (rec.marketOutcomeHit) into.marketCorrect += 1;
  if (rec.exactScoreHit) into.exactScoreHits += 1;
  if (rec.machineBrierScore != null) briers.m.push(rec.machineBrierScore);
  if (rec.marketBrierScore != null) briers.k.push(rec.marketBrierScore);
}

// Recompute the whole ledger from the finished result records.
export function buildLedger(results: ResultRecord[], now: string): Ledger {
  const finished = results.filter((r) => r.status === "finished" && r.actualOutcome);

  const byStage: Record<string, StageStats> = {
    group: emptyStage(),
    R32: emptyStage(),
    R16: emptyStage(),
    QF: emptyStage(),
    SF: emptyStage(),
    Final: emptyStage(),
  };
  const byMatchday: Record<string, StageStats> = {
    MD1: emptyStage(),
    MD2: emptyStage(),
    MD3: emptyStage(),
  };
  const stageBriers: Record<string, { m: number[]; k: number[] }> = {};
  const mdBriers: Record<string, { m: number[]; k: number[] }> = {};
  for (const k of Object.keys(byStage)) stageBriers[k] = { m: [], k: [] };
  for (const k of Object.keys(byMatchday)) mdBriers[k] = { m: [], k: [] };

  let machineCorrect = 0;
  let marketCorrect = 0;
  let exactScoreHits = 0;
  const allMachineBrier: number[] = [];
  const allMarketBrier: number[] = [];
  let machineLead = 0;
  let marketLead = 0;
  let level = 0;

  for (const rec of finished) {
    const stageKey = isGroup(rec.stage) ? "group" : rec.stage;
    if (byStage[stageKey]) accumulate(byStage[stageKey], rec, stageBriers[stageKey]!);

    if (rec.machineOutcomeHit) machineCorrect += 1;
    if (rec.marketOutcomeHit) marketCorrect += 1;
    if (rec.exactScoreHit) exactScoreHits += 1;
    if (rec.machineBrierScore != null) allMachineBrier.push(rec.machineBrierScore);
    if (rec.marketBrierScore != null) allMarketBrier.push(rec.marketBrierScore);

    // head-to-head only counts matches where both sides made a pick
    if (rec.machineOutcomeHit != null && rec.marketOutcomeHit != null) {
      if (rec.machineOutcomeHit && !rec.marketOutcomeHit) machineLead += 1;
      else if (!rec.machineOutcomeHit && rec.marketOutcomeHit) marketLead += 1;
      else level += 1;
    }
  }

  // Per-matchday accumulation needs the fixture matchday; results don't carry it,
  // so callers populate byMatchday via the fixtures list. We approximate matchday
  // here only when stage is group via the caller-provided records (see jobs).
  // (Matchday breakdown is filled in finalizeLedgerMatchdays.)

  for (const [k, s] of Object.entries(byStage)) {
    s.machineBrierAvg = avg(stageBriers[k]!.m);
    s.marketBrierAvg = avg(stageBriers[k]!.k);
  }

  const completed = finished.length;
  const verdict =
    machineLead > marketLead
      ? "machine leading"
      : machineLead < marketLead
        ? "market leading"
        : "level";

  return {
    totals: { completed, machineCorrect, marketCorrect, exactScoreHits },
    rates: {
      machineOutcomeAccuracy: completed ? round3(machineCorrect / completed) : 0,
      marketOutcomeAccuracy: completed ? round3(marketCorrect / completed) : 0,
      exactScoreAccuracy: completed ? round3(exactScoreHits / completed) : 0,
    },
    brier: { machineAvg: avg(allMachineBrier), marketAvg: avg(allMarketBrier) },
    headToHead: { machineLead, level, marketLead, verdict },
    byStage,
    byMatchday,
    lastUpdatedAt: now,
  };
}

// Fill the byMatchday breakdown using the fixtures list (which knows matchday).
export function finalizeLedgerMatchdays(
  ledger: Ledger,
  results: ResultRecord[],
  matchdayByFixture: Map<string, string | null>
): Ledger {
  const briers: Record<string, { m: number[]; k: number[] }> = {
    MD1: { m: [], k: [] },
    MD2: { m: [], k: [] },
    MD3: { m: [], k: [] },
  };
  for (const rec of results) {
    if (rec.status !== "finished" || !rec.actualOutcome) continue;
    const md = matchdayByFixture.get(rec.fixtureId);
    if (!md || !ledger.byMatchday[md]) continue;
    accumulate(ledger.byMatchday[md], rec, briers[md]!);
  }
  for (const [k, s] of Object.entries(ledger.byMatchday)) {
    s.machineBrierAvg = avg(briers[k]!.m);
    s.marketBrierAvg = avg(briers[k]!.k);
  }
  return ledger;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
