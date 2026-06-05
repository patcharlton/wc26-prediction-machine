// Tournament-winner forecast. Re-runs as the tournament progresses (wired into
// daily-housekeeping), so the champion pick adapts to results, form and the
// firming-up bracket. Uses the knockout model (Opus) since it's a big-picture
// call made at most once a day.
import Anthropic from "@anthropic-ai/sdk";
import { CONFIG, requireSecret } from "./config.js";
import { store } from "./store.js";
import { parseModelJson } from "./predict.js";
import type { WinnerPrediction, WinnerContender, Confidence } from "./types.js";

const CONFIDENCES: Confidence[] = ["Low", "Medium-Low", "Medium", "Medium-High", "High"];

const SYSTEM = `You are the tournament-winner forecaster for a World Cup 2026 prediction machine.
Forecast who will WIN the whole tournament, adapting to the current state provided.
Use the web search tool to pull current outright/futures odds, squad strength,
injuries and form. Weigh: squad quality and depth, current tournament form and
results so far, the draw/bracket path difficulty, host advantage (USA/Canada/Mexico)
and venue/altitude/travel, and manager/tournament pedigree.

Return STRICT JSON ONLY — no prose, no markdown, no code fences:
{
  "champion": "<team>",
  "runnerUp": "<team>",
  "darkHorse": "<a lower-ranked team you rate as a live outsider>",
  "confidence": "Low" | "Medium-Low" | "Medium" | "Medium-High" | "High",
  "contenders": [ { "team": "<team>", "prob": <0..1> }, ... up to 8, highest first ],
  "reasoning": "<3 to 5 sentences, plain language, why this pick and the main threats>"
}
Probabilities are outright-win chances and need not sum to 1 (the rest is the field).`;

function buildContext(): { phase: string; prompt: string } {
  const standings = store.standings();
  const groupKeys = Object.keys(standings).sort();
  const results = store.results().filter((r) => r.status === "finished" && r.actualOutcome);
  const played = results.length;

  let phase: string;
  if (played === 0) phase = "pre-tournament";
  else if (played < 72) phase = `group stage (${played} matches played)`;
  else phase = "knockout stage";

  const groupLines = groupKeys.map((k) => {
    const letter = k.slice(5);
    const rows = [...standings[k]!].sort((a, b) => a.rank - b.rank);
    const anyPlayed = rows.some((r) => r.played > 0);
    const teams = rows
      .map((r) => (anyPlayed ? `${r.team} ${r.points}pts (${r.win}-${r.draw}-${r.lose}, GD ${r.goalDiff})` : r.team))
      .join("; ");
    return `Group ${letter}: ${teams}`;
  });

  const recentResults = results
    .slice(-12)
    .map((r) => `${r.homeTeam} ${r.actualScore.home}-${r.actualScore.away} ${r.awayTeam}`);

  const prompt = [
    `Tournament phase: ${phase}.`,
    `Hosts: USA, Canada, Mexico (Mexico's venues are at altitude — Mexico City ~2,240m).`,
    "",
    "Groups and current standings:",
    ...groupLines,
    played > 0 ? "\nRecent results:\n" + recentResults.join("\n") : "\nNo matches have kicked off yet.",
    "",
    "Search the web for current outright odds, squads, injuries and form, then return the strict JSON champion forecast.",
  ].join("\n");

  return { phase, prompt };
}

function coerceConfidence(c: string | undefined): Confidence {
  return CONFIDENCES.find((x) => x.toLowerCase() === String(c).trim().toLowerCase()) ?? "Low";
}

function normalizeContenders(raw: unknown): WinnerContender[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => ({
      team: String((c as WinnerContender)?.team ?? "").trim(),
      prob: Math.max(0, Math.min(1, Number((c as WinnerContender)?.prob) || 0)),
    }))
    .filter((c) => c.team)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 8)
    .map((c) => ({ team: c.team, prob: Math.round(c.prob * 1000) / 1000 }));
}

// Cut over-long reasoning at the last full sentence (never mid-word).
function tidy(raw: string): string {
  const t = raw.trim();
  if (!t) return "No reasoning returned.";
  const MAX = 1000;
  if (t.length <= MAX) return t;
  const head = t.slice(0, MAX);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return (stop > 300 ? head.slice(0, stop + 1) : head.replace(/\s+\S*$/, "") + "…").trim();
}

function stub(phase: string, now: string): WinnerPrediction {
  return {
    champion: "TBD",
    runnerUp: null,
    darkHorse: null,
    confidence: "Low",
    contenders: [],
    reasoning: "Stub winner forecast (DRY_RUN or no API key). Set ANTHROPIC_API_KEY to generate a real one.",
    basis: phase,
    modelVersion: "dry-run-stub",
    updatedAt: now,
  };
}

export async function predictTournamentWinner(now: string): Promise<WinnerPrediction> {
  const { phase, prompt } = buildContext();
  if (CONFIG.dryRun || !CONFIG.anthropicApiKey) return stub(phase, now);

  const model = CONFIG.modelKnockout; // big-picture call -> Opus
  const client = new Anthropic({ apiKey: requireSecret("anthropicApiKey") });
  const msg = await client.messages.create({
    model,
    max_tokens: 1600,
    system: SYSTEM,
    tools: [
      { type: CONFIG.webSearchToolType, name: "web_search", max_uses: CONFIG.webSearchMaxUses } as unknown as Anthropic.Tool,
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const raw = parseModelJson(text) as Record<string, unknown>;
  const contenders = normalizeContenders(raw.contenders);

  return {
    champion: String(raw.champion ?? contenders[0]?.team ?? "TBD").trim(),
    runnerUp: raw.runnerUp ? String(raw.runnerUp).trim() : null,
    darkHorse: raw.darkHorse ? String(raw.darkHorse).trim() : null,
    confidence: coerceConfidence(raw.confidence as string | undefined),
    contenders,
    reasoning: tidy(String(raw.reasoning ?? "")),
    basis: phase,
    modelVersion: model,
    updatedAt: now,
  };
}
