// Manually generate REAL predictions for a set of fixtures so the site populates
// before the 48h window opens. The cron re-predicts + locks these near kickoff.
// Skips fixtures that already have a prediction (cheap to re-run).
//   tsx src/demoSeedPredictions.ts md1     -> all Matchday 1 fixtures
//   tsx src/demoSeedPredictions.ts 5        -> first 5 chronological fixtures
import { store, upsertById } from "./store.js";
import { getOddsRaw, deriveMarketFromOdds } from "./footballApi.js";
import { buildPredictionInputs, recomputeAccuracy } from "./sync.js";
import { predictFixture } from "./predict.js";

const arg = process.argv[2] ?? "md1";
const existing = new Set(store.predictions().map((p) => p.fixtureId));

let target = store
  .fixtures()
  .filter((f) => f.status === "scheduled" && f.homeTeam && f.awayTeam && !existing.has(f.fixtureId))
  .sort((a, b) => a.kickoff.localeCompare(b.kickoff));

if (arg === "md1") target = target.filter((f) => f.matchday === "MD1");
else target = target.slice(0, Number(arg) || 5);

console.log(`Predicting ${target.length} fixture(s) [${arg}]…\n`);
let preds = store.predictions();
const now = new Date().toISOString();
let done = 0;

for (const f of target) {
  try {
    const market = deriveMarketFromOdds(await getOddsRaw(f.fixtureId));
    const inputs = buildPredictionInputs(f, store.results());
    inputs.market = market;
    const pred = await predictFixture(inputs, now);
    if (market) pred.market = market;
    preds = upsertById(preds, pred);
    store.savePredictions(preds); // save incrementally so partial runs persist
    done++;
    console.log(
      `✓ ${f.homeTeam} ${pred.scoreline.home}-${pred.scoreline.away} ${f.awayTeam} ` +
        `| H${Math.round(pred.probs.homeWin * 100)}/D${Math.round(pred.probs.draw * 100)}/A${Math.round(pred.probs.awayWin * 100)} | ${pred.confidence}`
    );
  } catch (err) {
    console.error(`✗ ${f.homeTeam} vs ${f.awayTeam}: ${(err as Error).message}`);
  }
}

recomputeAccuracy(now);
console.log(`\nDone: ${done}/${target.length} new predictions. Total now: ${preds.length}.`);
