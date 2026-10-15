import type { PlanConfig } from "./types";

export const FT = 0.3048;
export const CEILING_400FT_M = 400 * FT; // 121.92

export function defaultConfig(line: PlanConfig["line"] = []): PlanConfig {
  return {
    mode: "corridor",
    line,
    startKm: 0,
    lengthM: 1500,
    halfWidthM: 15,
    zone: null,
    area: [],
    insetCorridorM: 5,
    insetAreaM: 10,
    pilots: [],
    autoPilotSpacingM: 500,
    obstacles: [],
    obstacleClearanceM: 15,
    altitudesM: [12, 30, 60, 90, 115],
    speedMps: 5,
    batteryMin: 22,
    ceilingM: CEILING_400FT_M,
    floorM: null,
    vlosM: 700,
    patterns: {
      linear: true,
      bothSweeps: false,
      porpoise: true,
      porpoiseHalfPeriodM: 200,
      porpoiseMinAltM: 15,
      columns: false,
      columnSpacingM: 250,
    },
    areaOptions: {
      laneSpacingM: 100,
      headingDeg: 0,
      crosshatch: true,
      verticalProfile: true,
      verticalProfileSpeedMps: 1,
    },
    time: { climbRateMps: 2, overheadPerWaypointS: 2, maxLegM: 100 },
    useGroundElevation: false,
    blockLenM: 250,
    chordTolM: 2,
    sampleStepM: 1,
  };
}
