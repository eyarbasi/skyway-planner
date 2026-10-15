import { FT } from "../core";
import { h } from "./dom";
import { flightColor } from "./colors";
import { profileChart } from "./profile";
import type { UiState } from "./state";

const CHECKLIST = [
  "Airspace checked (Aloft / B4UFLY); LAANC approval if near Willow Run or Detroit Metro",
  "Fly zone and altitude limit confirmed with flight operations",
  "Battery full; drone and phone mounted; QualiPoc recording and band set (one band per flight)",
  "Return mode set to Backtrack",
  "Waypoint mission loaded and checked against the table below",
  "Spotter in place; pilot can see the drone along the whole route",
];

/** One printable card per flight. Printed through the browser's own print dialog (Save as PDF works too). */
export function buildPrintCards(root: HTMLElement, s: UiState): void {
  root.replaceChildren();
  const floor = s.cfg.floorM ?? Math.min(...s.cfg.altitudesM);
  for (const f of s.result.flights) {
    const rows = f.waypoints.filter((w) => !w.split);
    root.append(h("article", { class: "card-page" },
      h("h2", null, `Flight ${f.idx} of ${s.result.flights.length} · ${s.result.summary.label}`),
      h("p", null, h("strong", null, "Pilot spot: "), `${f.pilot.name}${f.pilot.placeholder ? " (PLACEHOLDER, not a real launch spot)" : ""} · ${f.pilot.lat.toFixed(6)}, ${f.pilot.lon.toFixed(6)}`),
      h("p", null, `About ${(f.timeS / 60).toFixed(1)} min · ${(f.lengthM / 1000).toFixed(2)} km · highest ${f.maxAltM.toFixed(0)} m (${Math.round(f.maxAltM / FT)} ft) above launch · farthest from pilot ${Math.round(f.maxDistFromPilotM)} m · ${s.result.verdict}`),
      s.result.zoneAssumed ? h("p", { class: "print-warn" }, "Assumed fly zone: not approved. Load the approved polygon before flying.") : null,
      f.issues.length ? h("p", { class: "print-warn" }, `Problems: ${f.issues.map((i) => i.message).join(" ")}`) : null,
      profileChart(f, s.cfg.ceilingM, floor, flightColor(f.idx)),
      h("ul", { class: "checklist" }, ...CHECKLIST.map((c) => h("li", null, "☐ " + c))),
      h("table", { class: "wp" },
        h("thead", null, h("tr", null, ...["#", "Latitude", "Longitude", "m above launch", "ft", "m/s", "Tag", "Block", "Note"].map((t) => h("th", null, t)))),
        h("tbody", null, ...rows.map((w, i) => h("tr", null,
          h("td", null, String(i + 1)), h("td", null, w.lat.toFixed(6)), h("td", null, w.lon.toFixed(6)), h("td", null, String(w.altM)),
          h("td", null, String(Math.round(w.altM / FT))), h("td", null, String(w.speedMps)), h("td", null, w.rto), h("td", null, w.block), h("td", null, w.note)))))));
  }
}
