import L from "leaflet";

export interface BasemapDef {
  id: string;
  label: string;
  /** One line shown under the choice, in plain words. */
  note: string;
  make(): L.Layer;
}

/** Web-mercator bounds of a tile, for services that only export by bounding box. */
function tileBounds3857(x: number, y: number, z: number): [number, number, number, number] {
  const R = 20037508.342789244;
  const size = (2 * R) / 2 ** z;
  return [-R + x * size, R - (y + 1) * size, -R + (x + 1) * size, R - y * size];
}

/**
 * USGS NAIP aerial photos (about 0.6 m per pixel, public domain), requested one tile at a time
 * from the USGS ImageServer. Sharper than the cached tiles, but each tile is rendered on demand, so it is slower.
 */
const NaipLayer = L.GridLayer.extend({
  createTile(this: L.GridLayer, coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const img = document.createElement("img");
    img.alt = "";
    const [x0, y0, x1, y1] = tileBounds3857(coords.x, coords.y, coords.z);
    const size = 256 * (window.devicePixelRatio > 1.5 ? 2 : 1);
    img.onload = () => done(undefined, img);
    img.onerror = () => done(new Error("tile failed"), img);
    img.src = `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox=${x0},${y0},${x1},${y1}&bboxSR=3857&imageSR=3857&size=${size},${size}&format=jpg&f=image`;
    return img;
  },
});

export const BASEMAPS: BasemapDef[] = [
  {
    id: "usgs",
    label: "USGS satellite (default)",
    note: "Aerial photos from the U.S. Geological Survey. Free, no key. Zoom 16 is the sharpest it has; closer than that it enlarges.",
    make: () =>
      L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 21, maxNativeZoom: 16,
        attribution: 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a> (public domain)',
      }),
  },
  {
    id: "naip",
    label: "USGS sharp aerial (NAIP, slower)",
    note: "The same U.S. Geological Survey source at about 60 cm detail. Each tile is made on request, so it loads slowly. Best when zoomed in.",
    make: () =>
      new (NaipLayer as unknown as new (o: L.GridLayerOptions) => L.GridLayer)({
        tileSize: 256, maxZoom: 21, maxNativeZoom: 19, minZoom: 10,
        attribution: 'Imagery: <a href="https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip">USGS / USDA NAIP</a> (public domain)',
      }),
  },
  {
    id: "s2",
    label: "Sentinel-2 cloudless (wide view)",
    note: "Open European satellite mosaic. Coarse (about 10 m), good for seeing the whole Skyway. Non-commercial use; see the terms at s2maps.eu.",
    make: () =>
      L.tileLayer("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg", {
        maxZoom: 21, maxNativeZoom: 14,
        attribution: '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2021)',
      }),
  },
  {
    id: "esri",
    label: "Esri World Imagery",
    note: "Sharper in towns. Free to view; check Esri's terms for anything beyond planning use.",
    make: () =>
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 21, maxNativeZoom: 19,
        attribution: 'Imagery © <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
      }),
  },
  {
    id: "osm",
    label: "Street map (OpenStreetMap)",
    note: "Roads and place names.",
    make: () =>
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 21, maxNativeZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }),
  },
];

/**
 * Google satellite through the official Map Tiles API only. The key comes from the user
 * and is kept in this browser's localStorage; it is never part of the app or a saved plan.
 */
export async function makeGoogleLayer(key: string): Promise<L.Layer> {
  const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapType: "satellite", language: "en-US", region: "US" }),
  });
  const j = (await r.json()) as { session?: string; error?: { message?: string } };
  if (!r.ok || !j.session) throw new Error(j.error?.message || "Google did not start a map session");
  return L.tileLayer(`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${j.session}&key=${encodeURIComponent(key)}`, {
    maxZoom: 21, maxNativeZoom: 20, tileSize: 256,
    attribution: 'Imagery © <a href="https://cloud.google.com/maps-platform/terms">Google</a>',
  });
}
