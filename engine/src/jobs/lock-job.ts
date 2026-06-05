// lock-job — hourly.
// For any fixture within ~2h of kickoff that isn't locked yet: re-predict with
// the freshest inputs, LOCK it, and freeze the market snapshot. Uses stored
// fixtures (no sync) so most runs spend zero API requests.
// API budget: 1 (odds) per fixture locked; 0 when nothing is due.
import { runJob } from "./_common.js";
import { lockDuePredictions } from "../predictRunner.js";
import { recomputeAccuracy } from "../sync.js";

runJob("lock-job", async (now) => {
  const { locked } = await lockDuePredictions(now);
  if (locked) recomputeAccuracy(now);
  return {
    changed: locked > 0,
    summary: locked ? `locked ${locked} prediction(s).` : "nothing due to lock.",
  };
});
