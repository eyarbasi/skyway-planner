/**
 * Controlled-airspace outlines from the FAA's official open-data "Class Airspace" service.
 * Display only: nothing here is used by the planner's checks, and nothing is bundled or
 * invented, so the outlines are always as current as the FAA's own copy.
 * Only the surface areas (floor 0 ft) of Class B, C and D are requested.
 */
import type { LonLat } from "../core/types";
import type { FetchLike } from "./dem";

const ENDPOINT = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query";

export type AirspaceClass = "B" | "C" | "D";

export interface AirspaceArea {
  ident: string;
  name: string;
  cls: AirspaceClass;
  /** Ceiling as listed by the FAA, in feet. */
  topFt: number | null;
  rings: LonLat[][];
}

/** The URL for areas that touch the box (degrees). */
export function airspaceUrl(box: { west: number; south: number; east: number; north: number }): string {
  const q = new URLSearchParams({
    // US airports have 3-letter identifiers; the 4-letter ones are Canadian zones that the FAA file also carries.
    where: "LOWER_VAL=0 AND CLASS IN ('B','C','D') AND IDENT LIKE '___'",
    geometry: `${box.west},${box.south},${box.east},${box.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "IDENT,NAME,CLASS,UPPER_VAL",
    maxAllowableOffset: "0.0002",
    f: "geojson",
  });
  return `${ENDPOINT}?${q}`;
}

interface Feature { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }

const isClass = (c: unknown): c is AirspaceClass => c === "B" || c === "C" || c === "D";
const asRing = (r: unknown): LonLat[] =>
  (Array.isArray(r) ? r : []).filter((p): p is number[] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[0], p[1]] as LonLat);

/** Reads the service's GeoJSON. Features that are not B, C or D polygons are skipped. */
export function parseAirspace(json: unknown): AirspaceArea[] {
  const feats = (json as { features?: Feature[] } | null)?.features;
  if (!Array.isArray(feats)) throw new Error("Unexpected airspace reply");
  const out: AirspaceArea[] = [];
  for (const f of feats) {
    const p = f.properties ?? {};
    if (!isClass(p.CLASS) || !f.geometry) continue;
    const c = f.geometry.coordinates;
    const polys = f.geometry.type === "Polygon" ? [c] : f.geometry.type === "MultiPolygon" ? (c as unknown[]) : [];
    const rings = polys.flatMap((poly) => (Array.isArray(poly) ? poly.map(asRing) : [])).filter((r) => r.length >= 3);
    if (!rings.length) continue;
    const top = Number(p.UPPER_VAL);
    out.push({
      ident: String(p.IDENT ?? ""),
      name: String(p.NAME ?? ""),
      cls: p.CLASS,
      topFt: Number.isFinite(top) && top > 0 ? top : null,
      rings,
    });
  }
  return out;
}

export async function fetchAirspace(
  box: { west: number; south: number; east: number; north: number },
  fetcher: FetchLike = (u, i) => fetch(u, i) as ReturnType<FetchLike>,
): Promise<AirspaceArea[]> {
  const r = await fetcher(airspaceUrl(box));
  if (!r.ok) throw new Error(`Airspace service answered ${r.status}`);
  return parseAirspace(await r.json());
}
