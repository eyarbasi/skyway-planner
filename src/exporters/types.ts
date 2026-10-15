import type { PlanConfig, PlanResult } from "../core/types";

export interface ExportContext {
  /** File-name stem, e.g. skyway_km4.0_1500m */
  name: string;
  config: PlanConfig;
  plan: PlanResult;
}

export interface ExportFile {
  filename: string;
  mime: string;
  content: string | Uint8Array;
}

/** Anything that turns a plan into a file. Add new formats by implementing this and registering it. */
export interface Exporter {
  id: string;
  label: string;
  /** Short help shown next to the button. */
  help: string;
  /** False while the format is not implemented yet. The UI shows the reason instead of hiding it. */
  available: boolean;
  unavailableReason?: string;
  export(ctx: ExportContext): ExportFile;
}

export class ExporterUnavailableError extends Error {}

export function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}
