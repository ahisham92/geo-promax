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

// ---------------------------------------------------------------- the SAFE link

import { parseDelimited, readSafe, toCells, springs, round, zonesOf, exportTables, springsFile, compare } from "../geopromax_app/static/engine/ssi.js";
import { readXlsx } from "../geopromax_app/static/engine/xlsx.js";
import { deflateRawSync } from "node:zlib";

// A raft's soil pressures the way SAFE lists them: a title, headings, a units row, one row per joint of every element.
function safeTable({ nx = 9, ny = 7, dx = 2, dy = 2, p = () => 100, units = ["m", "m", "kN/m²"], scaleL = 1, scaleP = 1, sign = -1 } = {}) {
  const rows = [["TABLE:  Soil Pressures"], ["Area", "Joint", "OutputCase", "CaseType", "GlobalX", "GlobalY", "Pressure"], ["", "", "", "", units[0], units[1], units[2]]];
  for (const kase of ["Dead", "Service"]) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = i * dx, y = j * dy, v = sign * p(x, y) * (kase === "Dead" ? 0.6 : 1);
    rows.push(["1", `${j * nx + i + 1}`, kase, "Combination", String(x / scaleL), String(y / scaleL), String(v / scaleP)]);
    if (i % 2 === 0) rows.push(["2", `${j * nx + i + 1}`, kase, "Combination", String(x / scaleL), String(y / scaleL), String(v / scaleP)]); // shared joints are listed twice
  }
  return rows;
}
const tsv = (rows) => rows.map((r) => r.join("\t")).join("\n");

test("a SAFE soil pressure table is read, whatever its units and sign", () => {
  const a = readSafe(tsv(safeTable()), { kase: "Service" });
  assert.equal(a.kind, "pressure");
  assert.deepEqual(a.cases, ["Dead", "Service"]);
  assert.equal(a.points.length, 63);
  assert.ok(a.points.every((q) => Math.abs(q.p - 100) < 1e-9));
  assert.equal(readSafe(tsv(safeTable())).points[0].p, 60); // the first case when none is asked for
  // N and mm: coordinates in mm, pressures in N/mm²
  const b = readSafe(tsv(safeTable({ units: ["mm", "mm", "N/mm²"], scaleL: 0.001, scaleP: 1000 })), { kase: "Service" });
  assert.ok(Math.abs(b.points.at(-1).x - 16) < 1e-9 && Math.abs(b.points.at(-1).p - 100) < 1e-9);
  // no units row: the system chosen on the page is used
  const plain = safeTable({ scaleL: 0.3048, scaleP: 47.88026 }).filter((_, i) => i !== 2);
  const c = readSafe(tsv(plain), { kase: "Service", units: "kip-ft" });
  assert.ok(Math.abs(c.points.at(-1).x - 16) < 1e-6 && Math.abs(c.points.at(-1).p - 100) < 1e-6);
  assert.throws(() => readSafe("a,b,c\n1,2,3"), /no column of soil pressures/);
});

test("pressures without coordinates are placed from the joints table", () => {
  const press = [["Joint", "OutputCase", "Soil Pressure"], ["", "", "kN/m²"], ["1", "S", "-80"], ["2", "S", "-120"]];
  const joints = [["Joint", "Global X", "Global Y", "Global Z"], ["", "m", "m", "m"], ["1", "0", "0", "0"], ["2", "4", "0", "0"]];
  const r = readSafe([{ name: "Soil Pressures", rows: press }, { name: "Joint Coordinates", rows: joints }]);
  assert.deepEqual(r.points, [{ x: 0, y: 0, p: 80 }, { x: 4, y: 0, p: 120 }]);
});

test("the cells keep the raft's total load, and coarsen for a fine mesh", () => {
  const pts = readSafe(tsv(safeTable({ nx: 61, ny: 41, dx: 0.5, dy: 0.5 })), { kase: "Service" }).points;
  const c = toCells(pts, "pressure", 300);
  assert.ok(c.cells.length <= 300 && c.cells.length > 150);
  // 100 kPa on a 30 m by 20 m raft: the load is kept to within 2%, and the edge cells carry less
  assert.ok(Math.abs(c.force - 60000) / 60000 < 0.02, `${c.force}`);
  assert.ok(Math.abs(c.area - 600) / 600 < 0.02);
  assert.ok(c.cells.every((x) => Math.abs(x[3] - 100) < 1e-9) && Math.min(...c.cells.map((x) => x[2])) < 80);
  const coarse = toCells(pts, "pressure", 60);
  assert.ok(coarse.cells.length <= 60 && Math.abs(coarse.force - 60000) / 60000 < 0.03, `${coarse.force}`);
});

