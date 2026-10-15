import { FT } from "../core/defaults";
import type { Exporter } from "./types";

export const CSV_COLUMNS = [
  "flight", "seq", "lat", "lon", "alt_above_launch_m", "alt_above_launch_ft", "speed_mps", "hover_s",
  "route_test_objective", "block", "pilot", "pilot_lat", "pilot_lon", "note",
] as const;

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const csvExporter: Exporter = {
  id: "csv",
  label: "Waypoint table (CSV)",
  help: "One row per waypoint, for checking or typing into the controller. Altitudes are metres above the launch point.",
  available: true,
  export({ name, plan }) {
    const rows: (string | number)[][] = [[...CSV_COLUMNS]];
    for (const f of plan.flights) {
      f.waypoints.forEach((w, i) => {
        rows.push([
          f.idx, i + 1, w.lat.toFixed(7), w.lon.toFixed(7), w.altM, Math.round(w.altM / FT), w.speedMps, w.hoverS,
          w.rto, w.block, f.pilot.name, f.pilot.lat.toFixed(7), f.pilot.lon.toFixed(7), w.note,
        ]);
      });
    }
    return { filename: `${name}_waypoints.csv`, mime: "text/csv", content: rows.map((r) => r.map(cell).join(",")).join("\n") + "\n" };
  },
};
