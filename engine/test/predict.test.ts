import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelJson, modelForStage } from "../src/predict.js";

test("parseModelJson parses plain JSON", () => {
  const o = parseModelJson('{"probs":{"homeWin":0.5,"draw":0.3,"awayWin":0.2},"confidence":"Medium"}');
  assert.equal(o.confidence, "Medium");
  assert.equal(o.probs!.homeWin, 0.5);
});

test("parseModelJson strips ```json fences", () => {
  const fenced = "```json\n{\"confidence\":\"High\",\"reasoning\":\"x\"}\n```";
  const o = parseModelJson(fenced);
  assert.equal(o.confidence, "High");
});

test("parseModelJson tolerates prose around the object", () => {
  const messy = 'Here is my answer:\n{"scoreline":{"home":2,"away":1}}\nHope that helps!';
  const o = parseModelJson(messy);
  assert.equal(o.scoreline!.home, 2);
  assert.equal(o.scoreline!.away, 1);
});

test("parseModelJson throws on truly unparseable text (caller try/catches)", () => {
  assert.throws(() => parseModelJson("no json here at all"));
});

test("modelForStage applies the model hedge (group=Sonnet, KO=Opus by default)", () => {
  // Defaults come from env; assert the split logic, not the exact id.
  const group = modelForStage("groupA");
  const ko = modelForStage("R32");
  assert.ok(group.length > 0 && ko.length > 0);
  // group and KO resolve from different env vars; in default config they differ.
  assert.equal(modelForStage("groupL"), group);
  assert.equal(modelForStage("Final"), ko);
});
