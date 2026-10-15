import kmlText from "./M-air-Skyway.kml?raw";
import { parseKml } from "../io/kml";
import type { LonLat } from "../core/types";

export interface SkywayData {
  /** The OSM rail centreline, Ann Arbor Amtrak to Michigan Central. */
  line: LonLat[];
}

let cached: SkywayData | null = null;

export function skywayData(): SkywayData {
  if (cached) return cached;
  const f = parseKml(kmlText);
  const main = [...f.lines].sort((a, b) => b.coords.length - a.coords.length)[0];
  cached = { line: main.coords };
  return cached;
}

/** Approximate airport reference points. Display only: check real airspace in Aloft / B4UFLY. */
export const AIRPORTS: { name: string; code: string; lon: number; lat: number }[] = [
  { name: "Ann Arbor Municipal", code: "ARB", lon: -83.7456, lat: 42.223 },
  { name: "Willow Run", code: "YIP", lon: -83.5304, lat: 42.2379 },
  { name: "Detroit Metro", code: "DTW", lon: -83.3534, lat: 42.2124 },
];
