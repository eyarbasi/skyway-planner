/**
 * Flight patterns in local metres. Altitudes are metres above the launch point.
 *
 * Every pattern starts where the drone already is (the end of the previous
 * pattern) so the path never cuts straight across a curve between patterns.
 */
import { makeLine, pointAt, pointInPolygon, edgeDistance, polygonCentroid, rotate, simplifyDP } from "./geo";
import type { AreaOptions, PatternOptions, XY } from "./types";

export interface RawWp {
  x: number;
  y: number;
  z: number;
  /** Speed on the leg arriving at this waypoint. */
  v: number;
  hover: number;
  rto: string;
  note: string;
  split?: boolean;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export interface CorridorSectionInput {
  /** Simplified centreline of this pilot's section, in travel order. */
  line: XY[];
  altitudes: number[];
  speed: number;
  opts: PatternOptions;
}

export function corridorPatterns(inp: CorridorSectionInput): RawWp[] {
  const { altitudes, speed, opts } = inp;
  const fwd = inp.line;
  const rev = fwd.slice().reverse();
  const w: RawWp[] = [];
  let atStart = true;

  const sweep = (list: number[], tag: string) => {
    for (const z of list) {
      const seq = atStart ? fwd : rev;
      const rto = `C-LIN-${Math.round(z)}`;
      w.push({ x: seq[0][0], y: seq[0][1], z, v: speed, hover: 0, rto, note: `layer ${z} m${tag}` });
      for (let k = 1; k < seq.length; k++) w.push({ x: seq[k][0], y: seq[k][1], z, v: speed, hover: 0, rto, note: "" });
      atStart = !atStart;
    }
  };

  if (opts.linear && altitudes.length) {
    sweep(altitudes, "");
    if (opts.bothSweeps) sweep(altitudes.slice().reverse(), " (return sweep)");
  }

  const zLo = Math.max(Math.min(...altitudes), opts.porpoiseMinAltM);
  const zHi = Math.max(...altitudes);

  if (opts.porpoise && zHi > zLo) {
    const pts = atStart ? fwd : rev;
    const line = makeLine(pts);
    const half = opts.porpoiseHalfPeriodM;
    const stations = new Set<number>();
    line.cum.forEach((s) => stations.add(Math.round(s * 10) / 10));
    for (let s = 0; s <= line.length; s += half) stations.add(Math.round(s * 10) / 10);
    stations.add(Math.round(line.length * 10) / 10);
    const ss = [...stations].sort((a, b) => a - b);
    const zCur = w.length ? w[w.length - 1].z : zHi;
    const goingDown = w.length > 0 && zCur >= (zLo + zHi) / 2;
    ss.forEach((s, i) => {
      const k = Math.floor(s / half + 1e-9);
      const f = (s - k * half) / half;
      const up = k % 2 === 0 !== goingDown;
      const z = round1(zLo + (zHi - zLo) * (up ? f : 1 - f));
      const q = pointAt(line, s);
      w.push({ x: q[0], y: q[1], z, v: speed, hover: 0, rto: "C-POR", note: i === 0 ? "climb/descend pass" : "" });
    });
    atStart = !atStart;
  }

  if (opts.columns && zHi > zLo) {
    const pts = atStart ? fwd : rev;
    const line = makeLine(pts);
    const n = Math.floor(line.length / opts.columnSpacingM);
    const stations = Array.from({ length: n + 1 }, (_, k) => k * opts.columnSpacingM);
    let z = zLo;
    const p0 = pointAt(line, 0);
    w.push({ x: p0[0], y: p0[1], z, v: speed, hover: 0, rto: "C-COL", note: "start columns" });
    stations.forEach((s, i) => {
      const q = pointAt(line, s);
      z = z === zLo ? zHi : zLo;
      w.push({ x: q[0], y: q[1], z, v: speed, hover: 0, rto: "C-COL", note: `column ${i + 1}` });
      if (i + 1 < stations.length) {
        const sNext = stations[i + 1];
        line.cum.forEach((sv, vi) => {
          if (sv > s + 1e-6 && sv < sNext - 1e-6) w.push({ x: line.pts[vi][0], y: line.pts[vi][1], z, v: speed, hover: 0, rto: "C-COL", note: "" });
        });
        const qn = pointAt(line, sNext);
        w.push({ x: qn[0], y: qn[1], z, v: speed, hover: 0, rto: "C-COL", note: "" });
      }
    });
  }
  return w;
}

/** Fewest vertices that keep straight legs within `tol` of the line. */
export function followLine(pts: XY[], tol: number): XY[] {
  return simplifyDP(pts, tol);
}

export interface AreaInput {
  /** Area outline in metres. */
  polygon: XY[];
  inset: number;
  altitudes: number[];
  speed: number;
  opts: AreaOptions;
}

export interface AreaResult {
  waypoints: RawWp[];
  droppedLanePieces: number;
}

/** True when q is at least `inset` inside the outline. */
export function insideLimit(q: XY, poly: XY[], inset: number): boolean {
  return pointInPolygon(q, poly) && edgeDistance(q, poly) >= inset - 1e-9;
}

/** Longest run along a lane (x fixed, y from lo to hi) that stays inside the planning limit. */
function longestRun(x: number, lo: number, hi: number, poly: XY[], inset: number): { run: [number, number] | null; pieces: number } {
  const step = 0.5;
  let best: [number, number] | null = null;
  let cur: [number, number] | null = null;
  let pieces = 0;
  const close = () => {
    if (!cur) return;
    pieces++;
    if (!best || cur[1] - cur[0] > best[1] - best[0]) best = cur;
    cur = null;
  };
  // refine a boundary between an inside and outside sample by bisection
  const refine = (yIn: number, yOut: number): number => {
    for (let i = 0; i < 24; i++) {
      const m = (yIn + yOut) / 2;
      if (insideLimit([x, m], poly, inset)) yIn = m;
      else yOut = m;
    }
    return yIn;
  };
  let prevY = lo, prevIn = insideLimit([x, lo], poly, inset);
  if (prevIn) cur = [lo, lo];
  for (let y = lo + step; y <= hi + 1e-9; y += step) {
    const inn = insideLimit([x, y], poly, inset);
    if (inn && !prevIn) cur = [refine(y, prevY), y];
    else if (inn && cur) cur[1] = y;
    else if (!inn && prevIn && cur) { cur[1] = refine(prevY, y); close(); }
    prevY = y; prevIn = inn;
  }
  close();
  return { run: best, pieces };
}

export function areaPatterns(inp: AreaInput): AreaResult {
  const { polygon, inset, altitudes, speed, opts } = inp;
  const c = polygonCentroid(polygon);
  const w: RawWp[] = [];
  let dropped = 0;

  if (opts.verticalProfile && altitudes.length) {
    const lo = Math.min(...altitudes), hi = Math.max(...altitudes), v = opts.verticalProfileSpeedMps;
    w.push({ x: c[0], y: c[1], z: lo, v, hover: 0, rto: "A-VP", note: "vertical profile" });
    w.push({ x: c[0], y: c[1], z: hi, v, hover: 0, rto: "A-VP", note: "profile top" });
    w.push({ x: c[0], y: c[1], z: lo, v, hover: 0, rto: "A-VP", note: "profile bottom" });
  }

  altitudes.forEach((z, i) => {
    const hdg = opts.headingDeg + (opts.crosshatch && i % 2 === 1 ? 90 : 0);
    // Rotate so lanes run along +y: a lane heading of H degrees clockwise from north
    // is rotated by +H to point north (counter-clockwise by H would undo it).
    const rot = (hdg * Math.PI) / 180;
    const rp = polygon.map((p) => rotate(p, c, rot));
    const xs = rp.map((p) => p[0]), ys = rp.map((p) => p[1]);
    const minx = Math.min(...xs) + inset, maxx = Math.max(...xs) - inset;
    const miny = Math.min(...ys), maxy = Math.max(...ys);
    if (maxx < minx) return;
    const W = maxx - minx;
    const n = Math.floor(W / opts.laneSpacingM + 1e-9) + 1;
    const x0 = minx + (W - (n - 1) * opts.laneSpacingM) / 2;
    let first = true, flip = false;
    for (let k = 0; k < n; k++) {
      const x = x0 + k * opts.laneSpacingM;
      const { run, pieces } = longestRun(x, miny, maxy, rp, inset);
      dropped += Math.max(0, pieces - 1);
      if (!run || run[1] - run[0] < 5) continue;
      const ends: XY[] = [[x, run[0]], [x, run[1]]];
      if (flip) ends.reverse();
      flip = !flip;
      for (const e of ends) {
        const q = rotate(e, c, -rot);
        w.push({ x: q[0], y: q[1], z, v: speed, hover: 0, rto: `A-LM-${Math.round(z)}`, note: first ? `layer ${z} m, lanes ${(((hdg % 360) + 360) % 360)} deg` : "" });
        first = false;
      }
    }
  });
  return { waypoints: w, droppedLanePieces: dropped };
}
