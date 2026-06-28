// Knockout "beat the game" engine. For each knockout match the external game lets
// you make 3 predictions for up to 7 points:
//   1) who advances (after ET/pens)            -> 1 pt
//   2) score after regulation (90')            -> 3 exact / 1 outcome
//   3) score after extra time (120'), if ET    -> 3 exact / 1 outcome (0 if no ET)
//
// Copying one scoreline into all three is wasteful: pred3 only pays when the match
// reaches ET, which only happens when regulation is a draw. So we optimise each
// prediction as its own bet on its own branch (EV-max). Claude supplies probability
// DISTRIBUTIONS; this module computes the EV-optimal trio deterministically.
import Anthropic from "@anthropic-ai/sdk";
import { CONFIG, requireSecret } from "./config.js";
import { parseModelJson } from "./predict.js";
import { store } from "./store.js";
import type {
  Fixture, KoScore, KoDistributions, KnockoutEntry, KnockoutGame, ScoreProb, MarketTriple,
} from "./types.js";
import type { FormLine } from "./predict.js";

// ---------- pure helpers (EV optimisation) ----------
type Outcome = "H" | "D" | "A";
const outcomeOf = (h: number, a: number): Outcome => (h > a ? "H" : h < a ? "A" : "D");
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function cleanScores(arr: unknown): ScoreProb[] {
  if (!Array.isArray(arr)) return [];
  const out = arr
    .map((s) => ({
      home: Math.max(0, Math.round(Number((s as ScoreProb)?.home))),
      away: Math.max(0, Math.round(Number((s as ScoreProb)?.away))),
      prob: Math.max(0, Number((s as ScoreProb)?.prob) || 0),
    }))
    .filter((s) => Number.isFinite(s.home) && Number.isFinite(s.away) && s.prob > 0);
  const total = out.reduce((s, x) => s + x.prob, 0);
  if (total <= 0) return [];
  return out.map((s) => ({ ...s, prob: s.prob / total })); // normalise to sum 1
}

function outcomeMass(scores: ScoreProb[]): Record<Outcome, number> {
  const m: Record<Outcome, number> = { H: 0, D: 0, A: 0 };
  for (const s of scores) m[outcomeOf(s.home, s.away)] += s.prob;
  return m;
}

// EV of predicting score s over a distribution: P(outcome(s)) + 2*P(exact s).
function bestScore(scores: ScoreProb[]): { pick: { home: number; away: number }; ev: number } {
  const mass = outcomeMass(scores);
  let best = { pick: { home: 0, away: 0 }, ev: -1 };
  for (const s of scores) {
    const ev = mass[outcomeOf(s.home, s.away)] + 2 * s.prob;
    if (ev > best.ev) best = { pick: { home: s.home, away: s.away }, ev };
  }
  return best;
}

export interface OptimisedPicks {
  pred1Advance: "home" | "away";
  pred2Reg: { home: number; away: number };
  pred3Et: { home: number; away: number };
  ev: { p1: number; p2: number; p3: number; total: number };
  pEtUsed: number;
}

// Compute the EV-maximising trio + expected points from the model's distributions.
export function optimizeEntry(dist: KoDistributions): OptimisedPicks {
  // Pred 1: most likely advancer.
  const aH = Math.max(0, dist.advance?.home ?? 0);
  const aA = Math.max(0, dist.advance?.away ?? 0);
  const advSum = aH + aA || 1;
  const pHome = aH / advSum;
  const pAway = aA / advSum;
  const pred1Advance: "home" | "away" = pHome >= pAway ? "home" : "away";
  const ev1 = Math.max(pHome, pAway);

  // Pred 2: best 90' score.
  const reg = cleanScores(dist.regulation);
  const reg2 = bestScore(reg);

  // P(extra time) = regulation draw mass (internally consistent), fallback to the
  // model's own extraTimeProb if regulation has no draw scores listed.
  const regMass = outcomeMass(reg);
  const pEt = regMass.D > 0 ? regMass.D : Math.max(0, Math.min(1, dist.extraTimeProb ?? 0));

  // Pred 3: best 120' score given ET; contribution is gated by P(ET).
  const et = cleanScores(dist.extraTime);
  const et3 = et.length ? bestScore(et) : { pick: { home: 0, away: 0 }, ev: 0 };
  const ev3 = pEt * et3.ev;

  return {
    pred1Advance,
    pred2Reg: reg2.pick,
    pred3Et: et3.pick,
    ev: { p1: r3(ev1), p2: r3(reg2.ev), p3: r3(ev3), total: r3(ev1 + reg2.ev + ev3) },
    pEtUsed: r3(pEt),
  };
}

