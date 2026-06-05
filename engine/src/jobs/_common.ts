// Shared job scaffolding: timestamped run wrapper that records lastRun in meta,
// triggers the optional Render redeploy, and exits non-zero on failure.
import { store } from "../store.js";
import { triggerRenderDeploy } from "../sync.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export async function runJob(
  name: string,
  fn: (now: string) => Promise<{ changed: boolean; summary: string }>
): Promise<void> {
  const now = nowIso();
  console.log(`\n=== ${name} @ ${now} ===`);
  try {
    const { changed, summary } = await fn(now);

    const meta = store.meta();
    meta.lastRun[name] = now;
    store.saveMeta(meta);

    console.log(`[${name}] ${summary}`);
    if (changed) await triggerRenderDeploy();
    console.log(`=== ${name} done ===\n`);
  } catch (err) {
    console.error(`[${name}] FAILED:`, err);
    process.exit(1);
  }
}
