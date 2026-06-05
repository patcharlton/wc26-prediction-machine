// Central config: env vars, constants, time windows.
import path from "node:path";
import { fileURLToPath } from "node:url";

// Repo root, resolved from this module's location (engine/src/config.ts -> repo).
// Robust regardless of the process working directory (jobs, CI, etc.).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    return "";
  }
  return v;
}

export const CONFIG = {
  // --- secrets ---
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  footballApiKey: env("FOOTBALL_API_KEY"),
  renderDeployHook: env("RENDER_DEPLOY_HOOK"),

  // --- model policy (the hedge) ---
  modelGroup: env("PREDICTION_MODEL_GROUP", "claude-sonnet-4-6"),
  modelKnockout: env("PREDICTION_MODEL_KO", "claude-opus-4-8"),

  // --- tournament constants (API-Football) ---
  leagueId: 1,
  season: 2026,
  tournamentStartsAt: "2026-06-11T00:00:00Z",

  // --- behaviour ---
  // When true the engine never calls Anthropic; it emits a deterministic stub
  // prediction. Used for local dev / CI smoke tests without burning budget.
  dryRun: env("DRY_RUN") === "1",

  // --- time windows ---
  predictWindowHours: 48, // generate a prediction once a fixture is within this window
  lockWindowHours: 2, // freeze the prediction ~this long before kickoff

  // --- web search ---
  webSearchToolType: "web_search_20250305" as const,
  webSearchMaxUses: 5,

  // --- API-Football safety ---
  dailyRequestSoftCap: 80, // brief target: stay under 80/day (hard cap is 100)

  // --- paths ---
  dataDir: env("DATA_DIR", path.join(REPO_ROOT, "data")),
} as const;

export const FOOTBALL_BASE = "https://v3.football.api-sports.io";

export function requireSecret(name: "anthropicApiKey" | "footballApiKey"): string {
  const v = CONFIG[name];
  if (!v) {
    throw new Error(
      `Missing required secret ${name}. Set it as an env var / GitHub Actions secret.`
    );
  }
  return v;
}
