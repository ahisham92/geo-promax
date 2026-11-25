// The calculation engine, in Node: node --test tests/engine.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { runChecks } from "../geopromax_app/static/engine/verify.js";
import { complete, checks, resultChecks, TEMPLATES, PRESET_KEYS, LOAD_TYPES, STRUCTURES, layerFrom, loadFrom, padGrid, describeLoad } from "../geopromax_app/static/engine/project.js";
import { computePoint, solvePoint, settlementAt, settlementGrid, stressSection, timeCurve, stagesOf, timeFactor, foundationSummary, betweenFoundations, timeTo } from "../geopromax_app/static/engine/settlement.js";
import { extents, outline, loadToRects, checkPoints, loadForce } from "../geopromax_app/static/engine/stress.js";

for (const c of runChecks()) {
  test(`${c.group}: ${c.name}`, () => {
    assert.ok(c.pass, `expected ${c.expected}, got ${c.got} (tolerance ${c.tol})`);
  });
}

test("every template completes and settles", () => {
  for (const key of Object.keys(TEMPLATES)) {
    const p = complete({ template: key });
    const r = solvePoint(p, p.loads[0].x, p.loads[0].y);
    const s = settlementAt(r, p.life);
    assert.ok(s.total > 0 && Number.isFinite(s.total), key);
    assert.notEqual(r.converged, false, `${key} converges`);
    for (const f of foundationSummary(p, p.life)) assert.ok(Number.isFinite(f.governing) && Number.isFinite(f.tilt), `${key}: ${f.name}`);
    assert.equal(checks(p).filter((c) => c.level === "critical").length, 0, key);
  }
});

