import { describe, expect, it } from "vitest";
import { airspaceUrl, fetchAirspace, parseAirspace } from "../src/io/airspace";

const ring = [[-83.5, 42.2], [-83.4, 42.2], [-83.4, 42.3], [-83.5, 42.2]];
const reply = {
  features: [
    { properties: { IDENT: "YIP", NAME: "WILLOW RUN CLASS D", CLASS: "D", UPPER_VAL: 3000 }, geometry: { type: "Polygon", coordinates: [ring] } },
    { properties: { IDENT: "DTW", NAME: "DETROIT CLASS B", CLASS: "B", UPPER_VAL: 10000 }, geometry: { type: "MultiPolygon", coordinates: [[ring], [ring]] } },
    { properties: { IDENT: "X", NAME: "CLASS E", CLASS: "E", UPPER_VAL: 1 }, geometry: { type: "Polygon", coordinates: [ring] } },
    { properties: { IDENT: "Y", NAME: "no geometry", CLASS: "C" } },
    { properties: { IDENT: "Z", NAME: "degenerate", CLASS: "D" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 1]]] } },
  ],
};

describe("FAA airspace outlines (display only)", () => {
  it("keeps only B, C and D polygons and reads class, ceiling and rings", () => {
    const a = parseAirspace(reply);
    expect(a.map((x) => `${x.ident}:${x.cls}:${x.topFt}:${x.rings.length}`)).toEqual(["YIP:D:3000:1", "DTW:B:10000:2"]);
  });
  it("rejects a reply that is not a feature list", () => {
    expect(() => parseAirspace({ error: { code: 400 } })).toThrow();
  });
  it("asks only for surface areas (floor 0) of B, C, D, inside the box", () => {
    const u = new URL(airspaceUrl({ west: -83.8, south: 42.15, east: -82.95, north: 42.45 }));
    expect(u.searchParams.get("where")).toContain("LOWER_VAL=0");
    expect(u.searchParams.get("where")).toContain("'B','C','D'");
    expect(u.searchParams.get("where")).toContain("IDENT LIKE '___'");
    expect(u.searchParams.get("geometry")).toBe("-83.8,42.15,-82.95,42.45");
    expect(u.searchParams.get("f")).toBe("geojson");
  });
  it("reports a service error instead of drawing nothing silently", async () => {
    await expect(fetchAirspace({ west: 0, south: 0, east: 1, north: 1 }, async () => ({ ok: false, status: 503, json: async () => ({}) }))).rejects.toThrow(/503/);
  });
});
