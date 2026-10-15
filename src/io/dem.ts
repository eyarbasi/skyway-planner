/**
 * Ground elevation from USGS 3DEP (public domain, about 1 m detail in most of Michigan),
 * used only to correct the height-above-ground check:
 *   true height = altitude above launch + ground(launch) - ground(point)
 */
import type { LonLat, Terrain } from "../core/types";

const ENDPOINT = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples";
const CELL = 0.001; // degrees, about 100 m: buckets for nearest-sample lookup
const CHUNK = 100;

interface Sample { lon: number; lat: number; z: number }

export type FetchLike = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const keyOf = (lon: number, lat: number) => `${lon.toFixed(5)},${lat.toFixed(5)}`;
const cellOf = (lon: number, lat: number) => `${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`;

export class DemCache implements Terrain {
  private readonly byKey = new Map<string, Sample>();
  private readonly cells = new Map<string, Sample[]>();

  get size(): number {
    return this.byKey.size;
  }

  add(lon: number, lat: number, z: number): void {
    const k = keyOf(lon, lat);
    if (this.byKey.has(k)) return;
    const s = { lon, lat, z };
    this.byKey.set(k, s);
    const c = cellOf(lon, lat);
    const list = this.cells.get(c);
    if (list) list.push(s);
    else this.cells.set(c, [s]);
  }

  /** The points (de-duplicated, about 1 m apart or more) that are not cached yet. */
  missing(points: LonLat[]): LonLat[] {
    const seen = new Set<string>();
    const out: LonLat[] = [];
    for (const [lon, lat] of points) {
      const k = keyOf(lon, lat);
      if (this.byKey.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push([lon, lat]);
    }
    return out;
  }

  /** Inverse-distance blend of the nearest cached samples (3x3 neighbouring cells). */
  elevationAt(lon: number, lat: number): number | null {
    const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
    const near: { d2: number; z: number }[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const s of this.cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const x = (s.lon - lon) * 82000, y = (s.lat - lat) * 111000; // metres, close enough for weights
          near.push({ d2: x * x + y * y, z: s.z });
        }
      }
    }
    if (!near.length) return null;
    near.sort((a, b) => a.d2 - b.d2);
    const use = near.slice(0, 3);
    if (use[0].d2 < 0.01) return use[0].z;
    let wsum = 0, zsum = 0;
    for (const n of use) { const w = 1 / n.d2; wsum += w; zsum += w * n.z; }
    return zsum / wsum;
  }

  /** Fetch elevations for the given points, 100 per request. Throws a plain-language error on failure. */
  async fetch(points: LonLat[], fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<number> {
    let got = 0;
    for (let i = 0; i < points.length; i += CHUNK) {
      const chunk = points.slice(i, i + CHUNK);
      const body = new URLSearchParams({
        geometry: JSON.stringify({ points: chunk, spatialReference: { wkid: 4326 } }),
        geometryType: "esriGeometryMultipoint",
        returnFirstValueOnly: "true",
        sampleCount: String(chunk.length),
        f: "json",
      }).toString();
      let res;
      try {
        res = await fetchFn(ENDPOINT, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      } catch {
        throw new Error("Could not reach the USGS elevation service. Check your connection.");
      }
      if (!res.ok) throw new Error(`The USGS elevation service answered with an error (${res.status}).`);
      const j = (await res.json()) as { samples?: { locationId: number; value: string | number }[]; error?: { message?: string } };
      if (!j.samples) throw new Error(j.error?.message || "The USGS elevation service sent no data.");
      for (const s of j.samples) {
        const z = Number(s.value);
        const p = chunk[s.locationId];
        if (p && Number.isFinite(z)) { this.add(p[0], p[1], z); got++; }
      }
    }
    return got;
  }
}

/** Every place whose ground height matters for a plan: the pilot spots and all waypoints. */
export function pointsNeedingElevation(result: { pilots: { lon: number; lat: number }[]; flights: { waypoints: { lon: number; lat: number }[] }[] }): LonLat[] {
  const pts: LonLat[] = result.pilots.map((p): LonLat => [p.lon, p.lat]);
  for (const f of result.flights) for (const w of f.waypoints) pts.push([w.lon, w.lat]);
  return pts;
}
