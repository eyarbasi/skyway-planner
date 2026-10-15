/**
 * Geometry in a local metric frame. Nothing here works in raw degrees:
 * lon/lat is converted to metres with a transverse-Mercator frame (k = 1)
 * centred on the working area, so distances are accurate to well under a metre
 * over tens of kilometres.
 */
import proj4 from "proj4";
import type { LonLat, XY } from "./types";

export class Frame {
  private readonly conv: proj4.Converter;
  constructor(readonly lon0: number, readonly lat0: number) {
    const def = `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
    this.conv = proj4("EPSG:4326", def);
  }
  toXY(lon: number, lat: number): XY {
    const p = this.conv.forward([lon, lat]);
    return [p[0], p[1]];
  }
  toLL(x: number, y: number): LonLat {
    const p = this.conv.inverse([x, y]);
    return [p[0], p[1]];
  }
}

/** Metres per degree at a latitude (WGS84 series). */
export function metresPerDegree(latDeg: number): { kx: number; ky: number } {
  const r = (latDeg * Math.PI) / 180;
  return {
    ky: 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r),
    kx: 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r) + 0.118 * Math.cos(5 * r),
  };
}

/** Cumulative length (m) along a lon/lat polyline. Independent of any frame. */
export function cumulativeLengthLL(line: LonLat[]): number[] {
  const c = [0];
  for (let i = 1; i < line.length; i++) {
    const { kx, ky } = metresPerDegree((line[i][1] + line[i - 1][1]) / 2);
    c.push(c[i - 1] + Math.hypot((line[i][0] - line[i - 1][0]) * kx, (line[i][1] - line[i - 1][1]) * ky));
  }
  return c;
}

/** Cut a lon/lat polyline between two distances along it. */
export function cutLonLat(line: LonLat[], s0: number, s1: number): LonLat[] {
  const c = cumulativeLengthLL(line);
  const total = c[c.length - 1];
  s0 = Math.max(0, Math.min(total, s0));
  s1 = Math.max(s0, Math.min(total, s1));
  const at = (s: number): LonLat => {
    let i = 1;
    while (i < c.length - 1 && c[i] < s) i++;
    const t = (s - c[i - 1]) / Math.max(1e-9, c[i] - c[i - 1]);
    return [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])];
  };
  const out: LonLat[] = [at(s0)];
  for (let i = 0; i < line.length; i++) if (c[i] > s0 + 1e-6 && c[i] < s1 - 1e-6) out.push(line[i]);
  out.push(at(s1));
  return out;
}

export interface Polyline {
  pts: XY[];
  cum: number[];
  length: number;
}

export function makeLine(pts: XY[]): Polyline {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, length: cum[cum.length - 1] };
}

export function pointAt(l: Polyline, s: number): XY {
  s = Math.max(0, Math.min(l.length, s));
  let i = 1;
  while (i < l.cum.length - 1 && l.cum[i] < s) i++;
  const t = (s - l.cum[i - 1]) / Math.max(1e-9, l.cum[i] - l.cum[i - 1]);
  return [l.pts[i - 1][0] + t * (l.pts[i][0] - l.pts[i - 1][0]), l.pts[i - 1][1] + t * (l.pts[i][1] - l.pts[i - 1][1])];
}

/** Nearest point on the polyline: distance along it (s) and distance from it (d). */
export function project(l: Polyline, q: XY): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 1; i < l.pts.length; i++) {
    const a = l.pts[i - 1], b = l.pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2));
    const d = Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
    if (d < best.d) best = { s: l.cum[i - 1] + t * Math.sqrt(L2), d };
  }
  return best;
}

export function substring(l: Polyline, s0: number, s1: number): XY[] {
  const out: XY[] = [pointAt(l, s0)];
  for (let i = 0; i < l.pts.length; i++) if (l.cum[i] > s0 + 1e-6 && l.cum[i] < s1 - 1e-6) out.push(l.pts[i]);
  out.push(pointAt(l, s1));
  return out;
}

export function segDist(q: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
}

/** Douglas-Peucker: fewest vertices keeping the straight path within `tol` of the line. */
export function simplifyDP(pts: XY[], tol: number): XY[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let md = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], pts[a], pts[b]);
      if (d > md) { md = d; idx = i; }
    }
    if (idx >= 0 && md > tol) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function pointInPolygon(q: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a[1] > q[1] !== b[1] > q[1] && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function edgeDistance(q: XY, poly: XY[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(q, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

/** Positive inside the polygon (distance to nearest edge), negative outside. */
export function signedMargin(q: XY, poly: XY[]): number {
  const d = edgeDistance(q, poly);
  return pointInPolygon(q, poly) ? d : -d;
}

export function polygonCentroid(poly: XY[]): XY {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function polygonArea(poly: XY[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/** Offset a polyline sideways by d (positive = left of travel). Mitred, for display. */
export function offsetLine(p: XY[], d: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    const nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const L = Math.hypot(nx, ny) || 1;
    out.push([p[i][0] + (d * nx) / L, p[i][1] + (d * ny) / L]);
  }
  return out;
}

export function rotate(p: XY, c: XY, angleRad: number): XY {
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  return [c[0] + (p[0] - c[0]) * cos - (p[1] - c[1]) * sin, c[1] + (p[0] - c[0]) * sin + (p[1] - c[1]) * cos];
}

/**
 * Snap a clicked position to a lon/lat polyline. Returns the distance along the line (m)
 * and how far the click was from it (m). Used for "click the rail line to start here".
 */
export function snapToLine(line: LonLat[], lon: number, lat: number): { s: number; offsetM: number } {
  const f = new Frame(lon, lat);
  const cum = cumulativeLengthLL(line);
  const pts = line.map((p) => f.toXY(p[0], p[1]));
  let best = { s: 0, offsetM: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, (-a[0] * dx - a[1] * dy) / L2)); // the click is the frame origin
    const d = Math.hypot(a[0] + t * dx, a[1] + t * dy);
    if (d < best.offsetM) best = { s: cum[i - 1] + t * (cum[i] - cum[i - 1]), offsetM: d };
  }
  return best;
}
