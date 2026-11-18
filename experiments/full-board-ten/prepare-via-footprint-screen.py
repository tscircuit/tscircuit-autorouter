"""Diagnostic only: expose retained physical via footprints to native topology."""

import copy
import gzip
import hashlib
import json
import math
from pathlib import Path
import sys

input_path, output_name = sys.argv[1:]
output = Path(output_name)
output.mkdir(parents=True, exist_ok=True)
raw = gzip.decompress(Path(input_path).read_bytes())
original = json.loads(raw)
assert original["layerCount"] == 4
assert original["allowBlindAndBuriedVias"] is False
layers = ["top", "inner1", "inner2", "bottom"]
assert not any(obstacle.get("circuitJsonMetadata", {}).get("pcb_via_id") for obstacle in original["obstacles"]), "These frozen cases have no existing physical via obstacles"
candidate = copy.deepcopy(original)
footprints = []
identities = set()
for trace in original["traces"]:
    assert isinstance(trace["connection_name"], str) and trace["connection_name"]
    assert isinstance(trace["connectsTo"], list)
    assert all(isinstance(alias, str) and alias for alias in trace["connectsTo"])
    for route_index, point in enumerate(trace["route"]):
        if point["route_type"] != "via":
            continue
        assert point["from_layer"] in layers and point["to_layer"] in layers
        assert point["from_layer"] != point["to_layer"]
        diameter = point["via_diameter"]
        assert isinstance(diameter, (int, float)) and math.isfinite(diameter) and diameter > 0
        assert all(math.isfinite(point[axis]) for axis in ["x", "y"])
        identity = (trace["connection_name"], point["x"], point["y"], diameter)
        assert identity not in identities, "Duplicate retained via needs explicit ownership review"
        identities.add(identity)
        footprints.append({
            "obstacleId": f"preloaded_via_{trace['pcb_trace_id']}_{route_index}",
            "type": "rect",
            "shape": "circle",
            "center": {"x": point["x"], "y": point["y"]},
            "width": diameter,
            "height": diameter,
            "layers": layers.copy(),
            "connectedTo": list(dict.fromkeys([trace["connection_name"], *trace["connectsTo"]])),
        })
assert footprints
candidate["obstacles"].extend(footprints)
unchanged = copy.deepcopy(candidate)
unchanged["obstacles"] = unchanged["obstacles"][:len(original["obstacles"])]
assert unchanged == original, "Only appending via footprints is permitted"
candidate_bytes = json.dumps(candidate, separators=(",", ":")).encode()
(output / "phase-4-input.srj.json.gz").write_bytes(gzip.compress(candidate_bytes, compresslevel=9, mtime=0))
proof = {
    "scope": "Input-only retained-via topology screen under frozen published1127. Not production code, not a fresh full-board run, and not a completion claim.",
    "originalInputSha256": hashlib.sha256(raw).hexdigest(),
    "candidateInputSha256": hashlib.sha256(candidate_bytes).hexdigest(),
    "originalObstacleCount": len(original["obstacles"]),
    "candidateObstacleCount": len(candidate["obstacles"]),
    "addedViaFootprints": footprints,
    "onlyMutation": "append exact retained circular via pad footprints with actual ownership and full physical through span",
    "mutableCopperLimitation": "Original trace mutability is unchanged. These diagnostic footprints remain obstacles even if retained copper is later moved; a positive result needs a source implementation and lifecycle review before acceptance.",
}
(output / "via-footprint-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps({key: value for key, value in proof.items() if key != "addedViaFootprints"}))
