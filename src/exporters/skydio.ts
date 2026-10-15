import { ExporterUnavailableError, type Exporter } from "./types";

/**
 * Skydio X10 waypoint-mission export.
 *
 * NOT IMPLEMENTED: the X10 waypoint import format is not known yet. Do not guess it.
 * When an exported mission arrives, put it in reference/ and:
 *   1. read the file and write down its structure in docs/skydio-format.md,
 *   2. implement `export` below to match it exactly,
 *   3. flip `available` to true and
 *   4. un-skip the round-trip test in tests/exporters.test.ts (parse our output, compare with the sample).
 * Until then the CSV and KML exports are for checking and manual entry.
 */
export const skydioExporter: Exporter = {
  id: "skydio",
  label: "Skydio X10 mission",
  help: "Direct import file for the Skydio controller.",
  available: false,
  unavailableReason: "Waiting for a sample mission file exported from the X10 controller. Until then, use the waypoint table.",
  export() {
    throw new ExporterUnavailableError("The Skydio export format is not known yet. Send an exported X10 waypoint mission so it can be added.");
  },
};
