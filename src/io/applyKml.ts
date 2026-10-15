import type { PlanConfig } from "../core";
import type { KmlFeatures } from "./kml";

export interface ApplyResult {
  cfg: PlanConfig;
  messages: string[];
  changed: boolean;
}

/**
 * Put what a KML/KMZ holds into the plan:
 *  - Polygon     -> fly zone (corridor mode) or the area outline (area mode)
 *  - LineString  -> centre line (corridor mode)
 *  - Points      -> pilot spots, unless the file also has a line (then they are a list of places, not launch spots)
 */
export function applyKml(f: KmlFeatures, cfg: PlanConfig): ApplyResult {
  const next: PlanConfig = { ...cfg };
  const messages: string[] = [];
  const got: string[] = [];
  const corridor = cfg.mode === "corridor";

  if (f.polygons.length) {
    const ring = f.polygons[0].ring;
    if (corridor) { next.zone = ring; got.push("fly-zone polygon"); }
    else { next.area = ring; got.push("area outline"); }
    if (f.polygons.length > 1) messages.push(`The file has ${f.polygons.length} polygons. Only the first was used.`);
  }
  if (f.lines.length) {
    if (corridor) {
      const main = [...f.lines].filter((l) => !/proposed|extension/i.test(l.name)).sort((a, b) => b.coords.length - a.coords.length)[0] ?? f.lines[0];
      next.line = main.coords;
      next.startKm = 0;
      got.push("centre line");
    } else {
      messages.push("The file has a path, which is only used for flights along a line. Switch to “Along the Skyway” to use it.");
    }
  }
  if (f.points.length && (!f.lines.length || !corridor)) {
    next.pilots = f.points.map((p) => ({ name: p.name, lon: p.lon, lat: p.lat }));
    next.autoPilotSpacingM = null;
    got.push(`${f.points.length} pilot spot${f.points.length === 1 ? "" : "s"}`);
  } else if (f.points.length) {
    messages.push(`The ${f.points.length} points in that file were not used as pilot spots because it also holds a line. Open a file with only the launch spots to use them.`);
  }
  if (!got.length && !messages.length) messages.push("No polygon, path or points found in that file.");
  if (got.length) messages.unshift(`Loaded: ${got.join(", ")}.`);
  return { cfg: next, messages, changed: got.length > 0 };
}
