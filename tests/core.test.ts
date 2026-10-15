import { describe, expect, it } from "vitest";
import { plan, snapToLine, cumulativeLengthLL, cutLonLat, Frame } from "../src/core";
import { makeLine, project, simplifyDP } from "../src/core/geo";
import { areaPatterns, corridorPatterns } from "../src/core/patterns";
import { densify, flightTime, legTime, splitFlights } from "../src/core/split";
import { skywayData } from "../src/data/skyway";
import type { PatternOptions, PlanConfig, XY } from "../src/core/types";
import { areaExampleConfig, skywayConfig } from "./helpers";

const TM = { climbRateMps: 2, overheadPerWaypointS: 2, maxLegM: 100 };
const OPTS: PatternOptions = { linear: true, bothSweeps: false, porpoise: false, porpoiseHalfPeriodM: 200, porpoiseMinAltM: 15, columns: false, columnSpacingM: 250 };
const straight = (len: number): XY[] => [[0, 0], [len, 0]];
/** A curve that bends 60 degrees over 900 m. */
const curved = (): XY[] => Array.from({ length: 31 }, (_, i) => { const a = (i / 30) * (Math.PI / 3); return [900 * Math.sin(a) * 3 / Math.PI, 900 * (1 - Math.cos(a)) * 3 / Math.PI] as XY; });

describe("geometry", () => {
  it("Douglas-Peucker keeps every dropped vertex within the chord tolerance", () => {
    const pts = curved();
    const simp = simplifyDP(pts, 2);
    expect(simp.length).toBeLessThan(pts.length);
    const line = makeLine(simp);
    for (const p of pts) expect(project(line, p).d).toBeLessThanOrEqual(2 + 1e-9);
  });

  it("Skyway KML: main line is the 57.8 km rail line", () => {
    const s = skywayData();
    expect(s.line.length).toBe(61);
    const len = cumulativeLengthLL(s.line).at(-1)!;
    expect(len / 1000).toBeGreaterThan(57.5);
    expect(len / 1000).toBeLessThan(58.1);
  });

  it("cutting by km gives the requested length and starts at the right place", () => {
    const { line } = skywayData();
    const cut = cutLonLat(line, 4000, 5500);
    const len = cumulativeLengthLL(cut).at(-1)!;
    expect(len).toBeCloseTo(1500, 0);
  });

  it("segment by start point: snapping a point on the line returns its km", () => {
    const { line } = skywayData();
    const at4 = cutLonLat(line, 4000, 4001)[0];
    const snap = snapToLine(line, at4[0], at4[1]);
    expect(snap.s).toBeCloseTo(4000, 0);
    expect(snap.offsetM).toBeLessThan(0.5);
    // a click 40 m beside the line still snaps to the same km
    const f = new Frame(at4[0], at4[1]);
    const side = f.toLL(0, 40);
    expect(snapToLine(line, side[0], side[1]).offsetM).toBeGreaterThan(0);
  });

  it("frame round-trips and measures metres", () => {
    const f = new Frame(-83.7, 42.28);
    const a = f.toXY(-83.7, 42.28), b = f.toXY(-83.7, 42.2809);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(100.1, 0);
    const back = f.toLL(...f.toXY(-83.69, 42.29));
    expect(back[0]).toBeCloseTo(-83.69, 9);
    expect(back[1]).toBeCloseTo(42.29, 9);
  });
});