// A stand-in for SAFE: a perfectly rigid raft on the springs it is given.
function rigidRaftOnSprings(cells, size, k, Q) {
  const sum = k.reduce((a, b) => a + b, 0) * size * size, d = Q / sum;
  return cells.map(([x, y], i) => [x, y, k[i] * d]);
}

test("soil and structure agree after a few rounds: a rigid raft ends up settling evenly", () => {
  const p = complete({ template: "blank", waterTable: 2, layers: [layerFrom("fill", 1), layerFrom("firmClay", 10), layerFrom("denseSand", 8)], loads: [] });
  const load = loadFrom("field", { Df: 1 });
  const first = toCells(readSafe(tsv(safeTable({ nx: 9, ny: 7 })), { kase: "Service" }).points);
  load.cells = first.cells; load.size = first.size;
  p.loads = [load];
  const Q = first.force;
  let before = null, history = [];
  for (let i = 0; i < 12; i++) {
    const r = round(p, load, p.life, before, { tol: 0.02 });
    history.push(r.summary);
    if (r.summary.converged) break;
    before = r.list.map((s) => [s.x, s.y, s.k]);
    load.cells = rigidRaftOnSprings(load.cells, load.size, r.list.map((s) => s.k), Q).map((c) => [c[0], c[1], c[2], c[2]]);
  }
  const last = history.at(-1);
  assert.ok(last.converged, `converged in ${history.length} rounds`);
  assert.ok(history.length <= 10);
  // uniform pressure dishes; the rigid raft's pressures settle it nearly evenly, with more pressure at the edges
  assert.ok(history[0].sMax / history[0].sMin > 1.5);
  assert.ok(last.sMax / last.sMin < 1.1, `${last.sMax / last.sMin}`);
  const near = (x, y) => load.cells.reduce((a, c) => (Math.hypot(c[0] - x, c[1] - y) < Math.hypot(a[0] - x, a[1] - y) ? c : a));
  const centre = near(8, 6), corner = near(0, 0);
  assert.ok(corner[2] > 1.2 * centre[2]);
  // the load on the raft never changes
  assert.ok(Math.abs(last.force - Q) / Q < 1e-9);
});

test("springs are banded into soil properties and written in SAFE's units", () => {
  const list = [50, 80, 120, 200, 400, null].map((k, i) => ({ x: i, y: 0, p: 100, q: 100, s: k ? 100 / k : 0, k: k && k * 100 }));
  const z = zonesOf(list, 3);
  assert.equal(z.zones.length, 3);
  assert.ok(z.zones.every((b, i) => i === 0 || b.k > z.zones[i - 1].k));
  assert.equal(z.of[5], 0); // no spring worked out: the softest band, never a hard spot
  const t = exportTables(list, 2, z, "N-mm");
  assert.match(t.props, /GPM-K1,0\.00\d+/);   // 5000 to 40000 kN/m³ is 0.005 to 0.04 N/mm³
  assert.match(t.cells.split("\r\n")[2], /^0,0,2000,0\.1,/);
  assert.equal(compare(list, list.map((s) => [s.x, s.y, s.k])).max, 0);
  const file = springsFile(list, 2, z, { project: "P", round: 2, converged: true, time: 50 });
  assert.equal(file.format, "geopromax-springs");
  assert.equal(file.units.modulus, "kN/m3");
  assert.equal(file.cells.length, 6);
  assert.equal(file.cells[0].zone, "GPM-K1");
  assert.equal(file.cells[5].modulus, null);
  assert.ok(file.zones.every((b) => b.modulus > 0));
});

