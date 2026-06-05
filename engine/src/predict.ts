// The prediction engine. Claude is the brain: it reasons from hard inputs
// (recent results, venue, market odds) plus live web-searched soft inputs
// (injuries, likely XI, news) to a structured 1X2 + scoreline prediction.
//
// Model policy (the hedge): group stage -> PREDICTION_MODEL_GROUP (Sonnet),
// knockouts -> PREDICTION_MODEL_KO (Opus).
import Anthropic from "@anthropic-ai/sdk";
import { CONFIG, requireSecret } from "./config.js";
import type {
  Fixture,
  Prediction,
  MarketTriple,
  ProbTriple,
  Confidence,
} from "./types.js";

export interface FormLine {
  date: string;
  opponent: string;
  result: string; // e.g. "2-1 W (home)"
}

export interface PredictionInputs {
  fixture: Fixture;
  market: MarketTriple | null;
  homeForm: FormLine[];
  awayForm: FormLine[];
}

const CONFIDENCES: Confidence[] = ["Low", "Medium-Low", "Medium", "Medium-High", "High"];

export function modelForStage(stage: string): string {
  return stage.startsWith("group") ? CONFIG.modelGroup : CONFIG.modelKnockout;
}

const SYSTEM_PROMPT = `You are the prediction engine for a World Cup 2026 forecasting machine.
You score one match at a time on a FIXED seven-factor rubric so that every
prediction is consistent and comparable:

1. Squad quality — depth, top-club talent, FIFA ranking.
2. Recent form — weighted to the last 5-6 matches.
3. Availability — injuries, suspensions, likely starting XI.
4. Style matchup — how the two teams' shapes interact.
5. Venue — altitude is a real edge for sides used to Mexico City / Guadalajara /
   Toluca and a real tax on sea-level teams; heat and travel matter too.
6. Rest & scheduling — days since last match, congestion, travel.
7. Stakes & pressure — what each team needs from the result.

Use the web search tool to gather CURRENT soft inputs: injuries, suspensions,
likely line-ups, manager comments and very recent form/news. The hard inputs
(recent results, venue, betting market) are provided to you — reason FROM them.
Do NOT simply copy the market; form your own view, though the market is a strong
prior. Account for draw likelihood honestly (World Cup group games draw often).

Return STRICT JSON ONLY — no prose, no markdown, no code fences. Exactly this shape:
{
  "probs": { "homeWin": <0..1>, "draw": <0..1>, "awayWin": <0..1> },   // must sum to ~1
  "scoreline": { "home": <int>, "away": <int> },                        // your single most likely score
  "confidence": "Low" | "Medium-Low" | "Medium" | "Medium-High" | "High",
  "reasoning": "<2 to 4 sentences, plain language, no jargon>"
}`;

function formBlock(label: string, form: FormLine[]): string {
  if (!form.length) return `${label}: no in-tournament matches yet (use web search for recent form).`;
  return (
    `${label} recent results:\n` +
    form.map((f) => `  - ${f.date} vs ${f.opponent}: ${f.result}`).join("\n")
  );
}

function buildUserPrompt(inp: PredictionInputs): string {
  const f = inp.fixture;
  const venue = [f.venue.name, f.venue.city, f.venue.country].filter(Boolean).join(", ") || "TBD";
  const marketLine = inp.market
    ? `Market 1X2 (de-vigged, source=${inp.market.source}): home ${inp.market.homeWin}, draw ${inp.market.draw}, away ${inp.market.awayWin}.`
    : `Market 1X2: not available yet — estimate it yourself and set market.source to "derived".`;

  return [
    `Fixture: ${f.homeTeam} (home) vs ${f.awayTeam} (away).`,
    `Stage: ${f.stage}${f.matchday ? ` (${f.matchday})` : ""}.`,
    `Kickoff (UTC): ${f.kickoff}.`,
    `Venue: ${venue}.`,
    marketLine,
    "",
    formBlock(f.homeTeam, inp.homeForm),
    formBlock(f.awayTeam, inp.awayForm),
    "",
    `Now search the web for current injuries, suspensions, likely XIs and news for both teams,`,
    `apply the seven-factor rubric, and return the strict JSON object.`,
  ].join("\n");
}

// ---- defensive JSON parsing ----
interface RawModelOutput {
  probs?: Partial<ProbTriple>;
  scoreline?: { home?: number; away?: number };
  confidence?: string;
  reasoning?: string;
}

