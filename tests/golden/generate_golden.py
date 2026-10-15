"""Regenerate tests/golden/wpplan_golden.json from the Python reference planner.

    unzip reference/wpplan.zip -d /tmp/wpplan
    python -m venv venv && venv/bin/pip install shapely pyproj numpy pytest
    venv/bin/python tests/golden/generate_golden.py /tmp/wpplan/wpplan tests/golden/wpplan_golden.json

Needs wpplan's own examples/ folder (zone.kml, centerline.kml, ... and the Skyway KML).
"""
import json, os, sys, warnings
warnings.filterwarnings("ignore")

root, outfile = sys.argv[1], sys.argv[2]
sys.path.insert(0, root)
from wpplan.mission import Planner, load_config  # noqa: E402

EX = os.path.join(root, "examples")
out = {}


def run(name, kind, **over):
    d = os.path.join(EX, kind)
    cfg = load_config(os.path.join(d, "config.json"))
    cfg.update(over)
    p = Planner(cfg, base_dir=d)
    ss = p.run()
    out[name] = {
        "over": over, "n": len(ss),
        "total_min": sum(s.duration_s for s in ss) / 60,
        "path_km": sum(s.path_len_m for s in ss) / 1000,
        "center_len": p.center.length if p.center is not None else None,
        "inset": p.inset, "stations": [s[0] for s in p.stations],
        "sorties": [{"station": s.station[0], "wps": len(s.wps), "min": s.duration_s / 60, "path_m": s.path_len_m,
                     "edge_margin": s.min_edge_margin_m, "max_vlos": s.max_vlos_m, "max_agl": s.max_agl_m,
                     "issues": len(s.issues)} for s in ss],
        "pass": all(not s.issues for s in ss),
    }


LIN = [{"pattern": "corridor_linear", "altitudes": [12, 30, 60, 90, 115], "speed": 5}]
POR = [{"pattern": "corridor_porpoise", "z_min": 15, "z_max": 115, "half_len_m": 200, "speed": 5}]
COL = [{"pattern": "corridor_columns", "z_min": 15, "z_max": 115, "station_spacing_m": 250, "speed": 5}]

run("skyway_km0_1.5", "skyway")
run("skyway_km4_1.5", "skyway", segment={"start_km": 4.0, "length_m": 1500})
run("skyway_km20_3000", "skyway", segment={"start_km": 20.0, "length_m": 3000}, auto_stations_spacing_m=600)
run("skyway_km40_1200_one_pilot", "skyway", segment={"start_km": 40.0, "length_m": 1200}, auto_stations_spacing_m=5000)
try:
    run("x", "skyway", segment={"start_km": 40.0, "length_m": 2000}, auto_stations_spacing_m=5000)
except ValueError:
    out["skyway_one_pilot_too_far_raises"] = {"raises": True}
run("corridor_example", "corridor")
run("corridor_8min", "corridor", sortie_max_min=8, section_by_station=False)
run("area_example", "area")
run("skyway_km0_1.5_linear_only", "skyway", segments=LIN)
run("skyway_km0_1.5_porpoise_only", "skyway", segments=POR)
run("skyway_km20_3000_linear_only", "skyway", segment={"start_km": 20.0, "length_m": 3000}, auto_stations_spacing_m=600, segments=LIN)
run("skyway_km20_3000_porpoise_only", "skyway", segment={"start_km": 20.0, "length_m": 3000}, auto_stations_spacing_m=600, segments=POR)
run("skyway_km0_1.5_columns_only", "skyway", segments=COL)
out.pop("x", None)
json.dump(out, open(outfile, "w"), indent=1)
print("wrote", outfile, len(out), "cases")
