import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import type { LonLat, PlanConfig } from "../core";
import { parsePlan, serializePlan } from "../exporters";

const toB64Url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const sameLine = (a: LonLat[], b: LonLat[]) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

/** A plan as a short URL fragment. The built-in Skyway line is left out to keep links short. */
export function encodePlanHash(cfg: PlanConfig, defaultLine: LonLat[]): string {
  const slim = sameLine(cfg.line, defaultLine) ? { ...cfg, line: [] as LonLat[] } : cfg;
  return "plan=" + toB64Url(deflateSync(strToU8(serializePlan(slim)), { level: 9 }));
}

/** Returns null when the fragment holds no plan. Throws a plain message if it does but is damaged. */
export function decodePlanHash(hash: string, defaultLine: LonLat[]): PlanConfig | null {
  const m = /(?:^|[#&])plan=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  let text: string;
  try {
    text = strFromU8(inflateSync(fromB64Url(m[1])));
  } catch {
    throw new Error("That link is damaged.");
  }
  const cfg = parsePlan(text);
  return cfg.line.length < 2 ? { ...cfg, line: defaultLine } : cfg;
}
