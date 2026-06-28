// Seed two illustrative knockout-game entries so the page demonstrates the EV
// strategy before real knockout fixtures exist (~28 Jun). Deterministic (no API
// calls): hand-built realistic distributions run through the REAL optimiser +
// scorer. Clearly labelled as examples (fixtureId "example-*"). The cron replaces
// the page with live entries once R32 is drawn.  tsx src/seedKnockoutExample.ts
import { store } from "./store.js";
import { optimizeEntry, scoreEntry, recomputeKnockoutGame } from "./knockoutGame.js";
import type { KnockoutEntry, KoDistributions, KoScore, Stage } from "./types.js";

const now = new Date().toISOString();

function buildEntry(
  fixtureId: string, stage: Stage, kickoff: string,
  homeTeam: string, awayTeam: string,
  dist: KoDistributions, reasoning: string, actual: KoScore | null
): KnockoutEntry {
  const opt = optimizeEntry(dist);
  const scored = actual ? scoreEntry(opt, actual) : null;
  return {
    fixtureId, stage, homeTeam, awayTeam, kickoff,
    pred1Advance: opt.pred1Advance,
    pred1Team: opt.pred1Advance === "home" ? homeTeam : awayTeam,
    pred2Reg: opt.pred2Reg,
    pred3Et: opt.pred3Et,
    ev: opt.ev,
    pEtUsed: opt.pEtUsed,
    distributions: dist,
    reasoning,
    modelVersion: "illustrative-example",
    generatedAt: now,
    lockedAt: actual ? kickoff : null,
    locked: !!actual,
    webSearchUsed: false,
    actual,
    scored,
  };
}

// --- Example 1: the 2022 World Cup final (real result, self-scored) ---
// A genuinely even final: high draw mass means the EV-optimal regulation AND ET
// picks both land on the modal draw — and the match really did finish level (2-2,
// then 3-3) before penalties.
const final2022: KoDistributions = {
  advance: { home: 0.55, away: 0.45 },
  regulation: [
    { home: 1, away: 1, prob: 0.17 }, { home: 0, away: 0, prob: 0.13 }, { home: 1, away: 0, prob: 0.13 },
    { home: 0, away: 1, prob: 0.11 }, { home: 2, away: 1, prob: 0.10 }, { home: 1, away: 2, prob: 0.09 },
    { home: 2, away: 2, prob: 0.07 }, { home: 2, away: 0, prob: 0.07 }, { home: 0, away: 2, prob: 0.06 },
    { home: 3, away: 2, prob: 0.03 }, { home: 2, away: 3, prob: 0.04 },
  ],
  extraTimeProb: 0.37,
  extraTime: [
    { home: 1, away: 1, prob: 0.22 }, { home: 2, away: 1, prob: 0.16 }, { home: 1, away: 2, prob: 0.15 },
    { home: 2, away: 2, prob: 0.12 }, { home: 1, away: 0, prob: 0.08 }, { home: 0, away: 1, prob: 0.07 },
    { home: 3, away: 2, prob: 0.06 }, { home: 2, away: 3, prob: 0.06 }, { home: 3, away: 3, prob: 0.05 },
    { home: 0, away: 0, prob: 0.03 },
  ],
};
const final2022Actual: KoScore = {
  rt: { home: 2, away: 2 }, et: { home: 3, away: 3 }, pens: { home: 4, away: 2 }, advanced: "home",
};

// --- Example 2: a strong favourite (illustrative) — shows pred2 ≠ pred3 ---
// Spain heavily favoured: the regulation pick is a decisive win, but the ET pick
// (which only matters if it stays level) is a draw. This is the core of the strategy.
const favourite: KoDistributions = {
  advance: { home: 0.78, away: 0.22 },
  regulation: [
    { home: 2, away: 0, prob: 0.18 }, { home: 1, away: 0, prob: 0.16 }, { home: 2, away: 1, prob: 0.13 },
    { home: 1, away: 1, prob: 0.10 }, { home: 3, away: 0, prob: 0.09 }, { home: 3, away: 1, prob: 0.08 },
    { home: 0, away: 0, prob: 0.08 }, { home: 0, away: 1, prob: 0.06 }, { home: 1, away: 2, prob: 0.06 },
    { home: 2, away: 2, prob: 0.06 },
  ],
  extraTimeProb: 0.24,
  extraTime: [
    { home: 1, away: 1, prob: 0.30 }, { home: 2, away: 1, prob: 0.20 }, { home: 1, away: 0, prob: 0.15 },
    { home: 2, away: 2, prob: 0.10 }, { home: 0, away: 0, prob: 0.10 }, { home: 1, away: 2, prob: 0.08 },
    { home: 0, away: 1, prob: 0.07 },
  ],
};

const entries = [
  buildEntry(
    "example-favourite", "R16", "2026-07-04T19:00:00.000Z", "Spain", "Norway", favourite,
    "Illustrative example of the strategy with a clear favourite. Pred 2 (regulation) is the most likely 90' result — a decisive Spain win — while Pred 3 only pays if the game is level after 90, so it targets the modal extra-time draw. The two deliberately differ.",
    null
  ),
  buildEntry(
    "example-2022-final", "Final", "2022-12-18T15:00:00.000Z", "Argentina", "France", final2022,
    "Worked example on a real, recognisable result: the 2022 final. An evenly-matched final carries huge draw mass, so the EV-optimal regulation and extra-time picks can coincide on the modal draw — and the match really did finish 2-2, then 3-3, before Argentina won on penalties.",
    final2022Actual
  ),
];

store.saveKnockoutGame({
  entries,
  summary: { matchesScored: 0, machinePoints: 0, maxPoints: 0, expectedTotal: 0, lastUpdatedAt: now },
});
recomputeKnockoutGame(now);

const g = store.knockoutGame()!;
console.log("Seeded knockout-game examples:\n");
for (const e of g.entries) {
  console.log(
    `  ${e.homeTeam} v ${e.awayTeam} [${e.stage}]\n` +
      `    advance: ${e.pred1Team} | reg: ${e.pred2Reg.home}-${e.pred2Reg.away} | ET: ${e.pred3Et.home}-${e.pred3Et.away}` +
      ` | E[pts] ${e.ev.total}` + (e.scored ? ` | scored ${e.scored.total}/7` : "")
  );
}
console.log(`\nSummary: ${g.summary.machinePoints}/${g.summary.maxPoints} pts over ${g.summary.matchesScored} scored.`);
