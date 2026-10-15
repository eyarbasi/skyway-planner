import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { KmlError, parseKml, parseKmlBytes } from "../src/io/kml";
import { readFixture } from "./helpers";

describe("KML import", () => {
  const ns = readFixture("corridor_zone.kml");

  it("reads polygons, lines and points from a namespaced file", () => {
    expect(ns).toContain('xmlns="http://www.opengis.net/kml/2.2"');
    const f = parseKml(ns);
    expect(f.polygons.length).toBe(1);
    expect(f.polygons[0].ring.length).toBeGreaterThanOrEqual(3);
    expect(parseKml(readFixture("centerline.kml")).lines.length).toBe(1);
    const pts = parseKml(readFixture("stations.kml")).points;
    expect(pts.length).toBe(3);
    expect(pts[0].name).toBeTruthy();
  });

  it("gives the same result without the namespace", () => {
    const plain = ns.replace(' xmlns="http://www.opengis.net/kml/2.2"', "");
    expect(plain).not.toContain("xmlns");
    expect(parseKml(plain)).toEqual(parseKml(ns));
  });

  it("reads KMZ (a zip with a kml inside), whatever the inner file is called", () => {
    const kmz = zipSync({ "doc.kml": strToU8(ns) });
    expect(parseKmlBytes(kmz, "zone.kmz")).toEqual(parseKml(ns));
    const odd = zipSync({ "files/other.kml": strToU8(ns) });
    expect(parseKmlBytes(odd, "z.kmz")).toEqual(parseKml(ns));
  });

  it("reads plain KML bytes", () => {
    expect(parseKmlBytes(strToU8(ns), "zone.kml")).toEqual(parseKml(ns));
  });

  it("drops the closing duplicate point of a ring and ignores altitude", () => {
    const f = parseKml(`<kml><Placemark><name>z</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
      -83.7,42.3,100 -83.69,42.3,100 -83.69,42.31,100 -83.7,42.31,100 -83.7,42.3,100</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`);
    expect(f.polygons[0].ring).toEqual([[-83.7, 42.3], [-83.69, 42.3], [-83.69, 42.31], [-83.7, 42.31]]);
    expect(f.polygons[0].name).toBe("z");
  });

  it("rejects a KMZ with no kml and text that is not XML", () => {
    expect(() => parseKmlBytes(zipSync({ "a.txt": strToU8("x") }), "a.kmz")).toThrow(KmlError);
    expect(() => parseKml("this is not xml <<")).toThrow(KmlError);
  });

  it("an empty but valid file gives no features", () => {
    expect(parseKml(`<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>`)).toEqual({ polygons: [], lines: [], points: [] });
  });
});
