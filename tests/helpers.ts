import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultConfig } from "../src/core/defaults";
import type { PlanConfig, Pilot } from "../src/core/types";
import { skywayData } from "../src/data/skyway";
import { parseKml } from "../src/io/kml";

export const FIXTURES = join(__dirname, "golden", "fixtures");
export const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

/** Config equivalent to wpplan's examples/skyway/config.json. */
export function skywayConfig(over: Partial<PlanConfig> = {}): PlanConfig {
  return {
    ...defaultConfig(skywayData().line),
    ceilingM: 121.9,
    floorM: 12,
    ...over,
  };
}

/** The made-up corridor example from wpplan (approved zone + centreline + 3 pilot spots). */
export function corridorExampleConfig(over: Partial<PlanConfig> = {}): PlanConfig {
  const zone = parseKml(readFixture("corridor_zone.kml")).polygons[0].ring;
  const line = parseKml(readFixture("centerline.kml")).lines[0].coords;
  const pilots: Pilot[] = parseKml(readFixture("stations.kml")).points.map((p) => ({ name: p.name, lon: p.lon, lat: p.lat }));
  return {
    ...defaultConfig(line),
    zone,
    startKm: 0,
    lengthM: 1e6,
    pilots,
    autoPilotSpacingM: null,
    altitudesM: [30, 60, 90, 120],
    ceilingM: 121.9,
    floorM: 10,
    ...over,
  };
}

export function areaExampleConfig(over: Partial<PlanConfig> = {}): PlanConfig {
  const ring = parseKml(readFixture("area_zone.kml")).polygons[0].ring;
  return {
    ...defaultConfig([]),
    mode: "area",
    area: ring,
    pilots: [{ name: "Pilot", lon: -83.70094563731337, lat: 42.29769342497632 }],
    autoPilotSpacingM: null,
    altitudesM: [30, 60, 90, 120],
    ceilingM: 121.9,
    floorM: 10,
    ...over,
  };
}
