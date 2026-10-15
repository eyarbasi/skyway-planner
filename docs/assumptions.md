# Assumptions and defaults

Every default and assumption in the planner, and who needs to confirm it. Nothing here is invented silently: if a value is a guess, it says so, and the app shows a warning wherever a guess affects a result.

**Status key:** ✅ from the brief or a source document · ⚠️ my assumption, needs confirming · ❓ not known yet

## Things the app cannot know yet

| Item | Status | What the app does meanwhile | Who confirms |
|---|---|---|---|
| Approved fly-zone polygon, Skyway | ❓ not received | Uses an **assumed** strip: centreline ± 15 m, flat ends. A permanent warning says "Assumed fly zone … load the approved polygon before flying". The KML export labels the zone "ASSUMED, not approved". | Flight operations |
| Approved fly-zone polygon, area flights | ❓ not received | Draw or import a polygon; nothing is assumed. | Flight operations |
| Skydio X10 waypoint import format | ❓ sample pending | The Skydio export is listed but disabled, with the reason. CSV and KML are for review and manual entry. See `src/exporters/skydio.ts` for the steps to add it. | Flight team (export one mission from the controller) |
| Real pilot / launch spots | ❓ pending | Placeholder spots every 500 m on the track, tagged "placeholder" in the UI, CSV, KML and flight cards. | Flight operations |
| Obstacle coordinates and heights | ❓ not received | None are pre-loaded. Add them by clicking the map. | Flight operations |
| Whether Backtrack return mode will be used | ❓ | The warning text recommends Backtrack when a straight line back to the pilot would cross outside the zone. | Flight operations |

## Altitude and limits

| Setting | Default | Status | Notes / who confirms |
|---|---|---|---|
| Altitude reference | **metres above the launch point** | ✅ brief | This is what Skydio waypoint altitude means. Labelled that way everywhere. Confirm with the first real export. |
| Ceiling | 400 ft = 121.92 m | ✅ brief | Flight operations (any waiver or lower local limit). |
| Top layer | 115 m | ✅ brief | Leaves 7 m of margin, because ground lower than the launch point raises true height. The app warns when the top layer is within 5 m of the ceiling. |
| Layers | 12, 30, 60, 90, 115 m | ✅ brief | ACJA suggests 10/30/60/90/120. 12 m is the flight lead's minimum. Analysis lead to confirm the 12/115 compromise. |
| Lowest allowed altitude | the lowest layer | ⚠️ | Overridable. |
| Speed | 5 m/s | ✅ ACJA ≤ 10 m/s | |
| Farthest from the pilot | 700 m | ✅ brief | Called "distance from pilot" in the UI, never "VLOS radius". Pilots to confirm. |
| Battery to use | 22 min of a ~30 min battery | ✅ brief | Includes take-off, transit and landing. |
| Obstacle clearance | 15 m above the obstacle's height | ✅ brief | Obstacle checks are cylinders: inside the keep-out radius and below height + 15 m. |
| Ground height (optional) | off | ✅ brief | **USGS 3DEP** bare-earth elevation. It does not include trees or buildings, so clearance over those is smaller than it shows. Heights are relative to the launch spot; 3DEP's vertical datum cancels out in the difference. |

## Fly zone and margins

| Setting | Default | Status | Notes |
|---|---|---|---|
| Assumed corridor half-width | 15 m (30 m wide) | ✅ brief | Replace with the approved polygon. |
| Edge margin, corridor | 5 m | ✅ brief | GNSS ±1 m (Skydio spec), wind drift, path following. |
| Edge margin, area | 10 m | ✅ brief | |
| Chord tolerance | 2 m | ✅ brief | Douglas–Peucker on the curved centreline: the straight legs never deviate more than 2 m from the track. |
| Path sample step | 1 m | ⚠️ | The brief says ≤ 2 m. 1 m matches the Python reference and is stricter. Adjustable down to 0.25 m in Advanced settings; the UI enforces ≤ 2 m. |
| Km along the line | measured with local WGS84 scale factors per segment | ⚠️ | True ground distance, independent of the map projection. The Python reference measures in UTM zone 17, whose scale factor stretches distances by about 0.02 % this far west of its central meridian, so its km positions drift from ours by about 0.2 m per km (measured: 1 m at km 5, 5 m at km 40, 7 m at km 50). The line is the OSM rail centreline from the bundled KML (57.8 km, 61 vertices), so its own accuracy is OSM's. |

## Patterns

