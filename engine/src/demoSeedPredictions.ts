// One-off: generate REAL predictions for the first N chronological fixtures so the
// live site demonstrates itself before the 48h window opens. The cron will
// re-predict + lock these closer to kickoff. Run:
//   ANTHROPIC_API_KEY=.. FOOTBALL_API_KEY=.. tsx src/demoSeedPredictions.ts 5
import { store, upsertById } from "./store.js";
import { getOddsRaw, deriveMarketFromOdds } from "./footballApi.js";
import { buildPredictionInputs, recomputeAccuracy } from "./sync.js";
import { predictFixture } from "./predict.js";

const N = Number(process.argv[2] ?? 5);
const fixtures = store.fixtures()
  .filter((f) => f.status === "scheduled" && f.homeTeam && f.awayTeam)
  .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
  .slice(0, N);

let preds = store.predictions();
const now = new Date().toISOString();

for (const f of fixtures) {
  const market = deriveMarketFromOdds(await getOddsRaw(f.fixtureId));
  const inputs = buildPredictionInputs(f, store.results());
  inputs.market = market;
  const pred = await predictFixture(inputs, now);
  if (market) pred.market = market;
  preds = upsertById(preds, pred);
  store.savePredictions(preds);
  console.log(`✓ ${f.homeTeam} ${pred.scoreline.home}-${pred.scoreline.away} ${f.awayTeam}  ` +
    `| H${Math.round(pred.probs.homeWin*100)}/D${Math.round(pred.probs.draw*100)}/A${Math.round(pred.probs.awayWin*100)} ` +
    `| ${pred.confidence} | web=${pred.webSearchUsed}`);
}

recomputeAccuracy(now);
console.log(`\nSeeded ${fixtures.length} real predictions.`);
