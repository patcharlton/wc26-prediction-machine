// One-off live validation of the full prediction path (not committed to data).
// Picks the earliest fixture, pulls its real market, and runs a real Claude call
// with web search. Run: ANTHROPIC_API_KEY=.. FOOTBALL_API_KEY=.. tsx src/demoPredict.ts
import { store } from "./store.js";
import { getOddsRaw, deriveMarketFromOdds } from "./footballApi.js";
import { buildPredictionInputs } from "./sync.js";
import { predictFixture, modelForStage } from "./predict.js";

const fixtures = store.fixtures().sort((a, b) => a.kickoff.localeCompare(b.kickoff));
const f = fixtures[0];
if (!f) { console.error("no fixtures in store"); process.exit(1); }

console.log(`Fixture: ${f.homeTeam} vs ${f.awayTeam}`);
console.log(`Stage ${f.stage} | kickoff ${f.kickoff} | venue ${f.venue.city ?? "?"}`);
console.log(`Model: ${modelForStage(f.stage)}`);

const market = deriveMarketFromOdds(await getOddsRaw(f.fixtureId));
console.log("Market (de-vigged):", market ?? "none available");

const inputs = buildPredictionInputs(f, store.results());
inputs.market = market;

console.log("\nCalling Claude with web search… (this can take ~30-60s)\n");
const pred = await predictFixture(inputs, new Date().toISOString());
console.log(JSON.stringify(pred, null, 2));