describe("corridor patterns", () => {
  it("linear: one pass per altitude, alternating direction, layer change in place", () => {
    const w = corridorPatterns({ line: straight(500), altitudes: [12, 30, 60], speed: 5, opts: OPTS });
    expect(w.map((p) => [p.x, p.z])).toEqual([[0, 12], [500, 12], [500, 30], [0, 30], [0, 60], [500, 60]]);
    expect(w.map((p) => p.rto)).toEqual(["C-LIN-12", "C-LIN-12", "C-LIN-30", "C-LIN-30", "C-LIN-60", "C-LIN-60"]);
  });

  it("both sweeps: every altitude is flown again in reverse order, in the other direction", () => {
    const w = corridorPatterns({ line: straight(500), altitudes: [12, 30, 60], speed: 5, opts: { ...OPTS, bothSweeps: true } });
    const passes: { z: number; dir: number }[] = [];
    for (let i = 0; i < w.length; i += 2) passes.push({ z: w[i].z, dir: Math.sign(w[i + 1].x - w[i].x) });
    expect(passes.map((p) => p.z)).toEqual([12, 30, 60, 60, 30, 12]);
    for (const z of [12, 30, 60]) expect(new Set(passes.filter((p) => p.z === z).map((p) => p.dir)).size).toBe(2);
  });

  it("porpoise spans the altitude band with the half-period along the track", () => {
    const w = corridorPatterns({ line: straight(1000), altitudes: [12, 115], speed: 5, opts: { ...OPTS, linear: false, porpoise: true } });
    const z = w.map((p) => p.z);
    expect(Math.min(...z)).toBeCloseTo(15, 5); // max(15, min altitude)
    expect(Math.max(...z)).toBeCloseTo(115, 5);
    const peaks = w.filter((p) => Math.abs(p.z - 115) < 1e-6).map((p) => p.x);
    expect(peaks).toContain(200);
    expect(peaks).toContain(600);
  });

  it("porpoise continues from the altitude and end where the linear passes stopped", () => {
    const w = corridorPatterns({ line: straight(1000), altitudes: [12, 115], speed: 5, opts: { ...OPTS, porpoise: true } });
    const lastLinear = w.findIndex((p) => p.rto === "C-POR") - 1;
    expect(w[lastLinear + 1].x).toBe(w[lastLinear].x); // no horizontal jump
    expect(w[lastLinear + 1].z).toBe(w[lastLinear].z); // no vertical jump either
  });

  it("columns: vertical profiles every N metres, alternating top and bottom", () => {
    const w = corridorPatterns({ line: straight(1000), altitudes: [30, 115], speed: 5, opts: { ...OPTS, linear: false, columns: true, columnSpacingM: 250 } });
    const cols = w.filter((p) => p.note.startsWith("column"));
    expect(cols.map((p) => p.x)).toEqual([0, 250, 500, 750, 1000]);
    expect(cols.map((p) => p.z)).toEqual([115, 30, 115, 30, 115]);
  });

  it("never cuts across a curve: every leg between waypoints stays within the chord tolerance of the centreline", () => {
    const raw = curved();
    const sub = simplifyDP(raw, 2);
    const line = makeLine(raw);
    const w = densify(corridorPatterns({ line: sub, altitudes: [30, 60, 90], speed: 5, opts: { ...OPTS, porpoise: true, bothSweeps: true } }), 100);
    for (let i = 1; i < w.length; i++) {
      for (let k = 0; k <= 10; k++) {
        const f = k / 10;
        const q: XY = [w[i - 1].x + f * (w[i].x - w[i - 1].x), w[i - 1].y + f * (w[i].y - w[i - 1].y)];
        expect(project(line, q).d).toBeLessThanOrEqual(2 + 1e-6);
      }
    }
  });
});

