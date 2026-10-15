import type { Flight } from "../core";
import { FT } from "../core";
import { h } from "./dom";

const SVG = "http://www.w3.org/2000/svg";
const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text) n.textContent = text;
  return n;
};

/** Altitude against distance flown, with the ceiling and minimum altitude drawn in. */
export function profileChart(f: Flight | undefined, ceilingM: number, floorM: number, color: string): HTMLElement {
  const box = h("figure", { class: "profile" });
  if (!f) return box;
  const W = 340, H = 150, pad = { l: 40, r: 10, t: 12, b: 26 };
  let d = 0;
  const pts: [number, number][] = f.waypoints.map((w, i) => {
    if (i) d += Math.hypot(w.x - f.waypoints[i - 1].x, w.y - f.waypoints[i - 1].y);
    return [d, w.altM];
  });
  const D = Math.max(d, 1);
  const Z = Math.max(ceilingM, ...pts.map((p) => p[1])) * 1.05;
  const X = (v: number) => pad.l + ((W - pad.l - pad.r) * v) / D;
  const Y = (v: number) => H - pad.b - ((H - pad.t - pad.b) * v) / Z;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-labelledby": `pf-t-${f.idx}`, class: "chart" });
  svg.append(el("title", { id: `pf-t-${f.idx}` }, `Altitude profile for flight ${f.idx}: up to ${f.maxAltM.toFixed(0)} m above launch over ${(D / 1000).toFixed(2)} km, ceiling ${ceilingM.toFixed(0)} m`));
  for (const t of [0, Math.round(Z / 2 / 10) * 10, Math.round(ceilingM / 10) * 10].filter((v, i, a) => a.indexOf(v) === i)) {
    svg.append(el("line", { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), class: "grid" }));
    svg.append(el("text", { x: pad.l - 5, y: Y(t) + 3.5, "text-anchor": "end", class: "tick" }, String(t)));
  }
  svg.append(el("line", { x1: pad.l, x2: W - pad.r, y1: Y(ceilingM), y2: Y(ceilingM), class: "ceil" }));
  svg.append(el("text", { x: W - pad.r, y: Y(ceilingM) - 3, "text-anchor": "end", class: "ceil-label" }, `ceiling ${ceilingM.toFixed(0)} m`));
  svg.append(el("line", { x1: pad.l, x2: W - pad.r, y1: Y(floorM), y2: Y(floorM), class: "floor" }));
  svg.append(el("text", { x: W - pad.r, y: Y(floorM) + 11, "text-anchor": "end", class: "floor-label" }, `minimum ${floorM.toFixed(0)} m`));
  svg.append(el("polyline", { points: pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" "), fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round" }));
  svg.append(el("text", { x: pad.l, y: H - 8, class: "tick" }, "0"));
  svg.append(el("text", { x: W - pad.r, y: H - 8, "text-anchor": "end", class: "tick" }, `${(D / 1000).toFixed(2)} km flown`));
  svg.append(el("text", { x: 4, y: 10, class: "tick" }, "m above launch"));
  box.append(svg, h("figcaption", { class: "hint" }, `Highest point ${f.maxAltM.toFixed(0)} m (${Math.round(f.maxAltM / FT)} ft) above the launch point.`));
  return box;
}
