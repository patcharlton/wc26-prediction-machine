// Reset predictions to empty (clean start). The cron regenerates predictions
// inside the 48h window before each match. tsx src/clearPredictions.ts
import { store } from "./store.js";
import { recomputeAccuracy } from "./sync.js";

store.savePredictions([]);
recomputeAccuracy(new Date().toISOString());
console.log("Cleared all predictions; results + ledger recomputed (empty).");