// ---------- realised scoring ----------
function scorePick(pick: { home: number; away: number }, actual: { home: number; away: number }): number {
  if (pick.home === actual.home && pick.away === actual.away) return 3; // exact
  if (outcomeOf(pick.home, pick.away) === outcomeOf(actual.home, actual.away)) return 1; // outcome
  return 0;
}

export function scoreEntry(
  entry: Pick<KnockoutEntry, "pred1Advance" | "pred2Reg" | "pred3Et">,
  ko: KoScore
): { p1: number; p2: number; p3: number; total: number } {
  const p1 = ko.advanced && entry.pred1Advance === ko.advanced ? 1 : 0;
  const p2 = ko.rt ? scorePick(entry.pred2Reg, ko.rt) : 0;
  const p3 = ko.et ? scorePick(entry.pred3Et, ko.et) : 0; // 0 if no extra time
  return { p1, p2, p3, total: p1 + p2 + p3 };
}

// ---------- Anthropic call ----------
export interface KoInputs {
  fixture: Fixture;
  market: MarketTriple | null;
  homeForm: FormLine[];
  awayForm: FormLine[];
}

const SYSTEM = `You are the knockout-stage forecaster for a World Cup 2026 prediction machine.
For a single knockout match you must output probability DISTRIBUTIONS that another
program will use to maximise expected points in this game (up to 7 per match):
  1) which team advances (after extra time / penalties) — 1 pt if correct;
  2) score after REGULATION (90') — 3 pts exact score, else 1 pt for correct outcome;
  3) score after EXTRA TIME (120'), only if extra time is played — 3 pts exact, else 1 pt
     outcome; 0 if no extra time. The 120' score = regulation score + extra-time goals.
Extra time happens only when regulation is a draw. A shootout only decides who advances.

Use the web search tool for current form, injuries, likely line-ups and match odds.
Return STRICT JSON ONLY — no prose, no markdown, no code fences:
{
  "advance": { "home": <0..1>, "away": <0..1> },           // sums ~1, includes ET/pens
  "regulation": [ { "home": <int>, "away": <int>, "prob": <0..1> }, ... ],  // top ~10 90' scores; probs sum ~1
  "extraTimeProb": <0..1>,                                  // P(match reaches extra time)
  "extraTime": [ { "home": <int>, "away": <int>, "prob": <0..1> }, ... ],   // top ~8 *120'* scores GIVEN extra time; probs sum ~1 (conditional)
  "reasoning": "<2-4 sentences, plain language>"
}
Regulation draws (e.g. 0-0, 1-1) should carry realistic mass — knockout games often go to extra time.
Extra-time scores are the FULL 120' score and must be >= a plausible regulation draw.`;

function formBlock(label: string, form: FormLine[]): string {
  if (!form.length) return `${label}: no in-tournament matches recorded (use web search).`;
  return `${label} recent: ` + form.map((f) => `${f.date} vs ${f.opponent} ${f.result}`).join("; ");
}

function buildUserPrompt(inp: KoInputs): string {
  const f = inp.fixture;
  const venue = [f.venue.name, f.venue.city, f.venue.country].filter(Boolean).join(", ") || "TBD";
  const market = inp.market
    ? `Market 1X2 (de-vigged): home ${inp.market.homeWin}, draw ${inp.market.draw}, away ${inp.market.awayWin}.`
    : "Market 1X2: not available — estimate from your own analysis.";
  return [
    `Knockout match (${f.stage}): ${f.homeTeam} (home) vs ${f.awayTeam} (away).`,
    `Kickoff (UTC): ${f.kickoff}. Venue: ${venue}.`,
    market,
    formBlock(f.homeTeam, inp.homeForm),
    formBlock(f.awayTeam, inp.awayForm),
    "",
    "Search the web for current team news, then return the strict JSON distributions.",
  ].join("\n");
}

export function parseDistributions(text: string): KoDistributions {
  const raw = parseModelJson(text) as Record<string, unknown>;
  const adv = (raw.advance ?? {}) as { home?: number; away?: number };
  return {
    advance: { home: Number(adv.home) || 0, away: Number(adv.away) || 0 },
    regulation: cleanScores(raw.regulation),
    extraTimeProb: Math.max(0, Math.min(1, Number(raw.extraTimeProb) || 0)),
    extraTime: cleanScores(raw.extraTime),
  };
}

