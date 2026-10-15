# Golden tests against the Python reference

`tests/golden/wpplan.test.ts` compares this planner with `wpplan`, the Python version in `reference/wpplan.zip`. `tests/golden/wpplan_golden.json` holds what `wpplan` produced on its own examples. To regenerate it (the result is byte-identical when nothing changed):

```
unzip reference/wpplan.zip -d /tmp/wpplan
python -m venv venv && venv/bin/pip install shapely pyproj numpy pytest
venv/bin/python tests/golden/generate_golden.py /tmp/wpplan/wpplan tests/golden/wpplan_golden.json
```

## What must match

| Case | Required |
|---|---|
| Single pattern (linear only, porpoise only, columns only) on Skyway km 0–1.5 and km 20–23 | Same number of flights, total time within 3 %, path length within 2 %, waypoint counts within 2 per flight |
| Combined linear + porpoise | Same number of flights, total time within 12 %, **never slower** than the reference |
| Corridor example (approved zone, 3 pilots) | Same flight count, PASS, margin ≥ 5 m, altitude ≤ ceiling |
| Area example | Same flight count, PASS, similar length, total time within 15 % |
| One pilot too far from both ends | Both refuse (the reference raises; this planner reports a plain-language problem) |
| Zone narrower than twice the margin | Raises `PlanError` ("too narrow"); `plan()` returns NOT READY |

## Deliberate differences, and why the combined tolerance is wider

| | `wpplan` (Python) | HTML prototype | This planner | Why |
|---|---|---|---|---|
| Flight balancing | no (greedy only) | yes | yes | Brief requires it; avoids a 21 min flight followed by a 4 min one |
| Porpoise start | always at the lowest altitude | continues from the current altitude | continues; if nothing flown before it, starts at the bottom like `wpplan` | No ~50 s vertical drop; keeps the path continuous |
| "Both directions" | repeat the same altitude order on the reversed line | reverse altitude order | reverse altitude order | Brief |
| Path check step | 1 m | 2 m | 1 m (≤ 2 m enforced) | Stricter, cheap |
| Floor check | on the sampled path | never fails (floor = lowest layer) | on the sampled path | A floor that cannot fail is not a check |
| Pilot→route straight-line warning | yes | missing | yes | Brief |
| Block ID | from the start of the stretch | none | from km 0 of the loaded line | Stable across plans for hold-out |
| Vertical-only legs | timed at the climb rate | same | timed at min(climb rate, leg speed) | A 1 m/s profile really takes 1 m/s |
| Km selection | UTM zone 17 (about 0.02 % too long here: 0.2 m per km, 7 m at km 50) | local plane anchored at km 0 (drifts over 57 km) | per-edge WGS84 scale factors (true ground distance) | Accurate everywhere on the line |

The combined cases differ from the reference mostly by the ~48 s the porpoise no longer spends dropping to its bottom altitude, once per section. Balancing also moves the split points, which changes take-off and landing time (those scale with altitude).
