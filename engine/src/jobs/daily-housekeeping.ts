// daily-housekeeping — 06:00 UTC.
// Full resync of fixtures + standings (captures final scores for anything that
// finished overnight and refreshes group tables), then recompute the ledger.
// API budget: 2 requests.
import { runJob } from "./_common.js";
import { syncFixturesAndStandings, recomputeAccuracy } from "../sync.js";

runJob("daily-housekeeping", async (now) => {
  const { fixtures, standings } = await syncFixturesAndStandings();
  recomputeAccuracy(now);
  const groups = Object.keys(standings).length;
  return {
    changed: true,
    summary: `resynced ${fixtures.length} fixtures, ${groups} group tables; ledger recomputed.`,
  };
});
