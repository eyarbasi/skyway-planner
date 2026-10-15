/** Time model, densify, and splitting a waypoint list into battery-sized flights. */
import type { RawWp } from "./patterns";
import type { TimeModel, XY } from "./types";

/**
 * Time for one leg: the slower of the horizontal move and the vertical move.
 * A pure vertical move can't go faster than the leg's own speed setting
 * (so the 1 m/s vertical profile really takes 1 m/s).
 */
export function legTime(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, speed: number, tm: TimeModel): number {
  const dh = Math.hypot(b.x - a.x, b.y - a.y);
  const dz = Math.abs(b.z - a.z);
  const vRate = dh < 0.5 ? Math.min(tm.climbRateMps, Math.max(speed, 0.1)) : tm.climbRateMps;
  return Math.max(dh / Math.max(speed, 0.1), dz / vRate);
}

/** Insert intermediate waypoints so no leg is longer than maxLeg, so flights can end mid-leg. */
export function densify(wps: RawWp[], maxLeg: number): RawWp[] {
  if (!wps.length) return [];
  const out: RawWp[] = [wps[0]];
  for (let i = 1; i < wps.length; i++) {
    const p = out[out.length - 1], q = wps[i];
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    const n = d > maxLeg ? Math.ceil(d / maxLeg) : 1;
    for (let k = 1; k < n; k++) {
      const f = k / n;
      out.push({ x: p.x + f * (q.x - p.x), y: p.y + f * (q.y - p.y), z: p.z + f * (q.z - p.z), v: q.v, hover: 0, rto: q.rto, note: "split point", split: true });
    }
    out.push(q);
  }
  return out;
}

/** O(1) time for any contiguous slice, via prefix sums. */
export class TimeCalc {
  private readonly prefix: number[];
  private readonly hoverPrefix: number[];
  constructor(private readonly wps: RawWp[], private readonly pilot: XY, private readonly tm: TimeModel) {
    this.prefix = [0];
    this.hoverPrefix = [0];
    for (let i = 1; i < wps.length; i++) {
      this.prefix.push(this.prefix[i - 1] + legTime(wps[i - 1], wps[i], wps[i].v, tm) + tm.overheadPerWaypointS);
      this.hoverPrefix.push(this.hoverPrefix[i - 1] + wps[i].hover);
    }
  }
  /** Take-off climb, transit out, the pattern i..j, transit back, landing descent (seconds). */
  slice(i: number, j: number): number {
    const { wps, pilot, tm } = this;
    const a = wps[i], b = wps[j];
    const px = { x: pilot[0], y: pilot[1] };
    let t = a.z / tm.climbRateMps;
    t += legTime({ ...px, z: a.z }, a, a.v, tm);
    t += this.prefix[j] - this.prefix[i] + (this.hoverPrefix[j] - this.hoverPrefix[i]);
    t += legTime(b, { ...px, z: b.z }, b.v, tm);
    t += b.z / tm.climbRateMps;
    return t;
  }
}

export interface SplitInput {
  wps: RawWp[];
  pilot: XY;
  tm: TimeModel;
  budgetS: number;
  vlosM: number;
}

export interface SplitResult {
  /** Index ranges [i, j] inclusive; flight k+1 resumes at the last waypoint of flight k. */
  ranges: [number, number][];
  error: string | null;
}

function greedy(calc: TimeCalc, wps: RawWp[], pilot: XY, vlos: number, budgetFor: (i: number, j: number) => number): SplitResult {
  const ranges: [number, number][] = [];
  const far = (k: number) => Math.hypot(wps[k].x - pilot[0], wps[k].y - pilot[1]) > vlos;
  let i = 0;
  const n = wps.length;
  while (i < n - 1) {
    if (far(i)) return { ranges, error: `waypoint ${i + 1} is farther than ${vlos} m from the pilot` };
    let j = i;
    while (j + 1 < n && !far(j + 1) && calc.slice(i, j + 1) <= budgetFor(i, j + 1)) j++;
    if (j === i) return { ranges, error: "the next leg is too long for the battery or too far from the pilot" };
    ranges.push([i, j]);
    i = j;
  }
  return { ranges, error: null };
}

/**
 * Greedy fill against the battery and distance limits, then balance: if the
 * greedy fill needs n flights, re-split aiming at about total/n each, so a
 * 21 min flight never ends up followed by a 4 min one.
 */
export function splitFlights(inp: SplitInput): SplitResult {
  const { wps, pilot, tm, budgetS, vlosM } = inp;
  if (wps.length < 2) return { ranges: [], error: null };
  const calc = new TimeCalc(wps, pilot, tm);
  const g = greedy(calc, wps, pilot, vlosM, () => budgetS);
  if (g.error || g.ranges.length <= 1) return g;
  const n = g.ranges.length;
  const total = calc.slice(0, wps.length - 1);
  for (let f = 1.02; f <= 1.6; f += 0.02) {
    const target = Math.min(budgetS, (total / n) * f);
    // the last flight takes whatever is left, as long as it fits the battery
    const r = greedy(calc, wps, pilot, vlosM, (_i, j) => (j >= wps.length - 1 ? budgetS : target));
    if (!r.error && r.ranges.length <= n) return r;
  }
  return g;
}

export function flightTime(wps: RawWp[], pilot: XY, tm: TimeModel): number {
  return wps.length < 1 ? 0 : new TimeCalc(wps, pilot, tm).slice(0, wps.length - 1);
}
