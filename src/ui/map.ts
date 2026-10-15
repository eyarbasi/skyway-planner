import L from "leaflet";
import { FT, cumulativeLengthLL, cutLonLat } from "../core";
import type { LonLat } from "../core";
import { AIRPORTS } from "../data/skyway";
import { BASEMAPS, makeGoogleLayer } from "./basemaps";
import { flightColor } from "./colors";
import type { Store } from "./state";

export interface MapHandlers {
  onClick(lat: number, lon: number): void;
  onPilotMoved(index: number, lat: number, lon: number): void;
  onObstacleMoved(index: number, lat: number, lon: number): void;
  onAreaVertexMoved(index: number, lat: number, lon: number): void;
  onAreaVertexRemoved(index: number): void;
  onSelectFlight(idx: number): void;
  onBasemapProblem(id: string): void;
}

const ll = (p: LonLat): L.LatLngTuple => [p[1], p[0]];

export class MapView {
  readonly map: L.Map;
  private base: L.Layer | null = null;
  private baseId = "";
  private readonly gContext = L.layerGroup();
  private readonly gTicks = L.layerGroup();
  private readonly gPlan = L.layerGroup();
  private readonly gEdit = L.layerGroup();
  private fitToken = 0;
  private lineRef: LonLat[] | null = null;
  private overlays = { line: true, nodes: true, ticks: true, zone: true };

  constructor(container: HTMLElement, private readonly store: Store, private readonly h: MapHandlers) {
    this.map = L.map(container, { zoomControl: true, preferCanvas: true, maxZoom: 21 });
    this.map.setView([42.285, -83.72], 13);
    this.gContext.addTo(this.map);
    this.gTicks.addTo(this.map);
    this.gPlan.addTo(this.map);
    this.gEdit.addTo(this.map);
    L.control.scale({ imperial: true, metric: true }).addTo(this.map);
    this.map.on("click", (e: L.LeafletMouseEvent) => this.h.onClick(e.latlng.lat, e.latlng.lng));
    this.map.on("zoomend", () => this.drawTicks());
    this.drawContext();
    this.drawTicks();
  }

  setBasemap(id: string): void {
    const def = BASEMAPS.find((b) => b.id === id);
    if (!def) return;
    this.installBase(id, def.make());
  }

  async setGoogle(key: string): Promise<void> {
    this.installBase("google", await makeGoogleLayer(key));
  }

  private installBase(id: string, layer: L.Layer): void {
    if (this.base) this.map.removeLayer(this.base);
    this.base = layer;
    this.baseId = id;
    let loaded = 0, failed = 0, told = false;
    layer.on("tileload", () => { loaded++; });
    layer.on("tileerror", () => {
      failed++;
      if (!told && loaded === 0 && failed >= 6) { told = true; this.h.onBasemapProblem(id); }
    });
    layer.addTo(this.map);
    (layer as L.GridLayer).bringToBack();
  }

  get currentBasemap(): string {
    return this.baseId;
  }

  setOverlay(name: "line" | "nodes" | "ticks" | "zone", on: boolean): void {
    this.overlays[name] = on;
    this.drawContext();
    this.drawTicks();
    this.render();
  }

  getOverlays() {
    return { ...this.overlays };
  }

  /** Skyway line and airports: context only. */
  private drawContext(): void {
    this.gContext.clearLayers();
    if (this.overlays.line) {
      L.polyline(this.store.state.cfg.line.map(ll), { color: "#ffd43b", weight: 2, opacity: 0.9, dashArray: "6 6", interactive: false }).addTo(this.gContext);
    }
    if (this.overlays.nodes) {
      AIRPORTS.forEach((a) =>
        L.circleMarker([a.lat, a.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#364fc7", fillOpacity: 1 })
          .bindTooltip(`${a.name} (${a.code}), approximate<br>Check airspace in Aloft / B4UFLY before flying nearby`).addTo(this.gContext));
    }
  }

  /** Kilometre ticks along the Skyway: every 5 km zoomed out, every km zoomed in. */
  private drawTicks(): void {
    this.gTicks.clearLayers();
    if (!this.overlays.ticks || !this.overlays.line) return;
    const line = this.store.state.cfg.line;
    if (line.length < 2) return;
    const total = cumulativeLengthLL(line).at(-1)!;
    const z = this.map.getZoom();
    const step = z >= 14 ? 500 : z >= 12 ? 1000 : z >= 10 ? 5000 : 10000;
    for (let s = 0; s <= total; s += step) {
      const p = cutLonLat(line, s, s)[0];
      const km = s / 1000;
      L.marker(ll(p), {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: "km-tick", html: `<span>${Number.isInteger(km) ? km : km.toFixed(1)}</span>`, iconSize: [30, 14], iconAnchor: [15, 7] }),
      }).addTo(this.gTicks);
    }
  }