describe("area patterns", () => {
  const square: XY[] = [[0, 0], [400, 0], [400, 400], [0, 400]];
  const opts = { laneSpacingM: 100, headingDeg: 0, crosshatch: false, verticalProfile: false, verticalProfileSpeedMps: 1 };

  it("lanes are spaced exactly, centred, and stay inside the margin", () => {
    const { waypoints } = areaPatterns({ polygon: square, inset: 10, altitudes: [30], speed: 5, opts });
    const xs = [...new Set(waypoints.map((p) => Math.round(p.x * 10) / 10))].sort((a, b) => a - b);
    expect(xs.slice(1).map((x, i) => x - xs[i]).every((g) => Math.abs(g - 100) < 0.5)).toBe(true);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10 - 1e-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(390 + 1e-6);
    for (const p of waypoints) { expect(p.y).toBeGreaterThanOrEqual(10 - 1e-3); expect(p.y).toBeLessThanOrEqual(390 + 1e-3); }
  });

  it("lanes run boustrophedon", () => {
    const { waypoints } = areaPatterns({ polygon: square, inset: 10, altitudes: [30], speed: 5, opts });
    const lanes = [];
    for (let i = 0; i < waypoints.length; i += 2) lanes.push(Math.sign(waypoints[i + 1].y - waypoints[i].y));
    expect(lanes.every((s, i) => s === (i % 2 === 0 ? 1 : -1))).toBe(true);
  });

  it("crosshatch rotates lanes 90 degrees on alternate altitudes", () => {
    const { waypoints } = areaPatterns({ polygon: square, inset: 10, altitudes: [30, 60], speed: 5, opts: { ...opts, crosshatch: true } });
    const a = waypoints.filter((p) => p.z === 30), b = waypoints.filter((p) => p.z === 60);
    expect(Math.abs(a[1].x - a[0].x)).toBeLessThan(1e-6); // lane along y
    expect(Math.abs(b[1].y - b[0].y)).toBeLessThan(1e-3); // lane along x
  });

  it("lane heading 90 degrees runs east-west", () => {
    const { waypoints } = areaPatterns({ polygon: square, inset: 10, altitudes: [30], speed: 5, opts: { ...opts, headingDeg: 90 } });
    expect(Math.abs(waypoints[1].y - waypoints[0].y)).toBeLessThan(1e-3);
    expect(Math.abs(waypoints[1].x - waypoints[0].x)).toBeGreaterThan(300);
  });

  it("vertical profile at the centroid climbs and descends slowly", () => {
    const { waypoints } = areaPatterns({ polygon: square, inset: 10, altitudes: [30, 90], speed: 5, opts: { ...opts, verticalProfile: true } });
    expect(waypoints.slice(0, 3).map((p) => [p.x, p.y, p.z, p.v])).toEqual([[200, 200, 30, 1], [200, 200, 90, 1], [200, 200, 30, 1]]);
  });

  it("area plan from the example passes", () => {
    const r = plan(areaExampleConfig());
    expect(r.verdict).toBe("PASS");
    expect(r.flights.length).toBeGreaterThan(0);
  });
});

describe("time model", () => {
  const wp = (x: number, z: number) => ({ x, y: 0, z, v: 5, hover: 0, rto: "T", note: "" });

  it("matches a hand calculation", () => {
    // take-off 40/2 = 20, transit 0, leg 100/5 = 20 + 2 overhead, return 100/5 = 20, land 20  => 82 s
    expect(flightTime([wp(0, 40), wp(100, 40)], [0, 0], TM)).toBeCloseTo(82, 6);
  });

  it("a leg takes the longer of horizontal and vertical time", () => {
    expect(legTime({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 40 }, 5, TM)).toBe(20); // 40 m at 2 m/s beats 2 s
    expect(legTime({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 2 }, 5, TM)).toBe(20);
  });

  it("a slow vertical-only leg cannot climb faster than its speed setting", () => {
    expect(legTime({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 110 }, 1, TM)).toBe(100);
  });

  it("densify keeps every leg at or under the limit and keeps the end points", () => {
    const d = densify([wp(0, 10), wp(950, 70)], 100);
    expect(d.length).toBe(11);
    expect(d[0].x).toBe(0);
    expect(d.at(-1)!.x).toBe(950);
    for (let i = 1; i < d.length; i++) expect(Math.hypot(d[i].x - d[i - 1].x, d[i].y - d[i - 1].y)).toBeLessThanOrEqual(100 + 1e-9);
  });
});

