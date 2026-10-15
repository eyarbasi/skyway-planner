/**
 * Golden cases from the Python reference (wpplan). tests/golden/wpplan_golden.json was produced by
 * running wpplan on its own examples (see docs/golden.md). Flight counts must match exactly;
 * durations and lengths within a few percent (the reference has no flight balancing and uses UTM).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { plan, planStrict } from "../../src/core";
import { areaExampleConfig, corridorExampleConfig, skywayConfig } from "../helpers";

interface Golden {
  n: number; total_min: number; path_km: number; pass: boolean;
  sorties: { wps: number; min: number; path_m: number; edge_margin: number; max_vlos: number }[];
}
const G = JSON.parse(readFileSync(join(__dirname, "wpplan_golden.json"), "utf8")) as Record<string, Golden>;

/**
 * Combined linear + porpoise: the reference restarts the saw-tooth at its lowest altitude (a ~50 s vertical
 * drop after the top layer); this planner continues the saw-tooth from the current altitude, so it is a little
 * faster, never slower. Balancing also moves split points, which changes take-off/landing time.
 */
const COMBINED = { timeTol: 0.12, neverSlower: true };

const within = (a: number, b: number, rel: number) => Math.abs(a - b) <= rel * Math.abs(b);

function compareToGolden(name: string, cfg: Parameters<typeof plan>[0], opts: { timeTol?: number; neverSlower?: boolean } = {}) {
  const g = G[name];
  const r = plan(cfg);
  expect(r.verdict, name).toBe(g.pass ? "PASS" : "FAIL");
  if (opts.neverSlower) expect(r.flights.reduce((s, f) => s + f.timeS, 0) / 60, `${name}: not slower than reference`).toBeLessThanOrEqual(g.total_min + 1e-6);
  expect(r.flights.length, `${name}: flight count`).toBe(g.n);
  const totalMin = r.flights.reduce((s, f) => s + f.timeS, 0) / 60;
  const km = r.flights.reduce((s, f) => s + f.lengthM, 0) / 1000;
  expect(within(totalMin, g.total_min, opts.timeTol ?? 0.03), `${name}: total ${totalMin.toFixed(2)} vs ${g.total_min.toFixed(2)} min`).toBe(true);
  expect(within(km, g.path_km, 0.02), `${name}: path ${km.toFixed(2)} vs ${g.path_km.toFixed(2)} km`).toBe(true);
  return r;
}

const only = (k: "linear" | "porpoise" | "columns") => ({
  linear: k === "linear", porpoise: k === "porpoise", columns: k === "columns", bothSweeps: false,
  porpoiseHalfPeriodM: 200, porpoiseMinAltM: 15, columnSpacingM: 250,
});

describe("golden: single patterns match the reference closely", () => {
  const cases: [string, "linear" | "porpoise" | "columns", number, number, number | undefined][] = [
    ["skyway_km0_1.5_linear_only", "linear", 0, 1500, undefined],
    ["skyway_km0_1.5_porpoise_only", "porpoise", 0, 1500, undefined],
    ["skyway_km0_1.5_columns_only", "columns", 0, 1500, undefined],
    ["skyway_km20_3000_linear_only", "linear", 20, 3000, 600],
    ["skyway_km20_3000_porpoise_only", "porpoise", 20, 3000, 600],
  ];
  for (const [name, kind, km, len, spacing] of cases) {
    it(name, () => {
      const r = compareToGolden(name, skywayConfig({ startKm: km, lengthM: len, patterns: only(kind), ...(spacing ? { autoPilotSpacingM: spacing } : {}) }));
      const g = G[name];
      r.flights.forEach((f, i) => expect(Math.abs(f.waypoints.length - g.sorties[i].wps), `${name} flight ${i + 1} waypoint count`).toBeLessThanOrEqual(2));
    });
  }
});