  render(): void {
    const { cfg, result, sel, fitToken, arm } = this.store.state;
    if (cfg.line !== this.lineRef) {
      this.lineRef = cfg.line;
      this.drawContext();
      this.drawTicks();
    }
    this.gPlan.clearLayers();
    this.gEdit.clearLayers();
    if (this.overlays.zone) {
      result.zone.forEach((z) => L.polygon(z.map(ll), { color: result.zoneAssumed ? "#ff922b" : "#ff4d6d", weight: 2, dashArray: result.zoneAssumed ? "8 4" : undefined, fillOpacity: 0.1, interactive: false }).addTo(this.gPlan));
      result.planningLimit.forEach((z) => L.polygon(z.map(ll), { color: "#ffe066", weight: 1, dashArray: "4 4", fill: false, interactive: false }).addTo(this.gPlan));
    }
    for (const f of result.flights) {
      const c = flightColor(f.idx), selected = f.idx === sel;
      const pts = f.waypoints.map((w) => [w.lat, w.lon] as L.LatLngTuple);
      L.polyline(pts, { color: selected ? "#fff" : c, weight: selected ? 8 : 0, opacity: 0.9, interactive: false }).addTo(this.gPlan);
      L.polyline(pts, { color: c, weight: selected ? 5 : 3, opacity: selected ? 1 : 0.8 })
        .on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          // while a tool is armed (add pilot, obstacle...) a click on the path is a click on the map
          if (arm) this.h.onClick(e.latlng.lat, e.latlng.lng);
          else this.h.onSelectFlight(f.idx);
        })
        .bindTooltip(`Flight ${f.idx}: ${(f.timeS / 60).toFixed(1)} min`, { sticky: true })
        .addTo(this.gPlan);
      if (selected) {
        f.waypoints.forEach((w, k) => {
          if (w.split) return;
          L.circleMarker([w.lat, w.lon], { radius: 3.5, color: "#fff", weight: 1, fillColor: c, fillOpacity: 1, interactive: !arm })
            .bindTooltip(`Flight ${f.idx} · point ${k + 1}<br>${w.altM} m (${Math.round(w.altM / FT)} ft) above launch<br>${w.rto}${w.block ? " · " + w.block : ""}${w.note ? "<br>" + w.note : ""}`)
            .addTo(this.gPlan);
        });
      }
      if (f.firstFailure) {
        L.circleMarker([f.firstFailure.lat, f.firstFailure.lon], { radius: 10, color: "#ff0033", weight: 3, fill: false })
          .bindTooltip(`Flight ${f.idx}: first problem point`).addTo(this.gPlan);
      }
    }
    // pilots, with their distance circle
    result.pilots.forEach((p, k) => {
      const icon = L.divIcon({ className: "", html: `<div class="pilot${p.placeholder ? " placeholder" : ""}" title="${p.name}">${k + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
      L.marker([p.lat, p.lon], { draggable: true, icon, title: p.name, keyboard: true })
        .on("dragend", (e) => { const q = (e.target as L.Marker).getLatLng(); this.h.onPilotMoved(k, q.lat, q.lng); })
        .bindTooltip(`${p.name}${p.placeholder ? " (placeholder)" : ""}`).addTo(this.gEdit);
      if (cfg.mode === "corridor" || k === 0) {
        L.circle([p.lat, p.lon], { radius: cfg.vlosM, color: "#fff", weight: 1, dashArray: "2 6", fill: false, interactive: false }).addTo(this.gEdit);
      }
    });
    cfg.obstacles.forEach((o, k) => {
      L.circle([o.lat, o.lon], { radius: o.radiusM, color: "#ff922b", weight: 2, fillOpacity: 0.15, interactive: false }).addTo(this.gEdit);
      L.marker([o.lat, o.lon], { draggable: true, icon: L.divIcon({ className: "", html: `<div class="obstacle" title="${o.name}">!</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }), title: o.name })
        .on("dragend", (e) => { const q = (e.target as L.Marker).getLatLng(); this.h.onObstacleMoved(k, q.lat, q.lng); })
        .bindTooltip(`${o.name}: ${o.heightM} m tall, keep-out ${o.radiusM} m`).addTo(this.gEdit);
    });
    if (cfg.mode === "area") {
      cfg.area.forEach((p, k) => {
        L.marker([p[1], p[0]], { draggable: true, icon: L.divIcon({ className: "", html: `<div class="vertex"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }), title: "Drag to move this corner, double-click to remove it" })
          .on("dragend", (e) => { const q = (e.target as L.Marker).getLatLng(); this.h.onAreaVertexMoved(k, q.lat, q.lng); })
          .on("dblclick", (e) => { L.DomEvent.stopPropagation(e); this.h.onAreaVertexRemoved(k); })
          .addTo(this.gEdit);
      });
      if (arm === "area" && cfg.area.length > 1) L.polyline([...cfg.area, cfg.area[0]].map(ll), { color: "#ff4d6d", weight: 2, dashArray: "4 4", interactive: false }).addTo(this.gEdit);
    }
    this.map.getContainer().style.cursor = arm ? "crosshair" : "";
    if (fitToken !== this.fitToken) {
      this.fitToken = fitToken;
      this.fit();
    }
  }

  fit(): void {
    const { result, cfg } = this.store.state;
    const pts: L.LatLngTuple[] = [];
    result.zone.forEach((z) => z.forEach((p) => pts.push(ll(p))));
    if (!pts.length) cfg.area.forEach((p) => pts.push(ll(p)));
    if (pts.length) this.map.fitBounds(L.latLngBounds(pts).pad(0.3), { animate: false, maxZoom: 17 });
  }
}
