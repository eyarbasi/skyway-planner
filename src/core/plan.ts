/**
 * plan(config) -> { flights, notes, verdict, ... }
 *
 * Pure and deterministic: the same config always gives byte-identical output.
 * No DOM, no randomness, stable sorts only.
 */
import {
  Frame, cumulativeLengthLL, cutLonLat, makeLine, offsetLine, pointAt, polygonArea, project, signedMargin, simplifyDP, substring,
  type Polyline,
} from "./geo";
import { areaPatterns, corridorPatterns, type RawWp } from "./patterns";
import { densify, flightTime, splitFlights } from "./split";
import type { Flight, Issue, LonLat, Note, Obstacle, Pilot, PlanConfig, PlanResult, Terrain, Verdict, Waypoint, XY } from "./types";

/** Thrown for a config that cannot produce any plan (e.g. a zone narrower than twice the margin). */
export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

interface Section {
  pilot: Pilot;
  px: XY;
  wps: RawWp[];
}

interface Context {
  frame: Frame;
  inset: number;
  /** Signed distance to the zone edge (negative outside), metres. */
  margin: (q: XY) => number;
  /** For corridor mode: the flown centreline (trimmed) and distance of its start along the track. */
  flightLine: Polyline | null;
  flightStartAbsM: number;
  zoneAssumed: boolean;
}

const pad3 = (n: number) => String(n).padStart(3, "0");
const fmtKm = (m: number) => (m / 1000).toFixed(2);

export function plan(config: PlanConfig, terrain?: Terrain): PlanResult {
  try {
    return planStrict(config, terrain);
  } catch (e) {
    if (e instanceof PlanError) {
      return {
        flights: [], notes: [{ level: "issue", message: e.message }], verdict: "NOT_READY", pilots: [],
        zone: [], planningLimit: [], centreline: [], zoneAssumed: !config.zone,
        summary: { flights: 0, totalMin: 0, measuredKm: 0, label: "" },
      };
    }
    throw e;
  }
}