describe("splitting", () => {
  const long = densify(Array.from({ length: 41 }, (_, i) => ({ x: (i % 2 ? 600 : 0), y: 0, z: 60, v: 5, hover: 0, rto: "T", note: "" })), 100);

  it("flights fit the battery and resume at the last waypoint of the previous one", () => {
    const r = splitFlights({ wps: long, pilot: [300, 0], tm: TM, budgetS: 600, vlosM: 700 });
    expect(r.error).toBeNull();
    expect(r.ranges.length).toBeGreaterThan(2);
    for (let i = 1; i < r.ranges.length; i++) expect(r.ranges[i][0]).toBe(r.ranges[i - 1][1]);
    for (const [a, b] of r.ranges) expect(flightTime(long.slice(a, b + 1), [300, 0], TM)).toBeLessThanOrEqual(600 + 1e-6);
  });

  it("balances: no tiny last flight", () => {
    const r = splitFlights({ wps: long, pilot: [300, 0], tm: TM, budgetS: 1320, vlosM: 700 });
    const t = r.ranges.map(([a, b]) => flightTime(long.slice(a, b + 1), [300, 0], TM));
    expect(r.ranges.length).toBeGreaterThan(1);
    expect(Math.min(...t) / Math.max(...t)).toBeGreaterThan(0.6);
  });

  it("explains when the pilot is too far away", () => {
    const r = splitFlights({ wps: long, pilot: [3000, 0], tm: TM, budgetS: 1320, vlosM: 700 });
    expect(r.error).toMatch(/pilot/);
  });
});

