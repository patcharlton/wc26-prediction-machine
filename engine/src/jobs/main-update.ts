// main-update — every 6 hours.
// Pull standings + all fixtures, populate knockouts, generate predictions for
// fixtures newly inside the 48h window, recompute the accuracy ledger.
// API budget: 2 (sync) + 1 per newly-predicted fixture (odds).
import { runJob } from "./_common.js";
import { syncFixturesAndStandings, recomputeAccuracy } from "../sync.js";
import { generateWindowPredictions } from "../predictRunner.js";

runJob("main-update", async (now) => {
  const { fixtures } = await syncFixturesAndStandings();
  const { generated } = await generateWindowPredictions(now);
  recomputeAccuracy(now);
  return {
    changed: true,
    summary: `synced ${fixtures.length} fixtures, generated ${generated} new prediction(s).`,
  };
});
