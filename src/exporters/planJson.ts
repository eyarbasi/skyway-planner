import { defaultConfig } from "../core/defaults";
import type { PlanConfig } from "../core/types";
import type { Exporter } from "./types";

export const PLAN_FORMAT = "skyway-planner-plan";
export const PLAN_VERSION = 1;

export interface SavedPlan {
  format: typeof PLAN_FORMAT;
  version: number;
  config: PlanConfig;
}

export class PlanFileError extends Error {}

/**
 * The saved plan is the full config. Loading it gives byte-identical waypoints,
 * because the planner is deterministic. Nothing derived is stored.
 */
export function serializePlan(config: PlanConfig): string {
  const saved: SavedPlan = { format: PLAN_FORMAT, version: PLAN_VERSION, config };
  return JSON.stringify(saved, null, 1);
}

export function parsePlan(text: string): PlanConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PlanFileError("That file is not a saved plan.");
  }
  const o = raw as Partial<SavedPlan> | null;
  if (!o || o.format !== PLAN_FORMAT || typeof o.config !== "object" || o.config === null) throw new PlanFileError("That file is not a saved plan.");
  if ((o.version ?? 0) > PLAN_VERSION) throw new PlanFileError("That plan was saved by a newer version of this app. Update the app and try again.");
  // Fill anything missing with defaults so older plans keep opening.
  const base = defaultConfig(o.config.line ?? []);
  const c = o.config;
  return {
    ...base, ...c,
    patterns: { ...base.patterns, ...c.patterns },
    areaOptions: { ...base.areaOptions, ...c.areaOptions },
    time: { ...base.time, ...c.time },
  };
}

export const planJsonExporter: Exporter = {
  id: "plan",
  label: "Save plan (JSON)",
  help: "Everything needed to reopen this exact plan later. The same file always gives the same waypoints.",
  available: true,
  export({ name, config }) {
    return { filename: `${name}_plan.json`, mime: "application/json", content: serializePlan(config) };
  },
};