describe("golden: Skyway stretches (assumed zone)", () => {
  it("km 0-1.5 with 3 placeholder pilots", () => {
    const r = compareToGolden("skyway_km0_1.5", skywayConfig({ startKm: 0, lengthM: 1500 }), COMBINED);
    expect(r.notes.some((n) => /Assumed fly zone/.test(n.message))).toBe(true);
    expect(r.zoneAssumed).toBe(true);
  });
  it("km 4 from a start km, 1.5 km", () => compareToGolden("skyway_km4_1.5", skywayConfig({ startKm: 4, lengthM: 1500 }), COMBINED));
  it("km 20, 3 km, pilots every 600 m", () => compareToGolden("skyway_km20_3000", skywayConfig({ startKm: 20, lengthM: 3000, autoPilotSpacingM: 600 }), COMBINED));
  it("km 40, 1.2 km, one pilot", () => compareToGolden("skyway_km40_1200_one_pilot", skywayConfig({ startKm: 40, lengthM: 1200, autoPilotSpacingM: 5000 }), COMBINED));
  it("one pilot too far from the ends cannot fly the stretch (reference raises)", () => {
    expect(G["skyway_one_pilot_too_far_raises"]).toBeTruthy();
    const r = plan(skywayConfig({ startKm: 40, lengthM: 2000, autoPilotSpacingM: 5000 }));
    expect(r.verdict).not.toBe("PASS");
    expect(r.notes.some((n) => n.level === "issue" && /pilot/i.test(n.message))).toBe(true);
  });
});

describe("golden: wpplan corridor example (approved zone)", () => {
  it("matches flight count, duration and margins", () => {
    const g = G["corridor_example"];
    const r = compareToGolden("corridor_example", corridorExampleConfig(), COMBINED);
    expect(r.flights.every((f) => f.issues.length === 0)).toBe(true);
    for (const f of r.flights) expect(f.minMarginM).toBeGreaterThanOrEqual(5 - 0.05);
    expect(Math.max(...r.flights.map((f) => f.maxAltM))).toBeLessThanOrEqual(121.9);
    expect(g.sorties.length).toBe(r.flights.length);
  });
  it("short battery splits into many flights that resume where the last stopped", () => {
    const g = G["corridor_8min"];
    const cfg = corridorExampleConfig({ batteryMin: 8 });
    const r = plan(cfg);
    // reference ran with section_by_station off and the best pilot per flight; we compare shape, not count
    expect(r.flights.length).toBeGreaterThan(3);
    expect(g.n).toBeGreaterThan(3);
    for (const f of r.flights) expect(f.timeS).toBeLessThanOrEqual(8 * 60 + 1e-6);
    for (let i = 1; i < r.flights.length; i++) {
      const a = r.flights[i - 1], b = r.flights[i];
      if (a.pilot.name === b.pilot.name) {
        const la = a.waypoints[a.waypoints.length - 1], fb = b.waypoints[0];
        expect([fb.x, fb.y, fb.altM]).toEqual([la.x, la.y, la.altM]);
      }
    }
  });
});

describe("golden: wpplan area example", () => {
  it("passes with the same number of flights and similar length", () => {
    // The vertical profile climbs at 1 m/s here (the reference assumed 2 m/s), so durations are
    // allowed to differ more than for corridors.
    const r = compareToGolden("area_example", areaExampleConfig(), { timeTol: 0.15 });
    expect(r.flights.every((f) => f.issues.length === 0)).toBe(true);
  });
});

describe("golden: errors", () => {
  it("a zone narrower than twice the margin raises", () => {
    expect(() => planStrict(skywayConfig({ insetCorridorM: 16 }))).toThrow(/too narrow/);
  });
  it("the same case through plan() reports NOT_READY instead of throwing", () => {
    const r = plan(skywayConfig({ insetCorridorM: 16 }));
    expect(r.verdict).toBe("NOT_READY");
    expect(r.notes[0].level).toBe("issue");
  });
});
