// live-status — every 15 minutes, but only does real work while a match is in play.
// Guards on stored kickoff times so most ticks spend ZERO API requests. When a
// match is plausibly live it pulls the live feed (1 request), updates score/status,
// and recomputes accuracy so finals score themselves.
import { runJob } from "./_common.js";
import { store } from "../store.js";
import { getLiveFixtures, normalizeStatus } from "../footballApi.js";
import { recomputeAccuracy } from "../sync.js";

const HOUR = 3600_000;

runJob("live-status", async (now) => {
  const fixtures = store.fixtures();
  const nowMs = new Date(now).getTime();

  // Plausibly in-play: kicked off, not finished, within ~3h of kickoff.
  const inWindow = fixtures.some((f) => {
    if (f.status === "finished") return false;
    const ko = new Date(f.kickoff).getTime();
    return ko <= nowMs && nowMs <= ko + 3 * HOUR;
  });

  if (!inWindow) {
    return { changed: false, summary: "no matches in a live window — skipped API call." };
  }

  const live = await getLiveFixtures();
  const liveById = new Map(live.map((r) => [String(r.fixture.id), r]));

  let updated = 0;
  const next = fixtures.map((f) => {
    const r = liveById.get(f.fixtureId);
    if (!r) return f;
    updated += 1;
    return {
      ...f,
      status: normalizeStatus(r.fixture.status.short),
      homeScore: r.goals.home,
      awayScore: r.goals.away,
      elapsed: r.fixture.status.elapsed,
    };
  });

  if (updated) {
    store.saveFixtures(next);
    recomputeAccuracy(now);
  }
  return {
    changed: updated > 0,
    summary: updated ? `updated ${updated} live fixture(s).` : "no tracked fixtures currently live.",
  };
});
