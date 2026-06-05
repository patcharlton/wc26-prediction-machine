// Generate the tournament-winner forecast once, now. (The daily-housekeeping cron
// does this automatically each day.) tsx src/runWinner.ts
import { store } from "./store.js";
import { predictTournamentWinner } from "./winner.js";

const now = new Date().toISOString();
const w = await predictTournamentWinner(now);
store.saveWinner(w);
console.log(`Champion pick: ${w.champion} (runner-up ${w.runnerUp}, dark horse ${w.darkHorse})`);
console.log(`Confidence: ${w.confidence} | basis: ${w.basis} | model: ${w.modelVersion}`);
console.log("Top contenders:");
for (const c of w.contenders) console.log(`  ${c.team}: ${Math.round(c.prob * 100)}%`);
console.log("\n" + w.reasoning);
