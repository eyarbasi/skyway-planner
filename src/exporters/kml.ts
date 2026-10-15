import { FT } from "../core/defaults";
import type { LonLat } from "../core/types";
import { xmlEscape, type Exporter } from "./types";

const COLORS = ["#1f77b4", "#e8590c", "#2b8a3e", "#c2255c", "#6741d9", "#0b7285", "#a61e4d", "#5c940d", "#d9480f", "#364fc7"];
/** KML colours are aabbggrr. */
const kmlColor = (hex: string, alpha = "ff") => `${alpha}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;
const ring = (r: LonLat[]) => [...r, r[0]].map((p) => `${p[0].toFixed(7)},${p[1].toFixed(7)},0`).join(" ");

export const kmlExporter: Exporter = {
  id: "kml",
  label: "Google Earth (KML)",
  help: "Zone, pilot spots and every flight as a 3D path you can fly over in Google Earth.",
  available: true,
  export({ name, plan }) {
    const k: string[] = [`<?xml version="1.0" encoding="UTF-8"?>`, `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEscape(name)}</name>`];
    COLORS.forEach((c, i) => k.push(`<Style id="s${i}"><LineStyle><color>${kmlColor(c)}</color><width>3</width></LineStyle></Style>`));
    k.push(`<Style id="zone"><LineStyle><color>ff6d4dff</color><width>2</width></LineStyle><PolyStyle><color>226d4dff</color></PolyStyle></Style>`);
    k.push(`<Style id="limit"><LineStyle><color>ff66e0ff</color><width>1</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>`);
    plan.zone.forEach((z) =>
      k.push(`<Placemark><name>Fly zone${plan.zoneAssumed ? " (ASSUMED, not approved)" : ""}</name><styleUrl>#zone</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(z)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`));
    plan.planningLimit.forEach((z) =>
      k.push(`<Placemark><name>Planning limit (edge margin)</name><styleUrl>#limit</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(z)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`));
    plan.pilots.forEach((p) =>
      k.push(`<Placemark><name>${xmlEscape(p.name)}</name><description>${p.placeholder ? "PLACEHOLDER pilot spot, not a real launch spot" : "Pilot spot"}</description><Point><coordinates>${p.lon.toFixed(7)},${p.lat.toFixed(7)},0</coordinates></Point></Placemark>`));
    for (const f of plan.flights) {
      const style = `s${(f.idx - 1) % COLORS.length}`;
      const coords = f.waypoints.map((w) => `${w.lon.toFixed(7)},${w.lat.toFixed(7)},${w.altM}`).join(" ");
      k.push(`<Folder><name>Flight ${f.idx} (${(f.timeS / 60).toFixed(1)} min, ${xmlEscape(f.pilot.name)})</name>`);
      k.push(`<Placemark><name>Path</name><styleUrl>#${style}</styleUrl><LineString><extrude>1</extrude><altitudeMode>relativeToGround</altitudeMode><coordinates>${coords}</coordinates></LineString></Placemark>`);
      f.waypoints.forEach((w, i) => {
        if (w.split) return; // split points are only there so a flight can end mid-leg
        k.push(`<Placemark><name>${f.idx}.${i + 1}</name><description>${w.altM} m (${Math.round(w.altM / FT)} ft) above launch; ${xmlEscape(w.rto)}; ${xmlEscape(w.block)}${w.note ? "; " + xmlEscape(w.note) : ""}</description><Point><altitudeMode>relativeToGround</altitudeMode><coordinates>${w.lon.toFixed(7)},${w.lat.toFixed(7)},${w.altM}</coordinates></Point></Placemark>`);
      });
      k.push(`</Folder>`);
    }
    k.push(`</Document></kml>`);
    return { filename: `${name}.kml`, mime: "application/vnd.google-earth.kml+xml", content: k.join("\n") };
  },
};
