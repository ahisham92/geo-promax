// The calculation engine, in Node: node --test tests/engine.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { runChecks } from "../geopromax_app/static/engine/verify.js";
import { complete, checks, TEMPLATES, PRESET_KEYS, layerFrom } from "../geopromax_app/static/engine/project.js";
import { computePoint, settlementAt, settlementGrid, stressSection, timeCurve, stagesOf, timeFactor } from "../geopromax_app/static/engine/settlement.js";
import { extents, outline, loadToRects } from "../geopromax_app/static/engine/stress.js";

for (const c of runChecks()) {
  test(`${c.group}: ${c.name}`, () => {
    assert.ok(c.pass, `expected ${c.expected}, got ${c.got} (tolerance ${c.tol})`);
  });
}

test("every template completes and settles", () => {
  for (const key of Object.keys(TEMPLATES)) {
    const p = complete({ template: key });
    const r = computePoint(p, p.query.x, p.query.y);
    const s = settlementAt(r, p.life);
    assert.ok(s.total > 0 && Number.isFinite(s.total), key);
    assert.equal(checks(p).filter((c) => c.level === "critical").length, 0, key);
  }
});

test("settlement grows with time and never goes back", () => {
  const p = complete({ template: "embankment" });
  const curve = timeCurve(computePoint(p, 0, 0), 100);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i].total >= curve[i - 1].total - 1e-12);
});

test("the grid is symmetric for a load centred on the origin", () => {
  const p = complete({ template: "tank" });
  const g = settlementGrid(p, { x1: -30, x2: 30, y1: -30, y2: 30, nx: 9, ny: 9 }, 10);
  for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) {
    assert.ok(Math.abs(g.values[j * 9 + i] - g.values[j * 9 + (8 - i)]) < 1e-9);
    assert.ok(Math.abs(g.values[j * 9 + i] - g.values[(8 - j) * 9 + i]) < 1e-9);
  }
  assert.equal(g.max, g.values[4 * 9 + 4]);
});

test("stress bulbs are largest under the load", () => {
  const p = complete({ template: "foundation" });
  const s = stressSection(p, 0, -30, 30, 20, 31, 11);
  const mid = s.values[1 * 31 + 15], edge = s.values[1 * 31 + 0];
  assert.ok(mid > edge);
});

test("stages are sorted, and a later load waits for its time", () => {
  const p = complete({ template: "blank" });
  p.loads = [{ type: "rect", x: 0, y: 0, B: 10, L: 10, q: 50, t0: 3 }, { type: "rect", x: 0, y: 0, B: 10, L: 10, q: 50, t0: 0 }];
  assert.deepEqual(stagesOf(p.loads).map((s) => s.t), [0, 3]);
  const r = computePoint(p, 0, 0);
  assert.ok(settlementAt(r, 2.9).immediate < settlementAt(r, 3.1).immediate);
});

test("switched off loads do nothing", () => {
  const p = complete({ template: "foundation" });
  p.loads.forEach((l) => { l.on = false; });
  assert.equal(computePoint(p, 0, 0).primary, 0);
  assert.ok(checks(p).some((c) => /no loads/.test(c.text)));
});

test("helpers", () => {
  assert.ok(Math.abs(timeFactor(0.9) - 0.848) < 2e-3);
  for (const k of PRESET_KEYS) assert.ok(layerFrom(k).gamma > 0, k);
  const e = extents([{ type: "rect", x: 0, y: 0, B: 10, L: 10, q: 1 }], 5);
  assert.deepEqual(e, { x1: -10, x2: 10, y1: -10, y2: 10 });
  assert.equal(outline({ type: "embankment", crest: 10, slope: 5, L: 20 }).length, 2);
  // circle strips keep the area of the circle
  const area = loadToRects({ type: "circle", R: 5, q: 1 }).reduce((a, r) => a + (r.x2 - r.x1) * (r.y2 - r.y1), 0);
  assert.ok(Math.abs(area - Math.PI * 25) < 1e-9);
});
