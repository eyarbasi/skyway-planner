import "leaflet/dist/leaflet.css";
import "./ui/styles.css";
import { snapToLine } from "./core";
import { skywayData } from "./data/skyway";
import { EXPORTERS, ExporterUnavailableError, PlanFileError, parsePlan } from "./exporters";
import { applyKml } from "./io/applyKml";
import { KmlError, parseKmlBytes } from "./io/kml";
import { BASEMAPS } from "./ui/basemaps";
import { download, h, safeStorage } from "./ui/dom";
import { MapView } from "./ui/map";
import { buildPanel } from "./ui/panel";
import { buildPrintCards } from "./ui/print";
import { decodePlanHash, encodePlanHash } from "./ui/share";
import { Store, initialState, materializePilots } from "./ui/state";

const store = new Store(initialState());
const storage = safeStorage();
const KEY_STORAGE = "skyway-planner.googleKey";
const THEME_STORAGE = "skyway-planner.theme";

const app = document.getElementById("app")!;
const mapEl = h("div", { id: "map", role: "application", "aria-label": "Map" });
const panelEl = h("aside", { id: "panel", "aria-label": "Plan settings and results" });
const toastEl = h("div", { class: "toast", role: "status", "aria-live": "polite", hidden: true });
const printRoot = h("div", { id: "print-root", "aria-hidden": "true" });
app.append(mapEl, panelEl, toastEl, printRoot);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, ms = 6000): void {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

function stretchName(): string {
  const { cfg } = store.state;
  return cfg.mode === "corridor" ? `skyway_km${cfg.startKm.toFixed(1)}_${Math.round(cfg.lengthM)}m` : "area_plan";
}

const view = new MapView(mapEl, store, {
  onClick(lat, lon) {
    const s = store.state;
    if (!s.arm) return;
    if (s.arm === "start") {
      const snap = snapToLine(s.cfg.line, lon, lat);
      if (snap.offsetM > 1500) { toast("That is far from the rail line. Click closer to the dashed yellow line."); return; }
      store.edit((c, st) => {
        c.startKm = Math.round(snap.s / 10) / 100;
        if (c.pilots.length && c.pilots.every((p) => p.placeholder)) { c.pilots = []; c.autoPilotSpacingM = st.autoSpacingM; }
        st.arm = null;
      });
    } else if (s.arm === "pilot") {
      store.edit((c) => {
        // the first real pilot spot replaces the placeholders; later ones are added
        if (c.pilots.every((p) => p.placeholder)) c.pilots = [];
        c.pilots.push({ name: `Pilot ${c.pilots.length + 1}`, lon, lat });
        c.autoPilotSpacingM = null;
      });
    } else if (s.arm === "obstacle") {
      store.edit((c, st) => {
        c.obstacles.push({ name: `Obstacle ${c.obstacles.length + 1}`, lon, lat, heightM: st.obstacleDefaults.heightM, radiusM: st.obstacleDefaults.radiusM });
        st.arm = null;
      });
    } else if (s.arm === "area") {
      store.edit((c) => { c.area.push([lon, lat]); });
    }
  },
  onPilotMoved(i, lat, lon) {
    store.edit((c, st) => {
      materializePilots(c, st);
      if (c.pilots[i]) c.pilots[i] = { ...c.pilots[i], lat, lon, placeholder: false };
    });
  },
  onObstacleMoved(i, lat, lon) { store.edit((c) => { if (c.obstacles[i]) { c.obstacles[i].lat = lat; c.obstacles[i].lon = lon; } }); },
  onAreaVertexMoved(i, lat, lon) { store.edit((c) => { if (c.area[i]) c.area[i] = [lon, lat]; }); },
  onAreaVertexRemoved(i) {
    if (store.state.cfg.area.length <= 3) { toast("An area needs at least 3 corners."); return; }
    store.edit((c) => { c.area.splice(i, 1); });
  },
  onSelectFlight(idx) { store.ui((s) => { s.sel = idx; }); },
  onAirspaceProblem() {
    toast("Could not load the FAA airspace outlines (needs internet). Check Aloft / B4UFLY instead.", 9000);
  },
  onBasemapProblem(id) {
    toast(`The ${BASEMAPS.find((b) => b.id === id)?.label ?? "imagery"} is not loading. Try another source under “Map”, or check your connection.`, 9000);
  },
});

const panel = buildPanel(panelEl, store, {
  arm: (tool) => store.ui((s) => { s.arm = tool; }),
  basemap: (id) => {
    if (id === "google") { const k = storage.get(KEY_STORAGE); if (k) void startGoogle(k); return; }
    view.setBasemap(id);
  },
  google: (key) => void startGoogle(key),
  exportWith(id) {
    const e = EXPORTERS.find((x) => x.id === id);
    if (!e) return;
    try {
      const f = e.export({ name: stretchName(), config: store.state.cfg, plan: store.state.result });
      download(f.filename, f.content, f.mime);
    } catch (err) {
      toast(err instanceof ExporterUnavailableError ? err.message : "Could not make that file.");
    }
  },
  async openPlanFile(file) {
    try {
      store.setConfig(parsePlan(await file.text()), { fit: true });
      toast("Plan opened.");
    } catch (err) {
      toast(err instanceof PlanFileError ? err.message : "Could not open that file.");
    }
  },
  async importKmlFile(file) {
    try {
      const feats = parseKmlBytes(new Uint8Array(await file.arrayBuffer()), file.name);
      const r = applyKml(feats, store.state.cfg);
      if (r.changed) store.setConfig(r.cfg, { fit: true });
      toast(r.messages.join(" "));
    } catch (err) {
      toast(err instanceof KmlError ? err.message : "Could not read that file.");
    }
  },
  async copyLink() {
    const url = `${location.origin}${location.pathname}#${encodePlanHash(store.state.cfg, skywayData().line)}`;
    try { await navigator.clipboard.writeText(url); toast("Link copied. Anyone who opens it gets this exact plan."); }
    catch { history.replaceState(null, "", url); toast("Copy the link from the address bar."); }
  },
  setOverlay: (name, on) => view.setOverlay(name, on),
  toggleTheme() {
    const cur = document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    storage.set(THEME_STORAGE, next);
  },
  printCards() {
    if (!store.state.result.flights.length) { toast("There are no flights to print yet."); return; }
    buildPrintCards(printRoot, store.state);
    window.print();
  },
  basemapIds: () => BASEMAPS.map((b) => ({ id: b.id, label: b.label, note: b.note })),
  googleKey: () => storage.get(KEY_STORAGE) ?? "",
});

async function startGoogle(key: string): Promise<void> {
  const msg = document.getElementById("gmsg");
  if (!key) { if (msg) msg.textContent = "Paste a key first."; return; }
  try {
    await view.setGoogle(key);
    storage.set(KEY_STORAGE, key);
    panel.refreshBasemaps("google");
    if (msg) msg.textContent = "Google satellite is on. You can switch back under Map imagery.";
  } catch (err) {
    if (msg) msg.textContent = `Google imagery did not start: ${(err as Error).message}. Check the key and that the Map Tiles API is enabled.`;
    toast("Google imagery did not start. Check the key and that the Map Tiles API is enabled.");
  }
}

store.subscribe((s, why) => {
  panel.sync(s, why);
  view.render();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && store.state.arm) store.ui((s) => { s.arm = null; });
});

// ---- start up ----
const savedTheme = storage.get(THEME_STORAGE);
if (savedTheme === "dark" || savedTheme === "light") document.documentElement.dataset.theme = savedTheme;

try {
  const shared = decodePlanHash(location.hash, skywayData().line);
  if (shared) store.state.cfg = shared;
} catch (err) {
  toast((err as Error).message);
}
view.setBasemap("usgs");
store.replan();
const key = storage.get(KEY_STORAGE);
if (key) { const k = document.getElementById("gkey") as HTMLInputElement | null; if (k) k.value = key; panel.refreshBasemaps("usgs"); }

// Handles for tests and debugging in the browser console.
(window as unknown as { __skyway?: unknown }).__skyway = { store, view };
