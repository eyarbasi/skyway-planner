import { defaultConfig, plan } from "../core";
import type { PlanConfig, PlanResult } from "../core";
import { skywayData } from "../data/skyway";
import { DemCache, pointsNeedingElevation } from "../io/dem";

export type Arm = null | "start" | "pilot" | "obstacle" | "area";

export interface UiState {
  cfg: PlanConfig;
  result: PlanResult;
  /** Selected flight number (1-based). */
  sel: number;
  arm: Arm;
  /** Default size for the next obstacle the user places. */
  obstacleDefaults: { heightM: number; radiusM: number };
  /** Spacing used when placing placeholder pilot spots. */
  autoSpacingM: number;
  /** Bumped when the map should refit to the plan. */
  fitToken: number;
  lineName: string;
  /** USGS 3DEP ground elevation, used only when the plan asks for it. */
  dem: { cache: DemCache; status: string; retryAfter: number };
}

type Listener = (s: UiState, why: ChangeKind) => void;
export type ChangeKind = "plan" | "ui";

export function initialState(): UiState {
  const cfg = defaultConfig(skywayData().line);
  return {
    cfg, result: plan(cfg), sel: 1, arm: null,
    obstacleDefaults: { heightM: 80, radiusM: 100 },
    autoSpacingM: 500, fitToken: 1, lineName: "M-air Skyway rail centreline",
    dem: { cache: new DemCache(), status: "", retryAfter: 0 },
  };
}

export class Store {
  private listeners: Listener[] = [];
  private pending = false;
  constructor(public state: UiState) {}

  subscribe(fn: Listener): void {
    this.listeners.push(fn);
  }

  private emit(why: ChangeKind): void {
    for (const l of this.listeners) l(this.state, why);
  }

  /** Change the plan settings and re-plan (batched to one run per frame). */
  edit(mutator: (cfg: PlanConfig, s: UiState) => void, opts: { fit?: boolean } = {}): void {
    mutator(this.state.cfg, this.state);
    if (opts.fit) this.state.fitToken++;
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.replan();
    });
  }

  /** Replace the whole config (opening a saved plan, importing). */
  setConfig(cfg: PlanConfig, opts: { fit?: boolean } = {}): void {
    this.state.cfg = cfg;
    this.state.sel = 1;
    if (opts.fit) this.state.fitToken++;
    this.replan();
  }

  replan(): void {
    const s = this.state;
    try {
      s.result = plan(s.cfg);
    } catch (e) {
      // a bug must not blank the page: say so and keep the controls usable
      s.result = { flights: [], notes: [{ level: "issue", message: `Something went wrong while planning (${(e as Error).message}). Change a setting, or reload and reopen your saved plan.` }], verdict: "NOT_READY", pilots: [], zone: [], planningLimit: [], centreline: [], zoneAssumed: true, summary: { flights: 0, totalMin: 0, measuredKm: 0, label: "" } };
    }
    if (s.cfg.useGroundElevation && s.result.flights.length) {
      const pts = pointsNeedingElevation(s.result);
      const missing = s.dem.cache.missing(pts);
      if (!missing.length) {
        s.result = plan(s.cfg, s.dem.cache);
        s.dem.status = `Checked against USGS ground height at ${s.dem.cache.size} points.`;
      } else if (Date.now() >= s.dem.retryAfter) {
        s.dem.status = "Loading ground height from USGS…";
        this.scheduleDem(missing);
      }
    } else if (!s.cfg.useGroundElevation) {
      s.dem.status = "";
    }
    if (s.sel > s.result.flights.length) s.sel = Math.max(1, s.result.flights.length);
    this.emit("plan");
  }

  private demTimer: ReturnType<typeof setTimeout> | undefined;
  private demToken = 0;
  private scheduleDem(missing: [number, number][]): void {
    clearTimeout(this.demTimer);
    const token = ++this.demToken;
    this.demTimer = setTimeout(async () => {
      const s = this.state;
      try {
        await s.dem.cache.fetch(missing);
        if (token === this.demToken) this.replan();
      } catch (e) {
        if (token !== this.demToken) return;
        s.dem.retryAfter = Date.now() + 30_000;
        s.dem.status = `${(e as Error).message} The plan assumes the ground is level with the launch spot.`;
        this.emit("plan");
      }
    }, 600);
  }

  /** Change only UI state (selection, armed tool): no re-plan. */
  ui(mutator: (s: UiState) => void): void {
    mutator(this.state);
    this.emit("ui");
  }
}

/** Placeholders become real, movable pilots as soon as anyone edits them. */
export function materializePilots(c: PlanConfig, state: UiState): void {
  if (!c.pilots.length && state.result.pilots.length) {
    c.pilots = state.result.pilots.map((p) => ({ ...p }));
    c.autoPilotSpacingM = null;
  }
}
