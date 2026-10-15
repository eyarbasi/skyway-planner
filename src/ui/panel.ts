import { FT } from "../core";
import type { Flight, PlanConfig } from "../core";
import { EXPORTERS } from "../exporters";
import { skywayData } from "../data/skyway";
import { cumulativeLengthLL } from "../core";
import { clear, h } from "./dom";
import { flightColor } from "./colors";
import { profileChart } from "./profile";
import { materializePilots } from "./state";
import type { Arm, Store, UiState } from "./state";

export interface PanelActions {
  arm(tool: Arm): void;
  basemap(id: string): void;
  google(key: string): void;
  exportWith(id: string): void;
  openPlanFile(file: File): void;
  importKmlFile(file: File): void;
  copyLink(): void;
  setOverlay(name: "line" | "nodes" | "airspace" | "ticks" | "zone", on: boolean): void;
  toggleTheme(): void;
  printCards(): void;
  basemapIds(): { id: string; label: string; note: string }[];
  googleKey(): string;
}

type Sync = () => void;
interface NumOpts { min?: number; max?: number; step?: number; unit?: string; hint?: string; placeholder?: string }

const stripNum = (s: string) => (s.trim() === "" ? NaN : Number(s));

export function buildPanel(root: HTMLElement, store: Store, act: PanelActions): { sync(s: UiState, why: "plan" | "ui"): void; refreshBasemaps(selected: string): void } {
  const syncs: Sync[] = [];
  const st = () => store.state;
  const edit = (m: (c: PlanConfig, s: UiState) => void, fit = false) => store.edit(m, { fit });
  let uid = 0;
  const id = () => `f${++uid}`;

  const num = (label: string, get: () => number | null, set: (v: number | null, c: PlanConfig) => void, o: NumOpts = {}, fit = false) => {
    const i = id();
    const input = h("input", { id: i, type: "number", inputmode: "decimal", min: o.min, max: o.max, step: o.step ?? "any", placeholder: o.placeholder, "aria-describedby": o.hint ? `${i}-h` : undefined });
    input.addEventListener("input", () => {
      const v = stripNum(input.value);
      if (Number.isNaN(v) && o.placeholder === undefined) return;
      if (!Number.isNaN(v) && ((o.min !== undefined && v < o.min) || (o.max !== undefined && v > o.max))) return;
      edit((c) => set(Number.isNaN(v) ? null : v, c), fit);
    });
    syncs.push(() => { if (document.activeElement !== input) { const v = get(); input.value = v == null ? "" : String(Math.round(v * 1000) / 1000); } });
    return h("div", { class: "field" },
      h("label", { for: i }, label, o.unit ? h("span", { class: "unit" }, ` (${o.unit})`) : null),
      input, o.hint ? h("p", { class: "hint", id: `${i}-h` }, o.hint) : null);
  };

  const check = (label: string, get: () => boolean, set: (v: boolean, c: PlanConfig) => void, hint?: string) => {
    const i = id();
    const input = h("input", { id: i, type: "checkbox", "aria-describedby": hint ? `${i}-h` : undefined });
    input.addEventListener("change", () => edit((c) => set(input.checked, c)));
    syncs.push(() => { input.checked = get(); });
    return h("div", { class: "check" }, input, h("label", { for: i }, label), hint ? h("p", { class: "hint", id: `${i}-h` }, hint) : null);
  };

  const text = (label: string, get: () => string, set: (v: string, c: PlanConfig) => void, hint?: string) => {
    const i = id();
    const input = h("input", { id: i, type: "text", "aria-describedby": hint ? `${i}-h` : undefined });
    input.addEventListener("input", () => edit((c) => set(input.value, c)));
    syncs.push(() => { if (document.activeElement !== input) input.value = get(); });
    return h("div", { class: "field" }, h("label", { for: i }, label), input, hint ? h("p", { class: "hint", id: `${i}-h` }, hint) : null);
  };

  const section = (title: string, open: boolean, ...kids: (Node | null)[]) => {
    const d = h("details", { class: "card", open: open || undefined }, h("summary", null, title), h("div", { class: "card-body" }, ...kids));
    return d;
  };

  const toolBtn = (label: string, tool: Exclude<Arm, null>, hint: string) => {
    const b = h("button", { type: "button", class: "btn", "aria-pressed": "false", title: hint, onclick: () => act.arm(st().arm === tool ? null : tool) }, label);
    syncs.push(() => b.setAttribute("aria-pressed", String(st().arm === tool)));
    return b;
  };

  // ---------------- header + verdict ----------------
  const verdict = h("div", { class: "verdict", role: "status", "aria-live": "polite" });
  const topNotes = h("ul", { class: "notes" });
  const armBar = h("div", { class: "armbar", role: "status", hidden: true });
  const header = h("header", { class: "head" },
    h("h1", null, "Skyway Flight Planner"),
    h("div", { class: "head-btns" },
      h("button", { type: "button", class: "btn small", onclick: () => act.toggleTheme(), title: "Switch between light and dark" }, "Light/Dark"),
      null));
  const intro = h("p", { class: "hint intro" }, "Pick where to fly, add pilot spots, and check the result. Everything updates as you change it. Altitudes are metres above the launch point.");

  // ---------------- where ----------------
  const modeCorr = h("button", { type: "button", class: "seg", onclick: () => edit((c, s) => { c.mode = "corridor"; s.arm = null; }, true) }, "Along the Skyway");
  const modeArea = h("button", { type: "button", class: "seg", onclick: () => edit((c, s) => { c.mode = "area"; s.arm = null; if (!c.pilots.length || c.pilots.every((p) => p.placeholder)) c.pilots = []; }, true) }, "Over an area");
  const segs = h("div", { class: "segs", role: "group", "aria-label": "What kind of flight" }, modeCorr, modeArea);
  syncs.push(() => { modeCorr.setAttribute("aria-pressed", String(st().cfg.mode === "corridor")); modeArea.setAttribute("aria-pressed", String(st().cfg.mode === "area")); });

  const total = cumulativeLengthLL(skywayData().line).at(-1)!;
  const stretchLabel = h("p", { class: "stretch" });
  const zoneStatus = h("p", { class: "hint" });
  const clearZone = h("button", { type: "button", class: "btn small", onclick: () => edit((c) => { c.zone = null; }) }, "Go back to the assumed zone");
  const corridorBox = h("div", null,
    h("div", { class: "row" },
      num("Start", () => st().cfg.startKm, (v, c) => { c.startKm = v ?? 0; resetPlaceholders(c); }, { unit: "km along the line", min: 0, max: total / 1000 - 0.05, step: 0.1 }, true),
      toolBtn("Pick on map", "start", "Click the rail line where the stretch should begin")),
    num("Length", () => st().cfg.lengthM, (v, c) => { c.lengthM = v ?? 1500; resetPlaceholders(c); }, { unit: "m", min: 100, max: 20000, step: 100, hint: "How much of the line to fly in this plan." }, true),
    stretchLabel,
    num("Zone half-width", () => st().cfg.halfWidthM, (v, c) => { c.halfWidthM = v ?? 15; }, { unit: "m", min: 1, max: 200, hint: "Only used until the approved zone is loaded. 15 m each side makes a 30 m strip." }),
    num("Keep this far inside the zone edge", () => st().cfg.insetCorridorM, (v, c) => { c.insetCorridorM = v ?? 5; }, { unit: "m", min: 0, max: 100, hint: "Margin for GPS error, wind and path following." }),
    zoneStatus, clearZone);

  const areaBox = h("div", null,
    h("div", { class: "row wrap" },
      toolBtn("Draw area", "area", "Click the corners of the area on the map"),
      h("button", { type: "button", class: "btn", onclick: () => act.arm(null) }, "Finish"),
      h("button", { type: "button", class: "btn", onclick: () => edit((c) => { c.area = []; }) }, "Clear")),
    h("p", { class: "hint" }, "Click the corners on the map, then press Finish. Drag a corner to move it, double-click to remove it. You can also open a KML file with a polygon below."),
    num("Keep this far inside the area edge", () => st().cfg.insetAreaM, (v, c) => { c.insetAreaM = v ?? 10; }, { unit: "m", min: 0, max: 200 }),
    num("Gap between lanes", () => st().cfg.areaOptions.laneSpacingM, (v, c) => { c.areaOptions.laneSpacingM = v ?? 100; }, { unit: "m", min: 10, max: 1000 }),
    num("Lane direction", () => st().cfg.areaOptions.headingDeg, (v, c) => { c.areaOptions.headingDeg = v ?? 0; }, { unit: "degrees clockwise from north", min: 0, max: 359 }),
    check("Turn the lanes 90° on every other altitude", () => st().cfg.areaOptions.crosshatch, (v, c) => { c.areaOptions.crosshatch = v; }, "Cancels any bias from flying one direction only."),
    check("Start with a slow climb and descent in the middle", () => st().cfg.areaOptions.verticalProfile, (v, c) => { c.areaOptions.verticalProfile = v; }));

  function resetPlaceholders(c: PlanConfig) {
    if (c.pilots.length && c.pilots.every((p) => p.placeholder)) { c.pilots = []; c.autoPilotSpacingM = st().autoSpacingM; }
  }

  const where = section("1 · Where to fly", true, segs, corridorBox, areaBox);

  // ---------------- pilots ----------------
  const pilotList = h("div", { class: "list" });
  const pilots = section("2 · Pilot spots", true,
    h("p", { class: "hint" }, "Where each pilot will stand and launch. Each pilot flies the part of the stretch nearest to them."),
    h("div", { class: "row wrap" },
      toolBtn("Add by clicking the map", "pilot", "Click where a pilot will stand. Click the button again to stop."),
      h("button", { type: "button", class: "btn", onclick: () => edit((c) => { c.pilots = []; c.autoPilotSpacingM = st().autoSpacingM; }) }, "Use placeholders")),
    num("Placeholder spacing", () => st().autoSpacingM, (v, c) => { const n = v ?? 500; st().autoSpacingM = n; if (!c.pilots.length) c.autoPilotSpacingM = n; }, { unit: "m", min: 100, max: 5000, hint: "Placeholders are stand-ins on the track. Replace them with the real launch spots." }),
    pilotList);

  // ---------------- limits ----------------
  const demStatus = h("p", { class: "hint", role: "status", "aria-live": "polite" });
  syncs.push(() => { demStatus.textContent = st().dem.status; demStatus.hidden = !st().dem.status; });
  const ceilFt = h("span", { class: "unit" });
  const limits = section("3 · Altitudes and limits", true,
    text("Altitudes", () => st().cfg.altitudesM.join(", "), (v, c) => { c.altitudesM = v.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0); },
      "Metres above the launch point, separated by commas. One pass is flown at each."),
    num("Speed", () => st().cfg.speedMps, (v, c) => { c.speedMps = v ?? 5; }, { unit: "m/s", min: 1, max: 15, hint: "10 m/s or less is recommended for the measurements." }),
    num("Battery time to use", () => st().cfg.batteryMin, (v, c) => { c.batteryMin = v ?? 22; }, { unit: "minutes", min: 3, max: 40, hint: "Usable time of a roughly 30-minute battery, including take-off and landing." }),
    h("div", { class: "field" }, num("Highest allowed altitude", () => st().cfg.ceilingM, (v, c) => { c.ceilingM = v ?? 121.92; }, { unit: "m above launch", min: 10, max: 200, hint: "400 ft is 121.9 m. The top layer stays a bit lower because ground below the launch spot raises the true height." }), ceilFt),
    num("Lowest allowed altitude", () => st().cfg.floorM, (v, c) => { c.floorM = v; }, { unit: "m", min: 1, max: 200, placeholder: "lowest layer", hint: "Leave empty to use the lowest altitude above." }),
    num("Farthest from the pilot", () => st().cfg.vlosM, (v, c) => { c.vlosM = v ?? 700; }, { unit: "m", min: 50, max: 3000, hint: "The pilot must be able to see the drone." }),
    check("Check the true height above ground (USGS elevation)", () => st().cfg.useGroundElevation, (v, c) => { c.useGroundElevation = v; st().dem.retryAfter = 0; },
      "Looks up ground height from the U.S. Geological Survey, so low ground below the launch spot is counted. Needs internet. The waypoints do not change."),
    demStatus,
    h("fieldset", { class: "fs" }, h("legend", null, "Flight patterns along the Skyway"),
      check("One pass along the track at each altitude", () => st().cfg.patterns.linear, (v, c) => { c.patterns.linear = v; }),
      check("Fly every altitude both ways", () => st().cfg.patterns.bothSweeps, (v, c) => { c.patterns.bothSweeps = v; }, "Adds a second round in reverse order, so each altitude is flown in both directions."),
      check("Climb-and-descend pass", () => st().cfg.patterns.porpoise, (v, c) => { c.patterns.porpoise = v; }, "A saw-tooth between the lowest layer (at least 15 m) and the top one."),
      check("Vertical columns every", () => st().cfg.patterns.columns, (v, c) => { c.patterns.columns = v; }),
      num("Column spacing", () => st().cfg.patterns.columnSpacingM, (v, c) => { c.patterns.columnSpacingM = v ?? 250; }, { unit: "m", min: 50, max: 5000 })));
  syncs.push(() => { ceilFt.textContent = `That is ${Math.round(st().cfg.ceilingM / FT)} ft.`; });

  // ---------------- obstacles ----------------
  const obsList = h("div", { class: "list" });
  const obstacles = section("4 · Obstacles", false,
    h("p", { class: "hint" }, "Towers, tall trees and so on. The drone must stay below the height plus 15 m, or outside the keep-out distance."),
    num("Height of the next obstacle", () => st().obstacleDefaults.heightM, (v) => { st().obstacleDefaults.heightM = v ?? 80; }, { unit: "m", min: 1, max: 500 }),
    num("Keep-out distance", () => st().obstacleDefaults.radiusM, (v) => { st().obstacleDefaults.radiusM = v ?? 100; }, { unit: "m", min: 1, max: 1000 }),
    h("div", { class: "row wrap" }, toolBtn("Add by clicking the map", "obstacle", "Click the obstacle location")),
    obsList);

  // ---------------- advanced ----------------
  const advanced = section("Advanced settings", false,
    h("p", { class: "hint" }, "Planning constants. Adjust after the first real flight if the time estimates are off."),
    num("Climb and descent speed", () => st().cfg.time.climbRateMps, (v, c) => { c.time.climbRateMps = v ?? 2; }, { unit: "m/s", min: 0.5, max: 10 }),
    num("Extra time at each point", () => st().cfg.time.overheadPerWaypointS, (v, c) => { c.time.overheadPerWaypointS = v ?? 2; }, { unit: "s", min: 0, max: 30 }),
    num("Longest straight leg", () => st().cfg.time.maxLegM, (v, c) => { c.time.maxLegM = v ?? 100; }, { unit: "m", min: 20, max: 1000, hint: "Longer legs are cut so a flight can end part-way." }),
    num("Follow the curve to within", () => st().cfg.chordTolM, (v, c) => { c.chordTolM = v ?? 2; }, { unit: "m", min: 0.5, max: 10 }),
    num("Climb-and-descent half-length", () => st().cfg.patterns.porpoiseHalfPeriodM, (v, c) => { c.patterns.porpoiseHalfPeriodM = v ?? 200; }, { unit: "m", min: 50, max: 2000 }),
    num("Climb-and-descent lowest altitude", () => st().cfg.patterns.porpoiseMinAltM, (v, c) => { c.patterns.porpoiseMinAltM = v ?? 15; }, { unit: "m", min: 1, max: 200 }),
    num("Clearance above obstacles", () => st().cfg.obstacleClearanceM, (v, c) => { c.obstacleClearanceM = v ?? 15; }, { unit: "m", min: 0, max: 100 }),
    num("Block length for hold-out tags", () => st().cfg.blockLenM, (v, c) => { c.blockLenM = v ?? 250; }, { unit: "m", min: 50, max: 5000 }),
    num("Check the path every", () => st().cfg.sampleStepM, (v, c) => { c.sampleStepM = v ?? 1; }, { unit: "m", min: 0.25, max: 2, hint: "At most 2 m." }));

  // ---------------- results ----------------
  const tbody = h("tbody");
  const table = h("table", { class: "flights" },
    h("caption", { class: "sr" }, "Flights in this plan. Select a row to see it on the map."),
    h("thead", null, h("tr", null, ...["Flight", "Pilot", "Min", "Points", "km", "OK?"].map((t) => h("th", { scope: "col" }, t)))), tbody);
  const detail = h("div", { class: "detail" });
  const results = section("Flights", true, table, detail);

  // ---------------- files ----------------
  const baseBox = h("div", { class: "list" });
  const gKey = h("input", { id: "gkey", type: "password", autocomplete: "off", placeholder: "Google Maps API key" });
  const gMsg = h("p", { class: "hint", id: "gmsg" });
  const overlayBox = h("div", null,
    ...([["line", "Skyway line"], ["ticks", "Kilometre marks"], ["nodes", "Airports"], ["airspace", "Airport airspace (FAA outlines, display only)"], ["zone", "Fly zone"]] as const).map(([k, label]) => {
      const i = id();
      const input = h("input", { id: i, type: "checkbox", checked: true });
      input.addEventListener("change", () => act.setOverlay(k, input.checked));
      return h("div", { class: "check" }, input, h("label", { for: i }, label));
    }));
  const map = section("Map", false,
    h("div", { role: "radiogroup", "aria-label": "Map imagery" }, baseBox),
    h("details", { class: "sub" }, h("summary", null, "Use Google satellite (needs your own key)"),
      h("p", { class: "hint" }, "Paste a Google Maps Platform key with the Map Tiles API enabled. It is kept only in this browser."),
      h("label", { for: "gkey", class: "sr" }, "Google Maps API key"), gKey,
      h("button", { type: "button", class: "btn", onclick: () => act.google(gKey.value.trim()) }, "Turn on Google satellite"), gMsg),
    h("p", { class: "hint" }, "Show on the map:"), overlayBox);

  const exportBox = h("div", { class: "list" });
  const fileOpen = h("input", { type: "file", accept: ".json,application/json", hidden: true, id: "open-plan" });
  fileOpen.addEventListener("change", () => { const f = fileOpen.files?.[0]; if (f) act.openPlanFile(f); fileOpen.value = ""; });
  const fileKml = h("input", { type: "file", accept: ".kml,.kmz", hidden: true, id: "import-kml" });
  fileKml.addEventListener("change", () => { const f = fileKml.files?.[0]; if (f) act.importKmlFile(f); fileKml.value = ""; });
  const files = section("Files", true,
    exportBox,
    h("div", { class: "row wrap" },
      h("button", { type: "button", class: "btn", onclick: () => fileOpen.click() }, "Open a saved plan"),
      h("button", { type: "button", class: "btn", onclick: () => fileKml.click() }, "Open a KML/KMZ file"),
      h("button", { type: "button", class: "btn", onclick: () => act.copyLink() }, "Copy a link to this plan"),
      h("button", { type: "button", class: "btn", onclick: () => act.printCards() }, "Print flight cards")),
    h("p", { class: "hint" }, "A KML file can hold the approved zone (polygon), a centre line (path) or pilot spots (points)."),
    fileOpen, fileKml);

  const footer = h("footer", { class: "foot" },
    h("p", { class: "hint" }, "Planning aid only. Check airspace (Aloft / B4UFLY, LAANC near Willow Run and Detroit Metro) and follow flight operations rules before flying."));

  root.append(header, verdict, armBar, intro, topNotes, where, pilots, limits, obstacles, results, files, map, advanced, footer);

  // ---------------- dynamic parts ----------------
  function renderBaseChoices(selected: string) {
    clear(baseBox);
    const list = act.basemapIds();
    if (act.googleKey()) list.push({ id: "google", label: "Google satellite", note: "Through the official Map Tiles API." });
    for (const b of list) {
      const i = `bm-${b.id}`;
      const r = h("input", { type: "radio", name: "basemap", id: i, value: b.id, checked: b.id === selected });
      r.addEventListener("change", () => act.basemap(b.id));
      baseBox.append(h("div", { class: "check" }, r, h("label", { for: i }, b.label), h("p", { class: "hint" }, b.note)));
    }
  }

  function renderPilots(s: UiState) {
    const ps = s.result.pilots;
    // keep the text box the user is typing in
    if (pilotList.contains(document.activeElement) && pilotList.querySelectorAll(".item").length === ps.length) return;
    clear(pilotList);
    if (!ps.length) pilotList.append(h("p", { class: "hint" }, s.cfg.mode === "area" ? "Click the map to add the pilot spot." : "No pilot spots yet."));
    ps.forEach((p, k) => {
      const nameIn = h("input", { type: "text", value: p.name, "aria-label": `Name of pilot spot ${k + 1}` });
      nameIn.addEventListener("input", () => edit((c, state) => { materializePilots(c, state); c.pilots[k].name = nameIn.value; }));
      pilotList.append(h("div", { class: "item" },
        h("span", { class: "pilot-badge" }, String(k + 1)), nameIn,
        p.placeholder ? h("span", { class: "tag" }, "placeholder") : null,
        h("span", { class: "coords" }, `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`),
        h("button", { type: "button", class: "btn small", "aria-label": `Remove pilot spot ${k + 1}`, onclick: () => edit((c, state) => { materializePilots(c, state); c.pilots.splice(k, 1); if (!c.pilots.length) c.autoPilotSpacingM = null; }) }, "Remove")));
    });
  }

  function renderObstacles(s: UiState) {
    if (obsList.contains(document.activeElement) && obsList.querySelectorAll(".item").length === s.cfg.obstacles.length) return;
    clear(obsList);
    s.cfg.obstacles.forEach((o, k) => {
      const nm = h("input", { type: "text", value: o.name, "aria-label": `Name of obstacle ${k + 1}` });
      nm.addEventListener("input", () => edit((c) => { c.obstacles[k].name = nm.value; }));
      const hh = h("input", { type: "number", value: o.heightM, min: 1, "aria-label": `Height of ${o.name} in metres` });
      hh.addEventListener("input", () => { const v = Number(hh.value); if (v > 0) edit((c) => { c.obstacles[k].heightM = v; }); });
      const rr = h("input", { type: "number", value: o.radiusM, min: 1, "aria-label": `Keep-out distance of ${o.name} in metres` });
      rr.addEventListener("input", () => { const v = Number(rr.value); if (v > 0) edit((c) => { c.obstacles[k].radiusM = v; }); });
      obsList.append(h("div", { class: "item obs" }, nm,
        h("label", { class: "mini" }, "height m ", hh), h("label", { class: "mini" }, "keep-out m ", rr),
        h("button", { type: "button", class: "btn small", "aria-label": `Remove ${o.name}`, onclick: () => edit((c) => { c.obstacles.splice(k, 1); }) }, "Remove")));
    });
    if (!s.cfg.obstacles.length) obsList.append(h("p", { class: "hint" }, "No obstacles added."));
  }

  function renderFlights(s: UiState) {
    clear(tbody);
    const { flights } = s.result;
    if (!flights.length) tbody.append(h("tr", null, h("td", { colspan: 6, class: "hint" }, "No flights yet. See the messages above.")));
    for (const f of flights) {
      const bad = f.issues.length > 0;
      const tr = h("tr", { class: f.idx === s.sel ? "sel" : "", tabindex: 0, "aria-selected": String(f.idx === s.sel), onclick: () => store.ui((x) => { x.sel = f.idx; }),
        onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); store.ui((x) => { x.sel = f.idx; }); } } },
        h("td", null, h("span", { class: "sw", style: `background:${flightColor(f.idx)}` }), String(f.idx)),
        h("td", null, f.pilot.name), h("td", null, (f.timeS / 60).toFixed(1)), h("td", null, String(f.waypoints.filter((w) => !w.split).length)),
        h("td", null, (f.lengthM / 1000).toFixed(2)), h("td", { class: bad ? "bad" : "good" }, bad ? "✗ problem" : "✓ OK"));
      tbody.append(tr);
    }
  }

  function renderDetail(s: UiState) {
    clear(detail);
    const f: Flight | undefined = s.result.flights.find((x) => x.idx === s.sel);
    if (!f) return;
    const floor = s.cfg.floorM ?? Math.min(...s.cfg.altitudesM);
    detail.append(
      h("h3", null, `Flight ${f.idx} · ${f.pilot.name}`),
      h("dl", { class: "stats" },
        h("dt", null, "Estimated time"), h("dd", null, `${(f.timeS / 60).toFixed(1)} min of ${s.cfg.batteryMin}`),
        h("dt", null, "Closest to zone edge"), h("dd", null, `${f.minMarginM.toFixed(1)} m`),
        h("dt", null, "Farthest from pilot"), h("dd", null, `${Math.round(f.maxDistFromPilotM)} m`),
        h("dt", null, "Highest point"), h("dd", null, `${f.maxAltM.toFixed(0)} m (${Math.round(f.maxAltM / FT)} ft) above launch`)));
    if (f.issues.length) detail.append(h("ul", { class: "notes" }, ...f.issues.map((i) => h("li", { class: "issue" }, i.message))));
    if (f.warnings.length) detail.append(h("ul", { class: "notes" }, ...f.warnings.map((w) => h("li", { class: "warn" }, w))));
    detail.append(profileChart(f, s.cfg.ceilingM, floor, flightColor(f.idx)));
  }

  function renderVerdict(s: UiState) {
    const r = s.result;
    verdict.className = `verdict ${r.verdict === "PASS" ? "pass" : r.verdict === "FAIL" ? "fail" : "ready"}`;
    clear(verdict);
    const word = r.verdict === "PASS" ? "PASS" : r.verdict === "FAIL" ? "FAIL" : "NOT READY";
    verdict.append(
      h("span", { class: "vword" }, word),
      h("span", { class: "vsum" }, r.flights.length
        ? `${r.summary.flights} flight${r.summary.flights === 1 ? "" : "s"} · ${Math.round(r.summary.totalMin)} min · ${r.summary.measuredKm.toFixed(1)} km measured · ${r.summary.label}`
        : r.summary.label || "Nothing to fly yet"));
    clear(topNotes);
    const order = { issue: 0, warn: 1, info: 2 } as const;
    [...r.notes].sort((a, b) => order[a.level] - order[b.level]).forEach((n) => topNotes.append(h("li", { class: n.level }, n.message)));
    const problems = r.flights.filter((f) => f.issues.length);
    if (problems.length) topNotes.prepend(h("li", { class: "issue" }, `Problems in flight${problems.length > 1 ? "s" : ""} ${problems.map((f) => f.idx).join(", ")}. Select a flight below to see what to fix. A red ring on the map marks the first problem point.`));
  }

  function renderStretch(s: UiState) {
    const r = s.result;
    stretchLabel.textContent = r.summary.label ? `Flying ${r.summary.label}.` : "";
    zoneStatus.textContent = s.cfg.zone ? "The approved fly-zone polygon is loaded." : "No approved zone loaded: using an assumed strip around the rail line. Load the approved polygon before flying.";
    clearZone.hidden = !s.cfg.zone;
  }

  function renderExports(s: UiState) {
    clear(exportBox);
    const ready = s.result.flights.length > 0;
    for (const e of EXPORTERS) {
      const b = h("button", { type: "button", class: "btn", disabled: !e.available || (!ready && e.id !== "plan"), onclick: () => act.exportWith(e.id) }, `Download: ${e.label}`);
      exportBox.append(h("div", { class: "item col" }, b, h("p", { class: "hint" }, e.available ? e.help : e.unavailableReason ?? e.help)));
    }
  }

  function renderArm(s: UiState) {
    const msg: Record<Exclude<Arm, null>, string> = {
      start: "Click the rail line where the stretch should start. Esc cancels.",
      pilot: "Click where a pilot will stand. Click again for more. Esc stops.",
      obstacle: "Click the obstacle location. Esc cancels.",
      area: "Click the corners of the area, then press Finish. Esc stops.",
    };
    armBar.hidden = !s.arm;
    armBar.textContent = s.arm ? msg[s.arm] : "";
  }

  renderBaseChoices("usgs");

  return {
    refreshBasemaps: (selected: string) => renderBaseChoices(selected),
    sync(s, why) {
      syncs.forEach((f) => f());
      renderArm(s);
      renderFlights(s);
      renderDetail(s);
      if (why === "plan") {
        renderVerdict(s);
        renderStretch(s);
        renderPilots(s);
        renderObstacles(s);
        renderExports(s);
        corridorBox.hidden = s.cfg.mode !== "corridor";
        areaBox.hidden = s.cfg.mode !== "area";
        (limits.querySelector("fieldset") as HTMLElement).hidden = s.cfg.mode !== "corridor";
      }
    },
  };
}