export function planStrict(cfg: PlanConfig, terrain?: Terrain): PlanResult {
  const notes: Note[] = [];
  const note = (level: Note["level"], message: string) => notes.push({ level, message });
  const alts = cfg.altitudesM.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!alts.length) throw new PlanError("Enter at least one altitude above 0 m.");
  const top = alts[alts.length - 1];
  if (top > cfg.ceilingM) note("issue", `The top altitude (${top} m) is above the ceiling (${cfg.ceilingM.toFixed(1)} m). Lower it or raise the ceiling.`);
  else if (top > cfg.ceilingM - 5) note("warn", "The top altitude is within 5 m of the ceiling. Ground that is lower than the launch point raises the true height above ground.");
  const floor = cfg.floorM ?? alts[0];
  const budgetS = cfg.batteryMin * 60;

  let ctx: Context;
  const sections: Section[] = [];
  let pilots: Pilot[] = cfg.pilots.map((p) => ({ ...p }));
  let zone: LonLat[][];
  let limit: LonLat[][] = [];
  let centreline: LonLat[] = [];
  let label: string;

  if (cfg.mode === "corridor") {
    const pt = cfg.patterns;
    if (!pt.linear && !pt.porpoise && !pt.columns) throw new PlanError("Choose at least one flight pattern (passes along the track, climb-and-descend, or columns).");
    if (cfg.line.length < 2) throw new PlanError("No rail line loaded. Load a centre line (KML) to plan a corridor flight.");
    const cum = cumulativeLengthLL(cfg.line);
    const total = cum[cum.length - 1];
    const s0 = Math.max(0, Math.min(total - 50, cfg.startKm * 1000));
    const s1 = Math.min(total, s0 + cfg.lengthM);
    const segLL = cutLonLat(cfg.line, s0, s1);
    const mid = segLL[Math.floor(segLL.length / 2)];
    const frame = new Frame(mid[0], mid[1]);
    const seg = makeLine(segLL.map((p) => frame.toXY(p[0], p[1])));
    const L = seg.length;
    const half = cfg.halfWidthM, inset = cfg.insetCorridorM;
    if (!cfg.zone && inset >= half) throw new PlanError(`The fly zone is too narrow: a ${inset} m edge margin leaves no room inside a zone only ${2 * half} m wide. Widen the zone or reduce the margin.`);
    if (L < 2 * inset + 10) throw new PlanError("The selected stretch is too short to fly. Make it longer.");

    const zoneXY = cfg.zone ? cfg.zone.map((p) => frame.toXY(p[0], p[1])) : null;
    const pts = seg.pts;
    const u0: XY = unit(pts[0], pts[1]);
    const uN: XY = unit(pts[pts.length - 2], pts[pts.length - 1]);
    const margin = (q: XY): number => {
      if (zoneXY) return signedMargin(q, zoneXY);
      const pr = project(seg, q);
      let sRaw = pr.s;
      if (pr.s <= 1e-9) sRaw = (q[0] - pts[0][0]) * u0[0] + (q[1] - pts[0][1]) * u0[1];
      else if (pr.s >= L - 1e-9) sRaw = L + (q[0] - pts[pts.length - 1][0]) * uN[0] + (q[1] - pts[pts.length - 1][1]) * uN[1];
      if (sRaw < 0) return sRaw;
      if (sRaw > L) return L - sRaw;
      return Math.min(half - pr.d, sRaw, L - sRaw);
    };

    const a = Math.min(inset, L / 2 - 1), b = Math.max(L - inset, L / 2 + 1);
    const flightPts = substring(seg, a, b);
    const flightLine = makeLine(flightPts);
    ctx = { frame, inset, margin, flightLine, flightStartAbsM: s0 + a, zoneAssumed: !zoneXY };
    centreline = flightPts.map((p) => frame.toLL(p[0], p[1]));
    if (zoneXY) {
      zone = [cfg.zone!];
      note("info", "Using the loaded fly-zone polygon.");
    } else {
      const ring = (d: number, line: XY[]) => [...offsetLine(line, d), ...offsetLine(line, -d).reverse()].map((p) => frame.toLL(p[0], p[1]));
      zone = [ring(half, pts)];
      limit = [ring(half - inset, flightPts)];
      note("warn", `Assumed fly zone: the rail line ±${half} m. Load the approved zone polygon before flying.`);
    }
    label = `km ${fmtKm(s0)}–${fmtKm(s1)} of ${(total / 1000).toFixed(1)}`;

    // pilots
    if (!pilots.length && cfg.autoPilotSpacingM) {
      const n = Math.max(1, Math.round(flightLine.length / cfg.autoPilotSpacingM));
      pilots = Array.from({ length: n }, (_, k) => {
        const q = pointAt(flightLine, ((k + 0.5) * flightLine.length) / n);
        const ll = frame.toLL(q[0], q[1]);
        return { name: `Placeholder pilot ${k + 1}`, lon: ll[0], lat: ll[1], placeholder: true };
      });
    }
    if (pilots.some((p) => p.placeholder)) note("warn", `Pilot spots are placeholders on the track every ~${cfg.autoPilotSpacingM ?? "?"} m. Replace them with the real launch spots.`);
    if (!pilots.length) {
      note("issue", "Add at least one pilot spot (where the pilot will stand).");
      return finish(cfg, ctx, [], notes, pilots, zone, limit, centreline, label, terrain, floor);
    }
    const pilotXY = pilots.map((p) => ({ pilot: p, q: frame.toXY(p.lon, p.lat) }));
    const ordered = pilotXY.map((p) => ({ ...p, s: project(flightLine, p.q).s })).sort((x, y) => x.s - y.s);
    const FL = flightLine.length;
    ordered.forEach((st, k) => {
      const lo = k ? (ordered[k - 1].s + st.s) / 2 : 0;
      const hi = k < ordered.length - 1 ? (st.s + ordered[k + 1].s) / 2 : FL;
      if (hi - lo < 20) {
        note("warn", `${st.pilot.name} is very close to another pilot spot, so it gets no stretch of its own.`);
        return;
      }
      const sub = simplifyDP(substring(flightLine, lo, hi), cfg.chordTolM);
      const wps = corridorPatterns({ line: sub, altitudes: alts, speed: cfg.speedMps, opts: cfg.patterns });
      sections.push({ pilot: st.pilot, px: st.q, wps });
    });
  } else {
    if (cfg.area.length < 3) {
      note("issue", "Draw or load an area with at least 3 corners.");
      return emptyResult(notes, "no area");
    }
    const c0 = cfg.area.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
    const frame = new Frame(c0[0] / cfg.area.length, c0[1] / cfg.area.length);
    const poly = cfg.area.map((p) => frame.toXY(p[0], p[1]));
    const inset = cfg.insetAreaM;
    ctx = { frame, inset, margin: (q) => signedMargin(q, poly), flightLine: null, flightStartAbsM: 0, zoneAssumed: false };
    zone = [cfg.area];
    label = `area ${(polygonArea(poly) / 1e4).toFixed(1)} ha`;
    if (!pilots.length) {
      note("issue", "Add a pilot spot (click the map where the pilot will stand).");
      return finish(cfg, ctx, [], notes, pilots, zone, limit, centreline, label, terrain, floor);
    }
    if (pilots.length > 1) note("warn", "Area mode uses the first pilot spot only.");
    const px = frame.toXY(pilots[0].lon, pilots[0].lat);
    const res = areaPatterns({ polygon: poly, inset, altitudes: alts, speed: cfg.speedMps, opts: cfg.areaOptions });
    if (res.droppedLanePieces > 0) note("warn", `${res.droppedLanePieces} lane piece(s) were skipped because the area is not a simple shape at that heading. Check the plan on the map.`);
    if (!res.waypoints.some((w) => w.rto !== "A-VP")) throw new PlanError(`The area is too small for lanes: after the ${inset} m edge margin nothing is left to fly.`);
    sections.push({ pilot: pilots[0], px, wps: res.waypoints });
  }

  // split into flights
  const flights: Flight[] = [];
  for (const sec of sections) {
    if (sec.wps.length < 2) continue;
    const wps = densify(sec.wps, cfg.time.maxLegM);
    const sp = splitFlights({ wps, pilot: sec.px, tm: cfg.time, budgetS, vlosM: cfg.vlosM });
    if (sp.error) {
      const w = wps[sp.ranges.length ? sp.ranges[sp.ranges.length - 1][1] : 0];
      const ll = ctx.frame.toLL(w.x, w.y);
      note("issue", `${sec.pilot.name}: ${sp.error}. Add a pilot spot near ${ll[1].toFixed(5)}, ${ll[0].toFixed(5)} or shorten the stretch.`);
    }
    for (const [i, j] of sp.ranges) {
      const slice = wps.slice(i, j + 1);
      flights.push(buildFlight(cfg, ctx, flights.length + 1, sec, slice, budgetS, floor, terrain));
    }
  }
  return finish(cfg, ctx, flights, notes, pilots, zone, limit, centreline, label, terrain, floor);
}

