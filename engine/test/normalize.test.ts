import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStatus,
  parseMatchday,
  isGroupStageRound,
  deriveMarketFromOdds,
} from "../src/footballApi.js";
import { normalizeStandings, normalizeFixture } from "../src/sync.js";
import { oddsResponse, standingsResponse, fixturesResponse, fixture } from "./fixtures.js";

test("normalizeStatus maps API-Football short codes", () => {
  assert.equal(normalizeStatus("NS"), "scheduled");
  assert.equal(normalizeStatus("1H"), "live");
  assert.equal(normalizeStatus("HT"), "live");
  assert.equal(normalizeStatus("2H"), "live");
  assert.equal(normalizeStatus("FT"), "finished");
  assert.equal(normalizeStatus("AET"), "finished");
  assert.equal(normalizeStatus("PEN"), "finished");
});

test("parseMatchday extracts matchday from round string", () => {
  assert.equal(parseMatchday("Group Stage - 1"), "MD1");
  assert.equal(parseMatchday("Group Stage - 3"), "MD3");
  assert.equal(parseMatchday("Round of 32"), null);
});

test("isGroupStageRound detects group rounds", () => {
  assert.equal(isGroupStageRound("Group Stage - 2"), true);
  assert.equal(isGroupStageRound("Quarter-finals"), false);
});

test("deriveMarketFromOdds de-vigs a 1X2 market to probabilities summing to ~1", () => {
  const m = deriveMarketFromOdds(oddsResponse as any);
  assert.ok(m, "expected a market");
  assert.equal(m!.source, "book");
  const sum = m!.homeWin + m!.draw + m!.awayWin;
  assert.ok(Math.abs(sum - 1) < 0.005, `probs should sum to ~1, got ${sum}`);
  // 1.80 home should be the favourite
  assert.ok(m!.homeWin > m!.draw && m!.homeWin > m!.awayWin);
});

test("deriveMarketFromOdds returns null when no 1X2 market present", () => {
  const empty = [{ bookmakers: [{ id: 1, name: "x", bets: [] }] }];
  assert.equal(deriveMarketFromOdds(empty as any), null);
});

test("normalizeStandings builds group tables and a team->group map", () => {
  const { standings, teamGroup } = normalizeStandings(standingsResponse);
  assert.equal(Object.keys(standings).length, 2);
  assert.equal(standings["groupA"]!.length, 4);
  assert.equal(standings["groupA"]![0]!.team, "Mexico");
  assert.equal(teamGroup.get(16), "A");
  assert.equal(teamGroup.get(31), "B");
});

test("normalizeFixture derives stage + matchday for group games via team->group map", () => {
  const { teamGroup } = normalizeStandings(standingsResponse);
  const f = normalizeFixture(fixturesResponse[0]!, teamGroup);
  assert.equal(f.stage, "groupA");
  assert.equal(f.matchday, "MD1");
  assert.equal(f.status, "finished");
  assert.equal(f.homeScore, 2);
  assert.equal(f.awayScore, 0);
  assert.equal(f.kickoff, "2026-06-11T18:00:00.000Z");
});

test("normalizeFixture maps knockout rounds to KO stages", () => {
  const { teamGroup } = normalizeStandings(standingsResponse);
  const ko = normalizeFixture(fixturesResponse[3]!, teamGroup);
  assert.equal(ko.stage, "R32");
  assert.equal(ko.matchday, null);
});

test("normalizeFixture carries live elapsed minutes", () => {
  const { teamGroup } = normalizeStandings(standingsResponse);
  const live = normalizeFixture(fixture(9, "Group Stage - 2", 16, "Mexico", 2382, "Ecuador", "2026-06-16T18:00:00+00:00", "2H", 1, 0, 67), teamGroup);
  assert.equal(live.status, "live");
  assert.equal(live.elapsed, 67);
});