function stubDistributions(inp: KoInputs): KoDistributions {
  // DRY_RUN / no key: lean on the market for a deterministic placeholder.
  const m = inp.market ?? { homeWin: 0.45, draw: 0.27, awayWin: 0.28, source: "derived" as const };
  return {
    advance: { home: m.homeWin + m.draw / 2, away: m.awayWin + m.draw / 2 },
    regulation: [
      { home: 1, away: 0, prob: m.homeWin * 0.6 },
      { home: 0, away: 0, prob: m.draw * 0.5 },
      { home: 1, away: 1, prob: m.draw * 0.5 },
      { home: 0, away: 1, prob: m.awayWin * 0.6 },
      { home: 2, away: 1, prob: m.homeWin * 0.4 },
      { home: 1, away: 2, prob: m.awayWin * 0.4 },
    ],
    extraTimeProb: m.draw,
    extraTime: [
      { home: 1, away: 1, prob: 0.4 },
      { home: 1, away: 0, prob: 0.3 },
      { home: 0, away: 1, prob: 0.3 },
    ],
  };
}

function assemble(
  inp: KoInputs, dist: KoDistributions, now: string, model: string, webSearchUsed: boolean, reasoning: string
): KnockoutEntry {
  const opt = optimizeEntry(dist);
  const f = inp.fixture;
  return {
    fixtureId: f.fixtureId,
    stage: f.stage,
    homeTeam: f.homeTeam,
    awayTeam: f.awayTeam,
    kickoff: f.kickoff,
    pred1Advance: opt.pred1Advance,
    pred1Team: opt.pred1Advance === "home" ? f.homeTeam : f.awayTeam,
    pred2Reg: opt.pred2Reg,
    pred3Et: opt.pred3Et,
    ev: opt.ev,
    pEtUsed: opt.pEtUsed,
    distributions: dist,
    reasoning,
    modelVersion: model,
    generatedAt: now,
    lockedAt: null,
    locked: false,
    webSearchUsed,
    actual: null,
    scored: null,
  };
}

export async function predictKnockoutEntry(inp: KoInputs, now: string): Promise<KnockoutEntry> {
  if (CONFIG.dryRun || !CONFIG.anthropicApiKey) {
    return assemble(inp, stubDistributions(inp), now, "dry-run-stub", false,
      "Stub knockout entry (DRY_RUN or no API key).");
  }
  const model = CONFIG.modelKnockout;
  const client = new Anthropic({ apiKey: requireSecret("anthropicApiKey") });
  const msg = await client.messages.create({
    model,
    max_tokens: 2000,
    system: SYSTEM,
    tools: [{ type: CONFIG.webSearchToolType, name: "web_search", max_uses: CONFIG.webSearchMaxUses } as unknown as Anthropic.Tool],
    messages: [{ role: "user", content: buildUserPrompt(inp) }],
  });
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
  const dist = parseDistributions(text);
  const reasoning = (() => {
    try { return String((parseModelJson(text) as { reasoning?: string }).reasoning ?? "").trim().slice(0, 600); }
    catch { return ""; }
  })() || "No reasoning returned.";
  const webSearchUsed = msg.content.some((b) => b.type === "server_tool_use" || b.type === "web_search_tool_result");
  return assemble(inp, dist, now, model, webSearchUsed, reasoning);
}

// Self-score every entry against the played match's koScore and refresh the summary.
// Reads from the store; safe to call every run (no API calls).
export function recomputeKnockoutGame(now: string): void {
  const game = store.knockoutGame();
  if (!game || game.entries.length === 0) return;
  const koByFixture = new Map(store.fixtures().map((f) => [f.fixtureId, f.koScore ?? null]));

  let machinePoints = 0;
  let matchesScored = 0;
  let expectedTotal = 0;
  const entries = game.entries.map((e) => {
    expectedTotal += e.ev?.total ?? 0;
    const ko = koByFixture.get(e.fixtureId) ?? e.actual ?? null;
    if (ko && ko.advanced) {
      const scored = scoreEntry(e, ko);
      machinePoints += scored.total;
      matchesScored += 1;
      return { ...e, actual: ko, scored };
    }
    return { ...e, actual: ko, scored: null };
  });

  const next: KnockoutGame = {
    entries,
    summary: {
      matchesScored,
      machinePoints,
      maxPoints: matchesScored * 7,
      expectedTotal: Math.round(expectedTotal * 100) / 100,
      lastUpdatedAt: now,
    },
  };
  store.saveKnockoutGame(next);
}

export function upsertEntry(game: KnockoutGame | null, entry: KnockoutEntry): KnockoutGame {
  const base: KnockoutGame = game ?? {
    entries: [],
    summary: { matchesScored: 0, machinePoints: 0, maxPoints: 0, expectedTotal: 0, lastUpdatedAt: entry.generatedAt },
  };
  const idx = base.entries.findIndex((e) => e.fixtureId === entry.fixtureId);
  const entries = idx === -1 ? [...base.entries, entry] : base.entries.map((e, i) => (i === idx ? entry : e));
  return { ...base, entries };
}
