import { describe, expect, it } from "vitest";
import { plan } from "../src/core";
import { DemCache, pointsNeedingElevation, type FetchLike } from "../src/io/dem";
import { skywayConfig } from "./helpers";

/** A fake USGS service: ground falls 0.05 m per 0.0001 degree of longitude. */
const fakeService = (calls: string[]): FetchLike => async (_url, init) => {
  const params = new URLSearchParams(init!.body!);
  calls.push(params.get("sampleCount")!);
  const pts = (JSON.parse(params.get("geometry")!) as { points: [number, number][] }).points;
  return { ok: true, status: 200, json: async () => ({ samples: pts.map((p, i) => ({ locationId: i, value: String(260 - (p[0] + 83.7) * 500)})) }) };
};

describe("3DEP ground elevation", () => {
  it("fetches in chunks of 100 and caches", async () => {
    const calls: string[] = [];
    const dem = new DemCache();
    const pts = Array.from({ length: 250 }, (_, i): [number, number] => [-83.7 + i * 0.0001, 42.28]);
    expect(dem.missing(pts).length).toBe(250);
    expect(await dem.fetch(pts, fakeService(calls))).toBe(250);
    expect(calls).toEqual(["100", "100", "50"]);
    expect(dem.missing(pts).length).toBe(0);
    expect(dem.size).toBe(250);
  });

  it("de-duplicates points that fall on the same spot", () => {
    expect(new DemCache().missing([[-83.7, 42.28], [-83.7, 42.28], [-83.700001, 42.28]]).length).toBe(1);
  });

  it("returns the cached value exactly at a sample and blends between samples", () => {
    const dem = new DemCache();
    dem.add(-83.7, 42.28, 240);
    dem.add(-83.699, 42.28, 250);
    expect(dem.elevationAt(-83.7, 42.28)).toBe(240);
    const mid = dem.elevationAt(-83.6995, 42.28)!;
    expect(mid).toBeGreaterThan(240);
    expect(mid).toBeLessThan(250);
    expect(new DemCache().elevationAt(-83.7, 42.28)).toBeNull();
  });

  it("explains failures in plain words", async () => {
    await expect(new DemCache().fetch([[-83.7, 42.28]], async () => { throw new Error("net"); })).rejects.toThrow(/Check your connection/);
    await expect(new DemCache().fetch([[-83.7, 42.28]], async () => ({ ok: false, status: 503, json: async () => ({}) }))).rejects.toThrow(/503/);
    await expect(new DemCache().fetch([[-83.7, 42.28]], async () => ({ ok: true, status: 200, json: async () => ({ error: { message: "Bad geometry" } }) }))).rejects.toThrow(/Bad geometry/);
  });

  it("a plan checked against the fetched ground uses it: falling ground raises the true height past the ceiling", async () => {
    const cfg = skywayConfig({ startKm: 0, lengthM: 1500, autoPilotSpacingM: null, vlosM: 2000, batteryMin: 60,
      pilots: [{ name: "P", lon: -83.7425, lat: 42.2879 }] });
    const flat = plan(cfg);
    const dem = new DemCache();
    // pretend the ground drops 12 m over the stretch going east
    for (const [lon, lat] of pointsNeedingElevation(flat)) dem.add(lon, lat, 300 - (lon + 83.7425) * 1000);
    dem.add(-83.7425, 42.2879, 300);
    const checked = plan(cfg, dem);
    expect(checked.flights.some((f) => f.issues.some((i) => /ceiling/.test(i.message)))).toBe(true);
    expect(checked.notes.some((n) => /No ground-elevation/.test(n.message))).toBe(false);
    // waypoints do not depend on the ground at all
    expect(checked.flights.map((f) => f.waypoints)).toEqual(flat.flights.map((f) => f.waypoints));
  });
});