test("an Excel workbook is read without any library", async () => {
  // a minimal .xlsx: stored and deflated parts, shared and inline strings
  const files = {
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="Soil Pressures" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>GlobalX</t></si><si><t>GlobalY</t></si><si><r><t>Pres</t></r><r><t>sure &amp; more</t></r></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2"><v>1.5</v></c><c r="C2"><v>-90</v></c><c r="D2" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`,
  };
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  Object.entries(files).forEach(([name, body], i) => {
    const raw = enc.encode(body), data = i % 2 ? deflateRawSync(raw) : raw, n = enc.encode(name);
    const local = new Uint8Array(30 + n.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, i % 2 ? 8 : 0, true); lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const cd = new Uint8Array(46 + n.length), cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, i % 2 ? 8 : 0, true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, off, true);
    cd.set(n, 46);
    parts.push(local, data); central.push(cd);
    off += local.length + data.length;
  });
  const cdSize = central.reduce((a, c) => a + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true);
  const zip = Buffer.concat([...parts, ...central, end]);
  const sheets = await readXlsx(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length));
  assert.equal(sheets[0].name, "Soil Pressures");
  assert.deepEqual(sheets[0].rows, [["GlobalX", "GlobalY", "Pressure & more"], ["1.5", "", "-90", "x"]]);
  await assert.rejects(readXlsx(new Uint8Array(100).buffer), /not an Excel workbook/);
});

test("a raft from SAFE is a load like any other", () => {
  const cells = toCells(readSafe(tsv(safeTable())).points);
  const p = complete({ template: "blank", loads: [{ ...loadFrom("field", { Df: 1 }), cells: cells.cells, size: cells.size }] });
  assert.equal(checks(p).filter((c) => c.level === "critical").length, 0);
  const f = foundationSummary(p, p.life)[0];
  assert.ok(f.governing > 0 && f.diff > 0 && Number.isFinite(f.tilt));
  assert.ok(checks(complete({ template: "blank", loads: [loadFrom("field")] })).some((c) => /SAFE/.test(c.text)));
  assert.equal(springs(p, p.loads[0], p.life).length, cells.cells.length);
});

// ---------------------------------------------------------------- bearing capacity

import { bearingCheck, bearingAll, netUltimate } from "../geopromax_app/static/engine/bearing.js";

test("bearing: water, depth and a soft layer below all count, and clays take the lower of drained and undrained", () => {
  const sand = (o = {}) => ({ ...layerFrom("sand", 20), ...o });
  const pad = (o = {}) => loadFrom("pad", { B: 2, L: 2, P: 1200, Df: 1, ...o });
  const fos = (layers, load, waterTable = 50) => bearingCheck(complete({ template: "blank", waterTable, layers, loads: [load] }), load).fos;
  const dry = fos([sand()], pad());
  assert.ok(fos([sand()], pad(), 0) < 0.7 * dry, "water at the surface roughly halves the capacity of sand");
  assert.ok(fos([sand()], pad({ Df: 2 })) > dry, "deeper is safer");
  assert.ok(fos([sand()], pad({ B: 3, L: 3 })) > dry, "wider is safer");
  const soft = bearingCheck(complete({ template: "blank", waterTable: 50, layers: [layerFrom("sand", 2), layerFrom("softClay", 6)], loads: [pad()] }), pad());
  assert.equal(soft.layer, "Soft clay");
  assert.equal(soft.mode, "undrained");
  assert.ok(soft.fos < 0.3 * dry && Math.abs(soft.level - 2) < 1e-9);
  // a clay with su and φ': whichever is lower
  assert.equal(netUltimate({ su: 20, phi: 25, c: 0 }, 2, 2, 1, 18, 8).mode, "undrained");
  assert.equal(netUltimate({ su: 500, phi: 25, c: 0 }, 2, 2, 1, 18, 8).mode, "drained");
  assert.equal(netUltimate({}, 2, 2, 1, 18, 8), null);
});