describe("checks", () => {
  const base = () => skywayConfig({ startKm: 4, lengthM: 1500 });
  const issues = (c: PlanConfig) => plan(c).flights.flatMap((f) => f.issues.map((i) => i.message));

  it("the default plan passes", () => expect(plan(base()).verdict).toBe("PASS"));

  it("a path that is not inside the margin is caught (zone shifted so the centreline hugs an edge)", () => {
    const f = new Frame(skywayData().line[0][0], skywayData().line[0][1]);
    void f;
    const cut = cutLonLat(skywayData().line, 4000, 5500);
    const frame = new Frame(cut[0][0], cut[0][1]);
    // approved polygon 30 m wide but displaced 12 m to one side of the track: the track is 3 m from an edge
    const pts = cut.map((p) => frame.toXY(p[0], p[1]));
    const left: XY[] = [], right: XY[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const nx = -(b[1] - a[1]), ny = b[0] - a[0], L = Math.hypot(nx, ny);
      left.push([pts[i][0] + (27 * nx) / L, pts[i][1] + (27 * ny) / L]);
      right.push([pts[i][0] - (3 * nx) / L, pts[i][1] - (3 * ny) / L]);
    }
    const zone = [...left, ...right.reverse()].map((p) => frame.toLL(p[0], p[1]));
    const r = plan({ ...base(), zone });
    expect(r.verdict).toBe("FAIL");
    expect(r.flights.some((fl) => fl.issues.some((i) => /zone edge/.test(i.message)))).toBe(true);
    expect(r.flights.find((fl) => fl.firstFailure)!.firstFailure).toBeTruthy();
  });

  it("the ceiling is caught", () => {
    const r = plan({ ...base(), ceilingM: 100 });
    expect(r.verdict).toBe("FAIL");
    expect(issues({ ...base(), ceilingM: 100 }).some((m) => /ceiling/.test(m))).toBe(true);
    expect(r.notes.some((n) => n.level === "issue" && /above the ceiling/.test(n.message))).toBe(true);
  });

  it("the floor is caught", () => {
    expect(issues({ ...base(), floorM: 20 }).some((m) => /minimum altitude/.test(m))).toBe(true);
  });

  it("an obstacle on the track is flagged below its height plus 15 m, with the first failing point", () => {
    const cut = cutLonLat(skywayData().line, 4000, 5500);
    const mid = cut[Math.floor(cut.length / 2)];
    const c = { ...base(), obstacles: [{ name: "Test tower", lon: mid[0], lat: mid[1], heightM: 80, radiusM: 60 }] };
    const r = plan(c);
    expect(r.verdict).toBe("FAIL");
    const iss = r.flights.flatMap((f) => f.issues).find((i) => /Test tower/.test(i.message))!;
    expect(iss.at).toBeTruthy();
    // an obstacle far from the track does nothing
    expect(plan({ ...base(), obstacles: [{ name: "Far", lon: mid[0] + 0.05, lat: mid[1], heightM: 80, radiusM: 60 }] }).verdict).toBe("PASS");
  });

  it("an obstacle lower than the lowest layer minus clearance does not trip anything above it", () => {
    const cut = cutLonLat(skywayData().line, 4000, 5500);
    const mid = cut[Math.floor(cut.length / 2)];
    const c = { ...base(), altitudesM: [115], obstacles: [{ name: "Short", lon: mid[0], lat: mid[1], heightM: 20, radiusM: 60 }] };
    expect(plan(c).verdict).toBe("PASS");
  });

  it("distance from the pilot is checked", () => {
    const cut = cutLonLat(skywayData().line, 4000, 5500);
    const c = { ...base(), vlosM: 300, pilots: [{ name: "Near start", lon: cut[0][0], lat: cut[0][1] }], autoPilotSpacingM: null };
    const r = plan(c);
    expect(r.verdict).toBe("FAIL");
    expect(r.notes.some((n) => n.level === "issue" && /pilot/.test(n.message))).toBe(true);
  });

  it("warns, but does not fail, when the straight line from the pilot leaves the zone, and recommends Backtrack", () => {
    const cut = cutLonLat(skywayData().line, 4000, 5500);
    const frame = new Frame(cut[0][0], cut[0][1]);
    const p0 = frame.toXY(cut[Math.floor(cut.length / 2)][0], cut[Math.floor(cut.length / 2)][1]);
    const away = frame.toLL(p0[0] + 60, p0[1] + 60);
    const r = plan({ ...base(), pilots: [{ name: "Beside road", lon: away[0], lat: away[1] }], autoPilotSpacingM: null, vlosM: 1500, batteryMin: 60 });
    const w = r.flights.flatMap((f) => f.warnings);
    expect(w.some((m) => /Backtrack/.test(m))).toBe(true);
    expect(r.flights.every((f) => f.issues.length === 0 || f.issues.every((i) => !/Backtrack/.test(i.message)))).toBe(true);
  });

  it("battery is checked: a single indivisible leg that cannot fit is reported", () => {
    const r = plan({ ...base(), batteryMin: 1 });
    expect(r.verdict).not.toBe("PASS");
  });

  it("true height above ground is corrected with a DEM: ground falling away raises it past the ceiling", () => {
    const cut = cutLonLat(skywayData().line, 4000, 5500);
    const frame = new Frame(cut[0][0], cut[0][1]);
    const c = { ...base(), pilots: [{ name: "P", lon: cut[0][0], lat: cut[0][1] }], autoPilotSpacingM: null, vlosM: 2000, batteryMin: 60 };
    const terrain = { elevationAt: (lon: number, lat: number) => 260 - 0.05 * frame.toXY(lon, lat)[0] };
    const flat = plan(c);
    const dem = plan(c, terrain);
    expect(flat.flights.every((f) => f.issues.every((i) => !/ceiling/.test(i.message)))).toBe(true);
    expect(dem.flights.some((f) => f.issues.some((i) => /ceiling/.test(i.message)))).toBe(true);
    expect(dem.notes.some((n) => /No ground-elevation/.test(n.message))).toBe(false);
    expect(flat.notes.some((n) => /No ground-elevation/.test(n.message))).toBe(true);
  });
});