function unit(a: XY, b: XY): XY {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
}

function emptyResult(notes: Note[], label: string): PlanResult {
  return { flights: [], notes, verdict: "NOT_READY", pilots: [], zone: [], planningLimit: [], centreline: [], zoneAssumed: false, summary: { flights: 0, totalMin: 0, measuredKm: 0, label } };
}

function finish(
  cfg: PlanConfig, ctx: Context, flights: Flight[], notes: Note[], pilots: Pilot[], zone: LonLat[][], limit: LonLat[][],
  centreline: LonLat[], label: string, terrain: Terrain | undefined, _floor: number,
): PlanResult {
  if (flights.length && !terrain) {
    notes.push({ level: "warn", message: "No ground-elevation data: height above ground is assumed equal to height above the launch point. Where the ground is lower than the launch spot, the real height is higher, so keep a margin below the ceiling." });
  }
  let verdict: Verdict;
  if (!flights.length) verdict = "NOT_READY";
  else verdict = flights.some((f) => f.issues.length) || notes.some((n) => n.level === "issue") ? "FAIL" : "PASS";
  const totalMin = flights.reduce((s, f) => s + f.timeS, 0) / 60;
  const measuredKm = flights.reduce((s, f) => s + f.lengthM, 0) / 1000;
  void cfg;
  return { flights, notes, verdict, pilots, zone, planningLimit: limit, centreline, zoneAssumed: ctx.zoneAssumed, summary: { flights: flights.length, totalMin, measuredKm, label } };
}

