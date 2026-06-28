import { test } from "node:test";
import assert from "node:assert/strict";
import { optimizeEntry, scoreEntry } from "../src/knockoutGame.js";
import type { KoScore, KoDistributions } from "../src/types.js";

// Home = Team A, Away = Team B in all four brief examples.
function entry(adv: "home" | "away", reg: [number, number], et: [number, number]) {
  return { pred1Advance: adv, pred2Reg: { home: reg[0], away: reg[1] }, pred3Et: { home: et[0], away: et[1] } };
}
function ko(rt: [number, number] | null, et: [number, number] | null, advanced: "home" | "away" | null): KoScore {
  return {
    rt: rt ? { home: rt[0], away: rt[1] } : null,
    et: et ? { home: et[0], away: et[1] } : null,
    pens: null,
    advanced,
  };
}

test("brief example 1 → 7 points (advance + exact reg + exact ET)", () => {
  const s = scoreEntry(entry("home", [0, 0], [1, 1]), ko([0, 0], [1, 1], "home"));
  assert.deepEqual(s, { p1: 1, p2: 3, p3: 3, total: 7 });
});

test("brief example 2 → 1 point (only ET outcome right)", () => {
  // Pred B advances / 3:2 reg / 0:0 ET. Actual A advances / 0:0 reg / 2:2 ET.
  const s = scoreEntry(entry("away", [3, 2], [0, 0]), ko([0, 0], [2, 2], "home"));
  assert.deepEqual(s, { p1: 0, p2: 0, p3: 1, total: 1 });
});

test("brief example 3 → 2 points (advance + reg outcome, no ET)", () => {
  const s = scoreEntry(entry("home", [1, 0], [1, 1]), ko([2, 0], null, "home"));
  assert.deepEqual(s, { p1: 1, p2: 1, p3: 0, total: 2 });
});

test("brief example 4 → 0 points", () => {
  const s = scoreEntry(entry("away", [2, 1], [0, 1]), ko([0, 0], [0, 0], "home"));
  assert.deepEqual(s, { p1: 0, p2: 0, p3: 0, total: 0 });
});

test("no extra time ⇒ pred3 always scores 0 even if it 'matches'", () => {
  const s = scoreEntry(entry("home", [1, 0], [1, 0]), ko([1, 0], null, "home"));
  assert.equal(s.p3, 0);
  assert.equal(s.total, 4); // 1 advance + 3 exact reg
});

test("2022 final breakdown (Argentina win on pens) scores correctly", () => {
  // rt 2-2, ET goals 1-1 ⇒ 120' score 3-3, pens ⇒ home advances.
  const final = ko([2, 2], [3, 3], "home");
  // A perfect entry:
  assert.deepEqual(scoreEntry(entry("home", [2, 2], [3, 3]), final), { p1: 1, p2: 3, p3: 3, total: 7 });
  // Right advancer + right outcomes but wrong exact scores:
  assert.deepEqual(scoreEntry(entry("home", [1, 1], [2, 2]), final), { p1: 1, p2: 1, p3: 1, total: 3 });
});

test("optimizeEntry: favourite ⇒ decisive reg pick, draw-conditioned ET pick (pred2 ≠ pred3)", () => {
  const dist: KoDistributions = {
    advance: { home: 0.8, away: 0.2 },
    regulation: [
      { home: 1, away: 0, prob: 0.3 }, { home: 2, away: 0, prob: 0.15 }, { home: 2, away: 1, prob: 0.12 },
      { home: 0, away: 0, prob: 0.12 }, { home: 1, away: 1, prob: 0.12 },
      { home: 0, away: 1, prob: 0.1 }, { home: 1, away: 2, prob: 0.09 },
    ],
    extraTimeProb: 0.25,
    extraTime: [
      { home: 1, away: 1, prob: 0.4 }, { home: 2, away: 1, prob: 0.25 }, { home: 1, away: 2, prob: 0.2 },
      { home: 1, away: 0, prob: 0.1 }, { home: 0, away: 1, prob: 0.05 },
    ],
  };
  const o = optimizeEntry(dist);
  assert.equal(o.pred1Advance, "home");
  assert.deepEqual(o.pred2Reg, { home: 1, away: 0 }); // decisive favourite
  assert.deepEqual(o.pred3Et, { home: 1, away: 1 }); // draw-conditioned ET
  assert.notDeepEqual(o.pred2Reg, o.pred3Et); // the whole point
  assert.equal(o.pEtUsed, 0.24); // regulation draw mass (0.12 + 0.12)
  // EV1=0.8, EV2=massH(0.57)+2*0.3=1.17, EV3=0.24*(0.4+2*0.4)=0.288 ⇒ total ~2.258
  assert.ok(Math.abs(o.ev.total - 2.258) < 0.01, `total ev ${o.ev.total}`);
});

test("optimizeEntry: EV2 prefers correct outcome over a long-shot exact score", () => {
  const dist: KoDistributions = {
    advance: { home: 0.6, away: 0.4 },
    // 1-0 has highest outcome support; 3-3 is a tiny exact spike that must NOT win.
    regulation: [
      { home: 1, away: 0, prob: 0.25 }, { home: 2, away: 0, prob: 0.2 }, { home: 2, away: 1, prob: 0.15 },
      { home: 0, away: 0, prob: 0.1 }, { home: 3, away: 3, prob: 0.3 },
    ],
    extraTimeProb: 0.1,
    extraTime: [{ home: 1, away: 1, prob: 1 }],
  };
  const o = optimizeEntry(dist);
  // massH = .25+.2+.15 = .6; EV(1-0)=.6+.5=1.1 vs EV(3-3)=massD(.4)+2*.3=1.0 ⇒ pick 1-0.
  assert.deepEqual(o.pred2Reg, { home: 1, away: 0 });
});
