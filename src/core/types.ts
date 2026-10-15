/** Core types. No DOM, no map library: everything here is plain data. */

/** [longitude, latitude] in degrees (GeoJSON order). */
export type LonLat = [number, number];
/** [east, north] in metres in the plan's local frame. */
export type XY = [number, number];

export interface Pilot {
  name: string;
  lon: number;
  lat: number;
  /** True for auto-placed stand-ins that are not real launch spots. */
  placeholder?: boolean;
}

export interface Obstacle {
  name: string;
  lon: number;
  lat: number;
  heightM: number;
  radiusM: number;
}

export interface PatternOptions {
  /** One pass along the track per altitude, alternating direction. */
  linear: boolean;
  /** Fly every altitude again in reverse order so each is flown in both directions. */
  bothSweeps: boolean;
  /** Saw-tooth climb/descend pass. */
  porpoise: boolean;
  porpoiseHalfPeriodM: number;
  /** Lowest altitude of the saw-tooth (also at least the lowest layer). */
  porpoiseMinAltM: number;
  /** Vertical profiles every N metres. */
  columns: boolean;
  columnSpacingM: number;
}

export interface AreaOptions {
  laneSpacingM: number;
  /** Lane direction, degrees clockwise from north. */
  headingDeg: number;
  /** Rotate lanes by 90 degrees on alternate altitudes. */
  crosshatch: boolean;
  /** Slow vertical profile at the centroid. */
  verticalProfile: boolean;
  verticalProfileSpeedMps: number;
}

export interface TimeModel {
  climbRateMps: number;
  overheadPerWaypointS: number;
  maxLegM: number;
}

export interface PlanConfig {
  mode: "corridor" | "area";
  /** Rail centreline for corridor mode, full length. */
  line: LonLat[];
  startKm: number;
  lengthM: number;
  halfWidthM: number;
  /** Approved fly-zone polygon (corridor or area). Null = use the assumed zone. */
  zone: LonLat[] | null;
  /** Area-mode outline (ignored when mode is corridor). */
  area: LonLat[];
  insetCorridorM: number;
  insetAreaM: number;
  pilots: Pilot[];
  /** When set and `pilots` is empty, place placeholder pilots every N metres. */
  autoPilotSpacingM: number | null;
  obstacles: Obstacle[];
  obstacleClearanceM: number;
  altitudesM: number[];
  speedMps: number;
  batteryMin: number;
  ceilingM: number;
  floorM: number | null; // null = lowest altitude layer
  vlosM: number;
  patterns: PatternOptions;
  areaOptions: AreaOptions;
  time: TimeModel;
  /** Check height above ground with USGS 3DEP elevation (the UI fetches it). Affects checks only, never the waypoints. */
  useGroundElevation: boolean;
  blockLenM: number;
  chordTolM: number;
  sampleStepM: number;
}

export interface Waypoint {
  lon: number;
  lat: number;
  x: number;
  y: number;
  /** Metres above the launch point (Skydio waypoint altitude). */
  altM: number;
  speedMps: number;
  hoverS: number;
  /** Route Test Objective ID, e.g. C-LIN-60. */
  rto: string;
  /** Corridor distance block, e.g. B045 (250 m blocks from km 0). Empty in area mode. */
  block: string;
  note: string;
  /** True for points inserted only so a flight can end mid-leg. */
  split: boolean;
}

export interface Issue {
  message: string;
  at?: { lon: number; lat: number };
}

export interface Flight {
  idx: number;
  pilot: Pilot;
  waypoints: Waypoint[];
  timeS: number;
  lengthM: number;
  minMarginM: number;
  maxDistFromPilotM: number;
  maxAltM: number;
  issues: Issue[];
  warnings: string[];
  /** First point that fails any check. */
  firstFailure: { lon: number; lat: number } | null;
}

export type NoteLevel = "info" | "warn" | "issue";
export interface Note {
  level: NoteLevel;
  message: string;
}

export type Verdict = "PASS" | "FAIL" | "NOT_READY";

export interface PlanResult {
  flights: Flight[];
  notes: Note[];
  verdict: Verdict;
  pilots: Pilot[];
  /** Fly zone, planning limit (inset) and flown centreline, for display. */
  zone: LonLat[][];
  planningLimit: LonLat[][];
  centreline: LonLat[];
  zoneAssumed: boolean;
  summary: { flights: number; totalMin: number; measuredKm: number; label: string };
}

export interface Terrain {
  /** Ground elevation (m, any datum) at a point, or null if unknown. */
  elevationAt(lon: number, lat: number): number | null;
}
