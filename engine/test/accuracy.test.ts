import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brier,
  argmaxOutcome,
  outcomeFromScore,
  scoreFixture,
  buildLedger,
} from "../src/accuracy.js";
import type { Fixture, Prediction, ResultRecord } from "../src/types.js";

function mkFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    fixtureId: "1", stage: "groupA", matchday: "MD1",
    kickoff: "2026-06-11T18:00:00.000Z", status: "finished",
    homeTeam: "Mexico", awayTeam: "Croatia", homeTeamId: 16, awayTeamId: 3,
    homeScore: 2, awayScore: 0, elapsed: null,
    venue: { name: null, city: null, country: null }, ...over,
  };
}

function mkPred(over: Partial<Prediction> = {}): Prediction {
  return {
    fixtureId: "1",
    probs: { homeWin: 0.6, draw: 0.25, awayWin: 0.15 },
    scoreline: { home: 2, away: 0 },
    confidence: "High",
    reasoning: "x",
    market: { homeWin: 0.5, draw: 0.3, awayWin: 0.2, source: "book" },
    lockedAt: "2026-06-11T16:00:00.000Z", modelVersion: "claude-sonnet-4-6",
    generatedAt: "2026-06-11T15:00:00.000Z", locked: true, ...over,
  };
}

test("outcomeFromScore + argmaxOutcome", () => {
  assert.equal(outcomeFromScore(2, 0), "homeWin");
  assert.equal(outcomeFromScore(1, 1), "draw");
  assert.equal(outcomeFromScore(0, 3), "awayWin");
  assert.equal(argmaxOutcome({ homeWin: 0.6, draw: 0.25, awayWin: 0.15 }), "homeWin");
  assert.equal(argmaxOutcome({ homeWin: 0.2, draw: 0.5, awayWin: 0.3 }), "draw");
});

test("brier score: perfect prediction = 0, worst = 2", () => {
  assert.equal(brier({ homeWin: 1, draw: 0, awayWin: 0 }, "homeWin"), 0);
  assert.equal(brier({ homeWin: 0, draw: 0, awayWin: 1 }, "homeWin"), 2);
});

test("scoreFixture marks outcome, exact-score and market hits", () => {
  const rec = scoreFixture(mkFixture(), mkPred(), 2, 0, "2026-06-11T20:00:00.000Z");
  assert.equal(rec.actualOutcome, "homeWin");
  assert.equal(rec.machineOutcomeHit, true);
  assert.equal(rec.marketOutcomeHit, true);
  assert.equal(rec.exactScoreHit, true);
  assert.ok(rec.machineBrierScore! < rec.marketBrierScore!); // machine was more confident & right
});

test("scoreFixture records a miss when the underdog wins", () => {
  const rec = scoreFixture(mkFixture({ homeScore: 0, awayScore: 1 }), mkPred(), 0, 1, "t");
  assert.equal(rec.actualOutcome, "awayWin");
  assert.equal(rec.machineOutcomeHit, false);
  assert.equal(rec.marketOutcomeHit, false);
  assert.equal(rec.exactScoreHit, false);
});

test("buildLedger aggregates totals, rates, head-to-head and stage breakdown", () => {
  const results: ResultRecord[] = [
    // machine right, market wrong -> machine lead
    {
      fixtureId: "a", status: "finished", kickoff: "k", stage: "groupA",
      homeTeam: "X", awayTeam: "Y", actualScore: { home: 1, away: 0 }, actualOutcome: "homeWin",
      machineOutcomeHit: true, marketOutcomeHit: false, exactScoreHit: true,
      machineBrierScore: 0.2, marketBrierScore: 0.8, resolvedAt: "r",
    },
    // both right -> level
    {
      fixtureId: "b", status: "finished", kickoff: "k", stage: "R32",
      homeTeam: "X", awayTeam: "Y", actualScore: { home: 0, away: 2 }, actualOutcome: "awayWin",
      machineOutcomeHit: true, marketOutcomeHit: true, exactScoreHit: false,
      machineBrierScore: 0.3, marketBrierScore: 0.3, resolvedAt: "r",
    },
    // unfinished -> ignored
    {
      fixtureId: "c", status: "scheduled", kickoff: "k", stage: "groupB",
      homeTeam: "X", awayTeam: "Y", actualScore: { home: null, away: null }, actualOutcome: null,
      machineOutcomeHit: null, marketOutcomeHit: null, exactScoreHit: null,
      machineBrierScore: null, marketBrierScore: null, resolvedAt: null,
    },
  ];
  const l = buildLedger(results, "now");
  assert.equal(l.totals.completed, 2);
  assert.equal(l.totals.machineCorrect, 2);
  assert.equal(l.totals.marketCorrect, 1);
  assert.equal(l.totals.exactScoreHits, 1);
  assert.equal(l.rates.machineOutcomeAccuracy, 1);
  assert.equal(l.rates.marketOutcomeAccuracy, 0.5);
  assert.equal(l.headToHead.machineLead, 1);
  assert.equal(l.headToHead.level, 1);
  assert.equal(l.headToHead.verdict, "machine leading");
  assert.equal(l.byStage["group"]!.completed, 1);
  assert.equal(l.byStage["R32"]!.completed, 1);
});
