import { test } from "node:test";
import assert from "node:assert/strict";
import {
  R32,
  KO_FEED,
  thirdsEligibility,
  computeQualifiers,
  resolveSlots,
  slotLabel,
} from "../src/bracket.js";
import type { Standings, StandingRow } from "../src/types.js";

test("R32 has 16 matches numbered 73-88; KO_FEED covers 89-104", () => {
  assert.equal(R32.length, 16);
  assert.deepEqual(R32.map((m) => m.match), [73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88]);
  const koNums = KO_FEED.map((m) => m.match);
  assert.deepEqual(koNums, [89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104]);
});

test("every third-place slot lists exactly 5 eligible groups", () => {
  const elig = thirdsEligibility();
  const slots = Object.keys(elig);
  assert.equal(slots.length, 8); // 8 third-place slots
  for (const m of slots) assert.equal(elig[Number(m)]!.length, 5);
});

test("slotLabel renders human-readable placeholders", () => {
  assert.equal(slotLabel("W:A"), "Winner Group A");
  assert.equal(slotLabel("RU:B"), "Runner-up Group B");
  assert.equal(slotLabel("WM:73"), "Winner Match 73");
  assert.equal(slotLabel("LM:101"), "Loser Match 101");
});

// Build a full 12-group standings table so qualifiers + thirds can resolve.
function fullStandings(): Standings {
  const groups = "ABCDEFGHIJKL".split("");
  const s: Standings = {};
  groups.forEach((g, gi) => {
    const rows: StandingRow[] = [0, 1, 2, 3].map((r) => ({
      teamId: gi * 10 + r,
      team: `${g}${r + 1}`,
      rank: r + 1,
      played: 3,
      win: 3 - r,
      draw: 0,
      lose: r,
      goalsFor: 6 - r,
      goalsAgainst: r,
      goalDiff: 6 - 2 * r,
      // make thirds differ so the "best 8" ranking is deterministic
      points: (3 - r) * 3 - gi, // group A thirds slightly stronger than L
    }));
    s["group" + g] = rows;
  });
  return s;
}

test("computeQualifiers extracts winners, runners-up and the 8 best thirds", () => {
  const q = computeQualifiers(fullStandings());
  assert.ok(q);
  assert.equal(Object.keys(q!.winners).length, 12);
  assert.equal(q!.winners["A"], "A1");
  assert.equal(q!.runnersUp["A"], "A2");
  assert.equal(q!.bestThirds.length, 8);
});

test("resolveSlots fills winner/runner-up tokens and assigns thirds respecting eligibility", () => {
  const resolved = resolveSlots(fullStandings(), {});
  assert.equal(resolved["W:A"], "A1");
  assert.equal(resolved["RU:B"], "B2");

  // Each third-place slot must be filled by a team from an eligible group.
  const elig = thirdsEligibility();
  for (const m of R32) {
    if (m.away.startsWith("3:")) {
      const team = resolved[m.away];
      assert.ok(team, `slot ${m.match} should be assigned`);
      const groupLetter = team!.charAt(0);
      assert.ok(
        elig[m.match]!.includes(groupLetter),
        `match ${m.match} got ${team} (group ${groupLetter}) not in ${elig[m.match]}`
      );
    }
  }
});

test("resolveSlots propagates knockout match winners/losers", () => {
  const resolved = resolveSlots(fullStandings(), {
    101: { winner: "Spain", loser: "France" },
    102: { winner: "Argentina", loser: "England" },
  });
  assert.equal(resolved["WM:101"], "Spain");
  assert.equal(resolved["LM:101"], "France");
  assert.equal(resolved["WM:102"], "Argentina");
});

test("computeQualifiers returns null until all groups have played", () => {
  const partial: Standings = { groupA: [] };
  assert.equal(computeQualifiers(partial), null);
});