| Setting | Default | Status | Notes |
|---|---|---|---|
| Linear passes | one pass per altitude, alternating direction | ✅ brief | |
| Both directions | off | ✅ brief | Adds a second round in **reverse altitude order**, so each altitude is flown in both directions. (The Python version instead repeats the same altitude order on the reversed line; the brief's wording was followed.) |
| Climb-and-descend ("porpoise") | on; half-period 200 m; between max(15 m, lowest layer) and the top layer | ✅ brief | **Starts from the altitude and end where the previous pass stopped**, rather than dropping to the bottom first (as the Python version does). This saves a ~50 s vertical drop per section. Analysis lead to confirm the data does not need it to start at the bottom. |
| Columns | off; every 250 m | ✅ brief (optional) | |
| Area lanes | 100 m apart, heading 0° (north), 90° crosshatch on alternate altitudes | ✅ brief | Lanes are centred so both edges are covered and clipped exactly to the polygon minus the margin. If an irregular polygon splits a lane in two, only the longest piece is flown and a warning says so. |
| Area vertical profile | on, at the centroid, 1 m/s | ✅ brief | The vertical legs are timed at 1 m/s (the Python version timed them at 2 m/s). |
| Area with several pilot spots | uses the first only, with a warning | ⚠️ | The brief is silent. |
| Sections | each pilot flies the part of the stretch nearest to them, cut at the midpoints | ✅ brief | A pilot with under 20 m of stretch is skipped, with a note. |

## Time model (calibrate after the first real flight; editable in Advanced settings)

| Constant | Default | Status |
|---|---|---|
| Take-off climb | altitude ÷ 2 m/s | ✅ brief |
| Climb / descent rate | 2 m/s | ✅ brief |
| Leg time | the longer of horizontal ÷ speed and vertical ÷ 2 m/s | ✅ brief |
| Extra time per waypoint | 2 s | ✅ brief |
| Return | to the pilot spot at the current altitude, then descend at 2 m/s | ✅ brief |
| Longest leg before splitting | 100 m | ✅ brief |
| Flight balancing | if a section needs n flights, re-split aiming at about total ÷ n each (factor 1.02 up, never above the battery limit) | ⚠️ prototype logic, made monotone |

## Tags for hold-out validation

| Item | Rule | Status |
|---|---|---|
| Route Test Objective ID | `C-LIN-<alt>`, `C-POR`, `C-COL`, `A-LM-<alt>`, `A-VP` | ⚠️ the brief gives `C-LIN-60` and `A-LM-90` as examples; `C-POR`, `C-COL` and `A-VP` follow the same pattern. The return sweep of "both directions" shares the tag of the same altitude. Analysis lead to confirm. |
| Block ID | `B001`… = 250 m blocks of distance along the loaded line **from km 0** | ⚠️ The Python version counts from the start of the selected stretch. Counting from km 0 keeps block IDs the same across plans, which is what a spatial hold-out needs. Analysis lead to confirm. |

## Reproducibility

The same saved plan always gives byte-identical waypoints: no randomness, stable sorting, and the saved plan holds the full configuration (including the centre line). Optional ground-elevation lookups change only the checks, never the waypoints.

## Map imagery and attribution

| Source | Licence / terms | Notes |
|---|---|---|
| USGS Imagery (default) | public domain | Cached tiles end at zoom 16 (~2.4 m per pixel); closer zoom enlarges them. |
| USGS NAIP (sharp aerial) | public domain | About 0.6 m per pixel, rendered per tile on request, so it is slow. |
| Sentinel-2 cloudless (EOX) | **non-commercial terms apply**, attribution required | Wide-area context only. Check s2maps.eu terms before any non-research use. |
| Esri World Imagery | Esri terms | Attribution shown. Confirm Esri's terms cover the team's use. |
| OpenStreetMap | ODbL, attribution required | |
| Google satellite | Google Map Tiles API terms | Official Map Tiles API only; the key is pasted by the user and kept in that browser's localStorage. Never in the repo, a saved plan or a share link. |

## Airspace

Display only. Airport markers (ARB, YIP, DTW) use approximate positions copied from the prototype, and each has the tooltip "Check airspace in Aloft / B4UFLY". The app does not compute airspace or LAANC eligibility. The airspace outlines on the map are fetched live from the FAA's official open-data "Class Airspace" service (surface areas of Class B, C and D only, US three-letter identifiers only) and are drawn as-is; nothing is stored or bundled, so they are as current as the FAA's copy. Not shown: higher shelves, LAANC facility-map ceilings, TFRs, restricted areas. If the service is unreachable the app says so.

## Differences from the Python reference (`wpplan`) and the HTML prototype

See the table at the end of `docs/golden.md`.

## Bundled Skyway data

`src/data/M-air-Skyway.kml` holds only the public M-air Skyway rail centreline (no sites, partners or notes). The team's original files are kept locally in `reference/`, which is not committed (see `.gitignore`).