function buildFlight(cfg: PlanConfig, ctx: Context, idx: number, sec: Section, raw: RawWp[], budgetS: number, floor: number, terrain?: Terrain): Flight {
  const { frame, margin, inset } = ctx;
  const pilot = sec.pilot, px = sec.px;
  const waypoints: Waypoint[] = raw.map((w) => {
    const ll = frame.toLL(w.x, w.y);
    let block = "";
    if (ctx.flightLine) {
      const s = ctx.flightStartAbsM + project(ctx.flightLine, [w.x, w.y]).s;
      block = `B${pad3(Math.floor(s / cfg.blockLenM) + 1)}`;
    }
    return { lon: ll[0], lat: ll[1], x: w.x, y: w.y, altM: w.z, speedMps: w.v, hoverS: w.hover, rto: w.rto, block, note: w.note, split: !!w.split };
  });
  const timeS = flightTime(raw, px, cfg.time);

  const obstacles = cfg.obstacles.map((o: Obstacle) => ({ o, q: frame.toXY(o.lon, o.lat) }));
  const groundLaunch = terrain?.elevationAt(pilot.lon, pilot.lat) ?? null;
  const issues: Issue[] = [];
  const warnings: string[] = [];
  let minMargin = Infinity, maxDist = 0, maxAlt = 0, maxAgl = 0, len = 0;
  let marginBad = 0, firstMarginBad: Issue["at"], altBad: Issue["at"], floorBad: Issue["at"], distBad: Issue["at"];
  let firstFailure: Flight["firstFailure"] = null;
  const obsHit = new Map<string, Issue["at"]>();
  const mark = (at: { lon: number; lat: number }) => { if (!firstFailure) firstFailure = at; };

  const sampleAt = (x: number, y: number, z: number) => {
    const q: XY = [x, y];
    const m = margin(q);
    if (m < minMargin) minMargin = m;
    let ll: { lon: number; lat: number } | null = null;
    const here = () => ll ?? (ll = (() => { const p = frame.toLL(x, y); return { lon: p[0], lat: p[1] }; })());
    if (m < inset - 0.05) { marginBad++; if (!firstMarginBad) { firstMarginBad = here(); mark(here()); } }
    let agl = z;
    if (terrain && groundLaunch != null) {
      const g = terrain.elevationAt(frame.toLL(x, y)[0], frame.toLL(x, y)[1]);
      if (g != null) agl = z + groundLaunch - g;
    }
    if (agl > maxAgl) maxAgl = agl;
    if (z > maxAlt) maxAlt = z;
    if (agl > cfg.ceilingM + 1e-6 && !altBad) { altBad = here(); mark(here()); }
    if (z < floor - 1e-6 && !floorBad) { floorBad = here(); mark(here()); }
    const dist = Math.hypot(x - px[0], y - px[1]);
    if (dist > maxDist) maxDist = dist;
    if (dist > cfg.vlosM + 1e-6 && !distBad) { distBad = here(); mark(here()); }
    for (const { o, q: oq } of obstacles) {
      if (Math.hypot(x - oq[0], y - oq[1]) <= o.radiusM && z < o.heightM + cfg.obstacleClearanceM && !obsHit.has(o.name)) { obsHit.set(o.name, here()); mark(here()); }
    }
  };

  const step = cfg.sampleStepM;
  sampleAt(raw[0].x, raw[0].y, raw[0].z);
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    len += d;
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      sampleAt(a.x + f * (b.x - a.x), a.y + f * (b.y - a.y), a.z + f * (b.z - a.z));
    }
  }

  if (marginBad) issues.push({ message: `The path comes closer than ${inset} m to the zone edge or leaves the zone (about ${Math.round(marginBad * step)} m of path).`, at: firstMarginBad });
  if (altBad) issues.push({ message: `Height above ground reaches ${maxAgl.toFixed(1)} m, above the ceiling of ${cfg.ceilingM.toFixed(1)} m.`, at: altBad });
  if (floorBad) issues.push({ message: `The path goes below the minimum altitude of ${floor} m.`, at: floorBad });
  if (distBad) issues.push({ message: `The drone gets ${Math.round(maxDist)} m from the pilot (limit ${cfg.vlosM} m). Add a pilot spot nearer.`, at: distBad });
  obsHit.forEach((at, name) => issues.push({ message: `The path passes too close to ${name}.`, at }));
  if (timeS > budgetS + 1e-6) issues.push({ message: `The flight takes ${(timeS / 60).toFixed(1)} min, more than the ${cfg.batteryMin} min battery limit.` });

  for (const [w, lbl] of [[raw[0], "inbound"], [raw[raw.length - 1], "outbound"]] as const) {
    const dd = Math.hypot(w.x - px[0], w.y - px[1]);
    const n = Math.max(1, Math.ceil(dd / 2));
    let outside = false;
    for (let k = 0; k <= n && !outside; k++) {
      const f = k / n;
      if (margin([px[0] + f * (w.x - px[0]), px[1] + f * (w.y - px[1])]) < -0.01) outside = true;
    }
    if (outside) warnings.push(`The straight ${lbl} line between ${pilot.name} and the route leaves the fly zone. A straight-line return-to-home would cross outside it, so use Backtrack as the return mode.`);
  }

  return {
    idx, pilot, waypoints, timeS, lengthM: len, minMarginM: minMargin, maxDistFromPilotM: maxDist, maxAltM: maxAlt, issues, warnings, firstFailure,
  };
}
