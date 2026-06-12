// live-status — cron every 15 minutes, but each workflow run is a SESSION: while
// a match is in play the workflow re-invokes this job and pushes every change.
// The job signals "keep going" by writing .live-session containing a
// budget-aware poll interval in seconds; no file means nothing is live (or the
// budget is spent) and the session ends. Guards on stored kickoff times so idle
// ticks spend ZERO API requests.
import fs from "node:fs";
import path from "node:path";
import { runJob } from "./_common.js";
import { store } from "../store.js";
import { CONFIG } from "../config.js";
import { getLiveFixtures, normalizeStatus } from "../footballApi.js";
import { recomputeAccuracy } from "../sync.js";
import type { Fixture } from "../types.js";

const HOUR = 3600_000;
// Jobs always run from engine/ via npm, so this lands next to package.json.
const SESSION_FLAG = path.join(process.cwd(), ".live-session");
// Epoch seconds of the next future kickoff — the workflow heartbeat uses it to
// sleep until just before a match starts instead of polling blind.
const NEXT_KICKOFF_FLAG = path.join(process.cwd(), ".next-kickoff");

// Plausibly in-play: kicked off, not finished, within ~3h of kickoff.
function inLiveWindow(fixtures: Fixture[], nowMs: number): boolean {
  return fixtures.some((f) => {
    if (f.status === "finished") return false;
    const ko = new Date(f.kickoff).getTime();
    return ko <= nowMs && nowMs <= ko + 3 * HOUR;
  });
}

function budgetUsedToday(nowIso: string): number {
  const af = store.meta().apiFootball;
  return af.dayUtc === nowIso.slice(0, 10) ? af.requestsToday : 0;
}

// Poll as fast as the day's remaining API budget can sustain: 5 min with plenty
// of headroom, easing off as the soft cap approaches so late matches still get
// (slower) coverage instead of none.
function pollIntervalSeconds(nowIso: string): number {
  const remaining = CONFIG.dailyRequestSoftCap - budgetUsedToday(nowIso);
  if (remaining > 40) return 300;
  if (remaining > 20) return 480;
  return 600;
}

function writeNextKickoff(fixtures: Fixture[], nowMs: number): void {
  const future = fixtures
    .filter((f) => f.status !== "finished")
    .map((f) => new Date(f.kickoff).getTime())
    .filter((t) => t > nowMs);
  if (future.length) {
    fs.writeFileSync(NEXT_KICKOFF_FLAG, String(Math.floor(Math.min(...future) / 1000)));
  } else {
    fs.rmSync(NEXT_KICKOFF_FLAG, { force: true });
  }
}

runJob("live-status", async (now) => {
  fs.rmSync(SESSION_FLAG, { force: true });
  const fixtures = store.fixtures();
  const nowMs = new Date(now).getTime();
  writeNextKickoff(fixtures, nowMs);

  if (!inLiveWindow(fixtures, nowMs)) {
    return { changed: false, summary: "no matches in a live window — skipped API call." };
  }
  if (CONFIG.dailyRequestSoftCap - budgetUsedToday(now) <= 0) {
    return { changed: false, summary: "daily API budget exhausted — session ends." };
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

  // Keep the session alive while anything is still in a live window.
  if (inLiveWindow(updated ? next : fixtures, Date.now())) {
    fs.writeFileSync(SESSION_FLAG, String(pollIntervalSeconds(now)));
  }
  return {
    changed: updated > 0,
    summary: updated ? `updated ${updated} live fixture(s).` : "no tracked fixtures currently live.",
  };
});