export function parseModelJson(text: string): RawModelOutput {
  let t = text.trim();
  // strip code fences if present
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  // grab the outermost JSON object
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t) as RawModelOutput;
}

function clampNorm(p: Partial<ProbTriple>): ProbTriple {
  const h = Math.max(0, Number(p.homeWin) || 0);
  const d = Math.max(0, Number(p.draw) || 0);
  const a = Math.max(0, Number(p.awayWin) || 0);
  const sum = h + d + a;
  if (sum <= 0) return { homeWin: 0.34, draw: 0.33, awayWin: 0.33 };
  return {
    homeWin: round3(h / sum),
    draw: round3(d / sum),
    awayWin: round3(a / sum),
  };
}

function coerceConfidence(c: string | undefined): Confidence {
  const match = CONFIDENCES.find((x) => x.toLowerCase() === String(c).trim().toLowerCase());
  return match ?? "Medium";
}

function extractText(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function usedWebSearch(msg: Anthropic.Message): boolean {
  return msg.content.some((b) => b.type === "server_tool_use" || b.type === "web_search_tool_result");
}

// Deterministic stub for DRY_RUN / missing key — leans on the market when present.
function stubPrediction(inp: PredictionInputs, now: string): Prediction {
  const probs: ProbTriple = inp.market
    ? { homeWin: inp.market.homeWin, draw: inp.market.draw, awayWin: inp.market.awayWin }
    : { homeWin: 0.4, draw: 0.3, awayWin: 0.3 };
  return {
    fixtureId: inp.fixture.fixtureId,
    probs,
    scoreline: { home: 1, away: probs.awayWin > probs.homeWin ? 1 : 0 },
    confidence: "Low",
    reasoning:
      "Stub prediction (DRY_RUN or no API key): mirrors the market where available. Not a real model output.",
    market: inp.market ?? { homeWin: probs.homeWin, draw: probs.draw, awayWin: probs.awayWin, source: "derived" },
    lockedAt: null,
    modelVersion: "dry-run-stub",
    generatedAt: now,
    locked: false,
    webSearchUsed: false,
  };
}

export async function predictFixture(inp: PredictionInputs, now: string): Promise<Prediction> {
  if (CONFIG.dryRun || !CONFIG.anthropicApiKey) {
    return stubPrediction(inp, now);
  }

  const model = modelForStage(inp.fixture.stage);
  const client = new Anthropic({ apiKey: requireSecret("anthropicApiKey") });

  const msg = await client.messages.create({
    model,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    tools: [
      {
        type: CONFIG.webSearchToolType,
        name: "web_search",
        max_uses: CONFIG.webSearchMaxUses,
      } as unknown as Anthropic.Tool,
    ],
    messages: [{ role: "user", content: buildUserPrompt(inp) }],
  });

  const text = extractText(msg);
  let raw: RawModelOutput;
  try {
    raw = parseModelJson(text);
  } catch (err) {
    throw new Error(
      `Failed to parse model JSON for fixture ${inp.fixture.fixtureId}: ${(err as Error).message}\n--- raw ---\n${text.slice(0, 2000)}`
    );
  }

  const probs = clampNorm(raw.probs ?? {});
  const market: MarketTriple =
    inp.market ?? { homeWin: probs.homeWin, draw: probs.draw, awayWin: probs.awayWin, source: "derived" };

  return {
    fixtureId: inp.fixture.fixtureId,
    probs,
    scoreline: {
      home: Math.max(0, Math.round(Number(raw.scoreline?.home) || 0)),
      away: Math.max(0, Math.round(Number(raw.scoreline?.away) || 0)),
    },
    confidence: coerceConfidence(raw.confidence),
    reasoning: tidyReasoning(String(raw.reasoning ?? "")),
    market,
    lockedAt: null,
    modelVersion: model,
    generatedAt: now,
    locked: false,
    webSearchUsed: usedWebSearch(msg),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Keep reasoning tidy: trim, and if it runs long, cut at the last full sentence
// boundary (never mid-word) so the UI never shows a dangling fragment.
function tidyReasoning(raw: string): string {
  const text = raw.trim();
  if (!text) return "No reasoning returned.";
  const MAX = 700;
  if (text.length <= MAX) return text;
  const head = text.slice(0, MAX);
  const lastStop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return (lastStop > 200 ? head.slice(0, lastStop + 1) : head.replace(/\s+\S*$/, "") + "…").trim();
}
