/** KML / KMZ import. Works with and without the KML namespace. Altitudes are ignored. */
import { unzipSync, strFromU8 } from "fflate";
import type { LonLat } from "../core/types";

export interface KmlPolygon { name: string; ring: LonLat[] }
export interface KmlLine { name: string; coords: LonLat[] }
export interface KmlPoint { name: string; lon: number; lat: number }
export interface KmlFeatures { polygons: KmlPolygon[]; lines: KmlLine[]; points: KmlPoint[] }

export class KmlError extends Error {}

function parseCoords(text: string): LonLat[] {
  const out: LonLat[] = [];
  for (const tok of text.trim().split(/\s+/)) {
    const p = tok.split(",").map(Number);
    if (p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push([p[0], p[1]]);
  }
  return out;
}

const all = (root: Element | Document, tag: string): Element[] => Array.from(root.getElementsByTagNameNS("*", tag));

function placemarkName(el: Element): string {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.localName === "Placemark") {
      const nm = Array.from(n.children).find((c) => c.localName === "name");
      return nm?.textContent?.trim() || "";
    }
  }
  return "";
}

export function parseKml(text: string): KmlFeatures {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new KmlError("That file is not valid KML.");
  const feats: KmlFeatures = { polygons: [], lines: [], points: [] };
  for (const poly of all(doc, "Polygon")) {
    const outer = all(poly, "outerBoundaryIs")[0] ?? poly;
    const c = all(outer, "coordinates")[0];
    if (!c) continue;
    let ring = parseCoords(c.textContent || "");
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
    if (ring.length >= 3) feats.polygons.push({ name: placemarkName(poly), ring });
  }
  for (const ls of all(doc, "LineString")) {
    const c = all(ls, "coordinates")[0];
    const coords = c ? parseCoords(c.textContent || "") : [];
    if (coords.length >= 2) feats.lines.push({ name: placemarkName(ls), coords });
  }
  for (const pt of all(doc, "Point")) {
    const c = all(pt, "coordinates")[0];
    const p = c ? parseCoords(c.textContent || "")[0] : undefined;
    if (p) feats.points.push({ name: placemarkName(pt) || "Point", lon: p[0], lat: p[1] });
  }
  return feats;
}

/** Read a .kml or .kmz (bytes) into features. */
export function parseKmlBytes(bytes: Uint8Array, filename: string): KmlFeatures {
  const isZip = filename.toLowerCase().endsWith(".kmz") || (bytes[0] === 0x50 && bytes[1] === 0x4b);
  if (!isZip) return parseKml(new TextDecoder().decode(bytes));
  const files = unzipSync(bytes);
  const name = Object.keys(files).find((n) => n.toLowerCase() === "doc.kml") ?? Object.keys(files).find((n) => n.toLowerCase().endsWith(".kml"));
  if (!name) throw new KmlError("That KMZ has no .kml inside.");
  return parseKml(strFromU8(files[name]));
}