test("every starting example is a design that meets its own limits", () => {
  for (const key of Object.keys(TEMPLATES)) {
    const p = complete({ template: key });
    const f = foundationSummary(p, p.life);
    const worst = Math.max(...f.map((x) => x.governing)), tilt = Math.max(betweenFoundations(p, f).tilt, ...f.map((x) => x.tilt));
    assert.ok(worst * 1000 <= p.limits.total, `${key}: ${(worst * 1000).toFixed(0)} mm against ${p.limits.total}`);
    if (p.limits.tilt > 0) assert.ok(tilt <= 1 / p.limits.tilt, `${key}: tilt 1/${(1 / tilt).toFixed(0)} against 1/${p.limits.tilt}`);
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
  const s = stressSection(p, "x", 0, -30, 30, 20, 31, 11);
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

test("every kind of load makes stress, has an outline and check points", () => {
  for (const [type] of LOAD_TYPES) {
    const l = loadFrom(type);
    const p = complete({ template: "blank", layers: [layerFrom("firmClay", 40)], loads: [l] });
    assert.equal(checks(p).filter((c) => c.level === "critical").length, 0, type);
    const [cx, cy] = checkPoints(l).centre;
    const r = computePoint(p, cx, cy);
    assert.ok(r.immediate + r.primary > 0, `${type} settles`);
    assert.ok(outline(l).length >= 1 && loadForce(l) > 0 && describeLoad(l).length > 3, type);
  }
});

test("every typical soil gives a finite answer, and softer soils settle more", () => {
  const settle = (key) => {
    const p = complete({ template: "blank", waterTable: 1, layers: [layerFrom(key, 10)], loads: [loadFrom("rect", { B: 10, L: 10, q: 100 })] });
    const r = solvePoint(p, 0, 0);
    const s = settlementAt(r, 50).total;
    assert.ok(Number.isFinite(s) && s > 0, key);
    return s;
  };
  const all = Object.fromEntries(PRESET_KEYS.map((k) => [k, settle(k)]));
  assert.ok(all.peat > all.softClay && all.softClay > all.firmClay && all.firmClay > all.stiffClay && all.stiffClay > all.hardClay);
  assert.ok(all.looseSand > all.sand && all.sand > all.denseSand && all.denseSand > all.rock && all.rock > all.soundRock);
});

test("a rotated footing settles the same at its centre, and a quarter turn swaps its sides", () => {
  const base = complete({ template: "blank", loads: [loadFrom("rect", { B: 4, L: 8, q: 100 })] });
  const turned = complete({ template: "blank", loads: [loadFrom("rect", { B: 4, L: 8, q: 100, angle: 37 })] });
  const a = computePoint(base, 0, 0).primary, b = computePoint(turned, 0, 0).primary;
  assert.ok(Math.abs(a - b) / a < 0.01);
  const quarter = complete({ template: "blank", loads: [loadFrom("rect", { B: 4, L: 8, q: 100, angle: 90 })] });
  assert.ok(Math.abs(computePoint(base, 0, 3).primary - computePoint(quarter, 3, 0).primary) < 1e-9);
});

test("wick drains speed consolidation up without changing where it ends", () => {
  const p = complete({ template: "drains" });
  const q = JSON.parse(JSON.stringify(p)); q.layers[1].drains.on = false;
  const a = solvePoint(p, 0, 0), b = solvePoint(q, 0, 0);
  assert.ok(Math.abs(a.primary - b.primary) < 1e-12);
  assert.ok(settlementAt(a, 1).primary > 1.5 * settlementAt(b, 1).primary);
  assert.ok(timeTo(p.layers[1], 0.9) < timeTo(q.layers[1], 0.9) / 5);
});

test("founding deeper and net pressure both reduce settlement", () => {
  const mk = (o) => complete({ template: "blank", layers: [layerFrom("firmClay", 20)], loads: [loadFrom("rect", { B: 10, L: 10, q: 100, ...o })] });
  const s = (o) => { const r = solvePoint(mk(o), 0, 0); return r.immediate + r.primary; };
  assert.ok(s({}) > s({ Df: 2 }) && s({ Df: 2 }) > s({ Df: 2, net: true }));
  // a load lighter than the soil dug out makes the ground heave, and the checks say so
  const light = mk({ q: 20, Df: 3, net: true });
  assert.ok(solvePoint(light, 0, 0).primary < 0);
  assert.ok(checks(light).some((c) => /heaves/.test(c.text)));
});

test("soil that stays overconsolidated creeps less, by Cr/Cc", () => {
  const mk = (OCR) => complete({ template: "blank", waterTable: 0, layers: [{ ...layerFrom("firmClay", 6), OCR, POP: 0 }], loads: [loadFrom("rect", { B: 30, L: 30, q: 20 })] });
  const creep = (OCR) => computePoint(mk(OCR), 0, 0).layers[0].creep;
  const l = mk(1).layers[0];
  assert.ok(Math.abs(creep(50) / creep(1) - l.Cr / l.Cc) < 0.02);
});

test("a pad grid has the columns asked for, and the building template is judged per footing", () => {
  assert.equal(padGrid({ nx: 5, ny: 4 }).length, 20);
  const p = complete({ template: "building" });
  const f = foundationSummary(p, p.life);
  assert.equal(f.length, 12);
  assert.ok(f.every((x) => x.rigid !== null && x.governing > 0));
});

test("the checks speak up", () => {
  const p = complete({ template: "blank", layers: [layerFrom("softClay", 3)], loads: [loadFrom("rect", { B: 30, L: 30, q: 100 })] });
  assert.ok(resultChecks(p, solvePoint(p, 0, 0)).some((c) => /bottom of the profile/.test(c.text)));
  const piles = complete({ template: "blank", loads: [loadFrom("pilegroup", { Lp: 40 })] });
  assert.ok(checks(piles).some((c) => c.level === "critical" && /equivalent raft/.test(c.text)));
  const bad = complete({ template: "blank", loads: [loadFrom("polygon", { pts: "0,0" }), loadFrom("ring", { R: 3, Ri: 5 })] });
  assert.equal(checks(bad).filter((c) => c.level === "critical").length, 2);
  assert.ok(STRUCTURES.every((s) => s[2] > 0 && s[3] >= 0));
});

test("bad numbers never become NaN", () => {
  const p = complete({ template: "blank" });
  p.layers[0].E = null; p.layers[0].nu = 0.5; p.layers[1].e0 = null; p.layers[1].cv = null; p.loads[0].B = null;
  p.loads.push(loadFrom("pad", { B: 0, P: 100 }), loadFrom("circle", { R: null }), loadFrom("pilegroup", { Lp: null, Q: null }));
  const r = solvePoint(p, 0, 0), s = settlementAt(r, 10);
  assert.ok(Number.isFinite(s.total));
  for (const f of foundationSummary(p, 10)) assert.ok(Number.isFinite(f.governing), f.name);
});