test("bearing: every kind of foundation gets an answer or a reason, and old projects get strengths", () => {
  for (const [type] of LOAD_TYPES) {
    const l = loadFrom(type);
    const b = bearingCheck(complete({ template: "blank", layers: [layerFrom("firmClay", 40)], loads: [l] }), l);
    if (type === "pilegroup") assert.ok(b.checked && b.pile.one.total > 0, type);
    else assert.ok(b.checked && b.fos > 0 && Number.isFinite(b.qult), type);
  }
  // a compensated raft has no net load
  const raft = loadFrom("building", { storeys: 2, Df: 4, extra: 0 });
  assert.equal(bearingCheck(complete({ template: "blank", loads: [raft] }), raft).fos, Infinity);
  // a project saved before strengths existed
  const old = complete({ layers: [{ name: "Clay", preset: "softClay", thickness: 5, gamma: 16, gammaSat: 17, E: 3000, nu: 0.35, consolidating: true }], loads: [loadFrom("rect")], limits: { preset: "embankment", total: 300, tilt: 0 } });
  assert.equal(old.layers[0].su, 20);
  assert.equal(old.limits.fos, 1.5);
  // every starting example is safe in bearing
  for (const key of Object.keys(TEMPLATES)) {
    const p = complete({ template: key });
    for (const b of bearingAll(p)) if (b && b.checked) assert.ok(b.fos >= (b.pile ? p.limits.fosPile : p.limits.fos), `${key}: ${b.fos}`);
  }
});

test("bearing: a second stage of fill is checked on top of the first, with the strength the clay has gained", () => {
  const mk = (t0, drains) => {
    const clay = { ...layerFrom("softClay", 8), drains: { ...layerFrom("softClay").drains, on: drains, spacing: 1.5 } };
    const p = complete({ template: "blank", waterTable: 0.5, layers: [clay, layerFrom("denseSand", 5)],
      loads: [loadFrom("embankment", { name: "Stage 1", H: 2 }), loadFrom("embankment", { name: "Stage 2", H: 1.5, crest: 8, t0 })] });
    return bearingAll(p);
  };
  const [one, two] = mk(1, true);
  assert.equal(one.stacked, 0);
  assert.equal(two.stacked, 1);
  assert.ok(Math.abs(two.qnet - (2 + 1.5) * 20) < 1e-9 || two.qnet < 70, "both stages are on the ground");
  assert.ok(two.gain > 0.22 * 0.8 * 40 && two.gain <= 0.22 * 40 + 1e-9);
  // sooner, or without drains, the clay has gained less and the stage is less safe
  assert.ok(mk(0.05, true)[1].fos < two.fos);
  assert.ok(mk(1, false)[1].fos < two.fos);
  assert.ok(two.fos < one.fos * 1.2);
});

// ---------------------------------------------------------------- piles

import { pileCapacity, pileCheck } from "../geopromax_app/static/engine/bearing.js";

test("piles: longer, wider and more piles carry more; driven beats bored in sand; a tight group in clay fails as a block", () => {
  const p = complete({ template: "blank", waterTable: 1, layers: [layerFrom("softClay", 8), layerFrom("stiffClay", 12), layerFrom("denseSand", 15)], loads: [] });
  const one = (L, d, how = "bored") => pileCapacity(p, 1, L, d, how).total;
  assert.ok(one(18, 0.6) > one(12, 0.6) && one(18, 0.9) > one(18, 0.6));
  assert.ok(one(22, 0.6, "driven") > one(22, 0.6, "bored"), "the toe is in sand");
  assert.equal(pileCapacity(p, 1, 22, 0.6).toeLayer, "Dense sand and gravel");
  assert.equal(pileCapacity(p, 1, 19, 0.6).toeLayer, "Dense sand and gravel", "a toe on a boundary bears on the layer below");
  assert.ok(pileCapacity(p, 1, 60, 0.6).beyond);
  const group = (o) => pileCheck(p, loadFrom("pilegroup", { Lp: 15, Df: 1, B: 6, L: 6, Q: 8000, nPiles: 9, pileD: 0.6, ...o }));
  const g = group({});
  assert.equal(g.mode, "the piles one by one");
  assert.ok(Math.abs(g.fos - (9 * g.pile.one.total) / 8000) < 1e-9);
  assert.ok(group({ nPiles: 16 }).fos > g.fos);
  // 100 piles crammed into a 2 m square: the block governs
  const tight = group({ nPiles: 100, B: 2, L: 2 });
  assert.equal(tight.mode, "the group as one block");
  assert.ok(tight.fos < (100 * tight.pile.one.total) / 8000);
  assert.match(group({ pileD: 0 }).why, /diameter/);
  assert.match(group({ Lp: 80 }).why, /below the bottom/);
  // the pile template is safe against its own limit
  const t = complete({ template: "piles" }), b = bearingAll(t)[0];
  assert.ok(b.pile && b.fos >= t.limits.fosPile, `${b.fos}`);
});
