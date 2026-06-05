// daily-housekeeping — 06:00 UTC.
// Full resync of fixtures + standings (captures final scores for anything that
// finished overnight and refreshes group tables), then recompute the ledger.
// API budget: 2 requests.
import { runJob } from "./_common.js";
import { syncFixturesAndStandings, recomputeAccuracy } from "../sync.js";
import { store } from "../store.js";
import { predictTournamentWinner } from "../winner.js";

runJob("daily-housekeeping", async (now) => {
  const { fixtures, standings } = await syncFixturesAndStandings();
  recomputeAccuracy(now);
  const groups = Object.keys(standings).length;

  // Refresh the tournament-winner forecast daily so it adapts to results/form.
  // One Anthropic (Opus) call/day; failure here must not fail housekeeping.
  let winnerNote = "winner unchanged";
  try {
    const winner = await predictTournamentWinner(now);
    store.saveWinner(winner);
    winnerNote = `winner pick: ${winner.champion}`;
  } catch (err) {
    console.warn("[daily-housekeeping] winner forecast failed:", (err as Error).message);
  }

  return {
    changed: true,
    summary: `resynced ${fixtures.length} fixtures, ${groups} group tables; ledger recomputed; ${winnerNote}.`,
  };
});