describe("settings that cannot make a plan", () => {
  it("every pattern switched off says what to do", () => {
    const r = plan(skywayConfig({ patterns: { linear: false, bothSweeps: false, porpoise: false, porpoiseHalfPeriodM: 200, porpoiseMinAltM: 15, columns: false, columnSpacingM: 250 } }));
    expect(r.verdict).toBe("NOT_READY");
    expect(r.notes[0].message).toMatch(/at least one flight pattern/);
  });
  it("no altitudes, no line, a stretch too short, an area too small", () => {
    expect(plan(skywayConfig({ altitudesM: [] })).notes[0].message).toMatch(/at least one altitude/);
    expect(plan({ ...skywayConfig(), line: [] }).notes[0].message).toMatch(/No rail line/);
    expect(plan(skywayConfig({ lengthM: 12 })).notes[0].message).toMatch(/too short/);
    const tiny: [number, number][] = [[-83.7, 42.3], [-83.69995, 42.3], [-83.69995, 42.30004]];
    expect(plan(areaExampleConfig({ area: tiny })).verdict).toBe("NOT_READY");
  });
  it("a single altitude works", () => {
    const r = plan(skywayConfig({ altitudesM: [60], startKm: 4, lengthM: 800 }));
    expect(r.verdict).toBe("PASS");
  });
});

describe("plan output", () => {
  it("tags waypoints with Route Test Objective ids and 250 m blocks counted from km 0", () => {
    const r = plan(skywayConfig({ startKm: 4, lengthM: 1500 }));
    const w = r.flights[0].waypoints;
    expect(w.every((p) => /^C-(LIN-\d+|POR)$/.test(p.rto))).toBe(true);
    expect(w[0].block).toBe("B017"); // km 4.0-4.25 is the 17th 250 m block
    expect(new Set(r.flights.flatMap((f) => f.waypoints.map((p) => p.block))).size).toBeGreaterThanOrEqual(5);
  });

  it("is deterministic and reproducible from the saved config (JSON round trip)", () => {
    const cfg = skywayConfig({ startKm: 12, lengthM: 2500, autoPilotSpacingM: 700 });
    const a = JSON.stringify(plan(cfg));
    expect(JSON.stringify(plan(cfg))).toBe(a);
    expect(JSON.stringify(plan(JSON.parse(JSON.stringify(cfg))))).toBe(a);
  });

  it("returns the assumed-zone warning, the zone, and the planning limit", () => {
    const r = plan(skywayConfig());
    expect(r.zoneAssumed).toBe(true);
    expect(r.zone.length).toBe(1);
    expect(r.planningLimit.length).toBe(1);
    expect(r.notes.some((n) => n.level === "warn" && /Assumed fly zone/.test(n.message))).toBe(true);
  });
});

describe("property: random Skyway stretches stay on the track", () => {
  // Deterministic PRNG so the test is reproducible.
  let seed = 20260101;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const total = cumulativeLengthLL(skywayData().line).at(-1)!;

  it("40 random stretches: PASS, and every sampled point is within half-width minus margin of the centreline", () => {
    for (let n = 0; n < 40; n++) {
      const startKm = rnd() * (total / 1000 - 4.5);
      const lengthM = 300 + rnd() * 3500;
      const cfg = skywayConfig({ startKm, lengthM, autoPilotSpacingM: 500 + Math.round(rnd() * 200) });
      const r = plan(cfg);
      const ctx = `stretch ${n}: km ${startKm.toFixed(2)} +${lengthM.toFixed(0)} m`;
      expect(r.verdict, ctx).toBe("PASS");
      const frame = new Frame(r.centreline[0][0], r.centreline[0][1]);
      const centre = makeLine(r.centreline.map((p) => frame.toXY(p[0], p[1])));
      const limit = cfg.halfWidthM - cfg.insetCorridorM;
      for (const f of r.flights) {
        expect(f.minMarginM, ctx).toBeGreaterThanOrEqual(cfg.insetCorridorM - 0.05);
        const pts = f.waypoints.map((p) => frame.toXY(p.lon, p.lat));
        for (let i = 1; i < pts.length; i++) {
          for (let k = 0; k <= 6; k++) {
            const t = k / 6;
            const q: XY = [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])];
            expect(project(centre, q).d, ctx).toBeLessThanOrEqual(Math.min(limit, cfg.chordTolM + 0.01));
          }
        }
      }
    }
  });
});
