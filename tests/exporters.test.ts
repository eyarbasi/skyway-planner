import { describe, expect, it } from "vitest";
import { plan } from "../src/core";
import { CSV_COLUMNS, EXPORTERS, ExporterUnavailableError, parsePlan, serializePlan, PlanFileError } from "../src/exporters";
import { csvExporter } from "../src/exporters/csv";
import { kmlExporter } from "../src/exporters/kml";
import { skydioExporter } from "../src/exporters/skydio";
import { parseKml } from "../src/io/kml";
import { skywayConfig } from "./helpers";

const cfg = skywayConfig({ startKm: 4, lengthM: 1500 });
const result = plan(cfg);
const ctx = { name: "test", config: cfg, plan: result };

describe("CSV export", () => {
  const f = csvExporter.export(ctx);
  const lines = (f.content as string).trim().split("\n");

  it("has exactly the agreed columns", () => {
    expect(lines[0].split(",")).toEqual([...CSV_COLUMNS]);
    expect(CSV_COLUMNS.join(",")).toBe("flight,seq,lat,lon,alt_above_launch_m,alt_above_launch_ft,speed_mps,hover_s,route_test_objective,block,pilot,pilot_lat,pilot_lon,note");
  });

  it("has one row per waypoint with matching values", () => {
    expect(lines.length - 1).toBe(result.flights.reduce((s, x) => s + x.waypoints.length, 0));
    const first = lines[1].split(",");
    const w = result.flights[0].waypoints[0];
    expect(Number(first[2])).toBeCloseTo(w.lat, 6);
    expect(Number(first[3])).toBeCloseTo(w.lon, 6);
    expect(Number(first[4])).toBe(w.altM);
    expect(Number(first[5])).toBe(Math.round(w.altM / 0.3048));
    expect(first[8]).toBe(w.rto);
    expect(first[9]).toBe(w.block);
  });

  it("quotes cells that contain commas", () => {
    const c2 = { ...ctx, plan: { ...result, flights: [{ ...result.flights[0], pilot: { ...result.flights[0].pilot, name: 'A, "B"' }, waypoints: result.flights[0].waypoints.slice(0, 1) }] } };
    expect((csvExporter.export(c2).content as string)).toContain('"A, ""B"""');
  });

  it("is deterministic", () => expect(csvExporter.export(ctx).content).toBe(f.content));
});

describe("KML export", () => {
  const f = kmlExporter.export(ctx);
  const doc = parseKml(f.content as string);

  it("parses back: zone, pilots, one 3D path per flight, waypoint markers", () => {
    expect(doc.polygons.length).toBe(result.zone.length + result.planningLimit.length);
    expect(doc.lines.length).toBe(result.flights.length);
    expect(doc.points.filter((p) => /^\d+\.\d+$/.test(p.name)).length).toBe(result.flights.reduce((s, x) => s + x.waypoints.filter((w) => !w.split).length, 0));
    expect(doc.points.some((p) => /Placeholder pilot/.test(p.name))).toBe(true);
  });

  it("uses relativeToGround and marks the assumed zone", () => {
    expect(f.content).toContain("<altitudeMode>relativeToGround</altitudeMode>");
    expect(f.content).toContain("ASSUMED");
  });

  it("path coordinates carry altitude above launch", () => {
    const m = /<LineString>.*?<coordinates>(.*?)<\/coordinates>/s.exec(f.content as string)![1].trim().split(/\s+/);
    const w = result.flights[0].waypoints;
    expect(m.length).toBe(w.length);
    expect(Number(m[0].split(",")[2])).toBe(w[0].altM);
  });

  it("escapes names", () => {
    const c2 = { ...ctx, name: "a&b<c>", plan: { ...result, pilots: [{ name: "x & <y>", lon: -83.7, lat: 42.3 }] } };
    expect(() => parseKml(kmlExporter.export(c2).content as string)).not.toThrow();
  });
});

describe("plan JSON", () => {
  it("round trips: saved plan in, identical waypoints out", () => {
    const text = serializePlan(cfg);
    const again = plan(parsePlan(text));
    expect(JSON.stringify(again)).toBe(JSON.stringify(result));
  });

  it("fills in missing settings from older files", () => {
    const old = JSON.parse(serializePlan(cfg));
    delete old.config.patterns.columns;
    delete old.config.time;
    const c = parsePlan(JSON.stringify(old));
    expect(c.patterns.columns).toBe(false);
    expect(c.time.climbRateMps).toBe(2);
  });

  it("rejects other files with a plain message", () => {
    expect(() => parsePlan("not json")).toThrow(PlanFileError);
    expect(() => parsePlan(JSON.stringify({ hello: 1 }))).toThrow(/not a saved plan/);
    expect(() => parsePlan(JSON.stringify({ format: "skyway-planner-plan", version: 99, config: {} }))).toThrow(/newer version/);
  });
});

describe("Skydio exporter (pluggable, waiting for the sample file)", () => {
  it("is registered, unavailable, and says why", () => {
    expect(EXPORTERS.map((e) => e.id)).toContain("skydio");
    expect(skydioExporter.available).toBe(false);
    expect(skydioExporter.unavailableReason).toMatch(/sample/);
    expect(() => skydioExporter.export(ctx)).toThrow(ExporterUnavailableError);
  });

  // Un-skip when reference/ has the X10 sample: parse our output and compare it with the sample's structure.
  it.skip("round trip against the X10 sample mission", () => {});
});
