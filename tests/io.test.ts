import { describe, expect, it } from "vitest";
import { plan } from "../src/core";
import { skywayData } from "../src/data/skyway";
import { applyKml } from "../src/io/applyKml";
import { parseKml } from "../src/io/kml";
import { decodePlanHash, encodePlanHash } from "../src/ui/share";
import { areaExampleConfig, readFixture, skywayConfig } from "./helpers";

describe("applying a KML to the plan", () => {
  it("corridor: a polygon becomes the approved zone, so the 'assumed zone' warning goes away", () => {
    const base = skywayConfig({ startKm: 4, lengthM: 1500 });
    const f = parseKml(readFixture("corridor_zone.kml"));
    const r = applyKml(f, base);
    expect(r.cfg.zone).toEqual(f.polygons[0].ring);
    expect(r.messages[0]).toMatch(/fly-zone polygon/);
    expect(plan(r.cfg).zoneAssumed).toBe(false);
  });

  it("corridor: a path replaces the centre line and restarts at km 0", () => {
    const r = applyKml(parseKml(readFixture("centerline.kml")), skywayConfig({ startKm: 4 }));
    expect(r.cfg.line.length).toBe(parseKml(readFixture("centerline.kml")).lines[0].coords.length);
    expect(r.cfg.startKm).toBe(0);
  });

  it("points become pilot spots and placeholders are switched off", () => {
    const r = applyKml(parseKml(readFixture("stations.kml")), skywayConfig());
    expect(r.cfg.pilots.length).toBe(3);
    expect(r.cfg.pilots.every((p) => !p.placeholder)).toBe(true);
    expect(r.cfg.autoPilotSpacingM).toBeNull();
  });

  it("the Skyway file itself is not treated as pilot spots", () => {
    const sky = parseKml(`<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Line</name><LineString><coordinates>-83.7,42.28,0 -83.69,42.28,0</coordinates></LineString></Placemark>
      <Placemark><name>Node</name><Point><coordinates>-83.7,42.28,0</coordinates></Point></Placemark></kml>`);
    const r = applyKml(sky, skywayConfig());
    expect(r.cfg.pilots).toEqual([]);
    expect(r.messages.join(" ")).toMatch(/not used as pilot spots/);
  });

  it("area mode: a polygon becomes the area outline", () => {
    const f = parseKml(readFixture("area_zone.kml"));
    const r = applyKml(f, { ...areaExampleConfig(), area: [] });
    expect(r.cfg.area).toEqual(f.polygons[0].ring);
  });

  it("an empty file says so and changes nothing", () => {
    const r = applyKml({ polygons: [], lines: [], points: [] }, skywayConfig());
    expect(r.changed).toBe(false);
    expect(r.messages[0]).toMatch(/No polygon/);
  });
});

describe("share links", () => {
  const line = skywayData().line;

  it("round-trips a plan, and stays short because the built-in line is left out", () => {
    const cfg = skywayConfig({ startKm: 12.5, lengthM: 2200, pilots: [{ name: "North gate", lon: -83.6, lat: 42.25 }], autoPilotSpacingM: null });
    const hash = encodePlanHash(cfg, line);
    expect(hash.length).toBeLessThan(1500);
    const back = decodePlanHash("#" + hash, line)!;
    expect(JSON.stringify(plan(back))).toBe(JSON.stringify(plan(cfg)));
  });

  it("returns null when there is no plan in the link and a plain error when it is damaged", () => {
    expect(decodePlanHash("", line)).toBeNull();
    expect(decodePlanHash("#something=else", line)).toBeNull();
    expect(() => decodePlanHash("#plan=AAAA", line)).toThrow(/damaged/);
  });
});
