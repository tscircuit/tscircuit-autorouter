"""Three handmade copper fixtures; invokes checks, never routes a board."""
import hashlib
import importlib.util
import json
import pathlib
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("cli_runtime", ROOT / "run-post588-experiments.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
manifest = json.loads((ROOT / "post588-experiments-20261029.json").read_text())
checkout = ROOT.parent.parent


def write_fixture(raw, coincident, same_net):
    connections, traces, circuit = [], [], []
    for index, name in enumerate(["a", "b"]):
        y = 0 if coincident else index
        connections.append({"name": name, **({"__netConnectionName": "shared"} if same_net else {}),
                            "pointsToConnect": [{"x": -1, "y": y, "layer": "top"}, {"x": 1, "y": y, "layer": "bottom"}]})
        route = [{"route_type": "wire", "x": -1, "y": y, "layer": "top", "width": .15},
                 {"route_type": "wire", "x": 0, "y": y, "layer": "top", "width": .15},
                 {"route_type": "via", "x": 0, "y": y, "from_layer": "top", "to_layer": "bottom"},
                 {"route_type": "wire", "x": 0, "y": y, "layer": "bottom", "width": .15},
                 {"route_type": "wire", "x": 1, "y": y, "layer": "bottom", "width": .15}]
        traces.append({"type": "pcb_trace", "pcb_trace_id": "trace_" + name, "connection_name": name, "route": route})
        circuit.append({"type": "pcb_trace", "pcb_trace_id": "trace_" + name, "source_trace_id": name, "route": route})
        circuit.append({"type": "pcb_via", "pcb_via_id": "via_" + name, "pcb_trace_id": "trace_" + name,
                        "x": 0, "y": y, "layers": ["top", "bottom"], "outer_diameter": .3, "hole_diameter": .15})
    original = {"layerCount": 2, "connections": connections, "obstacles": [], "bounds": {"minX": -2, "minY": -2, "maxX": 2, "maxY": 2}}
    hashes = {}
    for filename, value in zip(runtime.declared.INPUTS, [original, original, traces, circuit]):
        data = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        (raw / filename).write_bytes(data)
        hashes[filename] = hashlib.sha256(data).hexdigest()
    return hashes


statuses = []
with tempfile.TemporaryDirectory(prefix="post588-declared-synthetic-") as directory:
    for index, (coincident, same_net) in enumerate([(False, False), (True, False), (True, True)]):
        target = pathlib.Path(directory) / str(index)
        raw = target / "raw"
        raw.mkdir(parents=True)
        hashes = write_fixture(raw, coincident, same_net)
        record = {"expectedInputHash": hashes["original-input.json"], "supplemental": {"canonicalCircuitJsonSha256": hashes["canonical-circuit-json.json"]}}
        runtime.declared.qualify_output(record, target, checkout, manifest, ROOT, runtime.pinned.execute_with_deadline)
        assert record["declaredIntentValidationError"] is None, (record, (target / "declared-intent-validation.log").read_text())
        value = record["declaredIntentCopper"]
        assert value["inputHashes"] == hashes and value["checker"]["moduleSha256"] == runtime.CHECKER_SOURCE_SHA256
        assert value["sidecarSourceSha256"] == runtime.DECLARED_SOURCE_SHA256 and value["geometryUnchanged"] is True
        assert runtime.declared.validate_compact(record, manifest) == []
        statuses.append(value["status"])
        assert runtime.declared.supported_clean(record) is (not coincident or same_net)
        assert type(record["declaredIntentPostTimingWallMs"]) is float and record["declaredIntentPostTimingWallMs"] > 0
        assert {filename: hashlib.sha256((raw / filename).read_bytes()).hexdigest() for filename in hashes} == hashes
assert statuses == ["PASS", "FAIL_FOREIGN_COPPER", "PASS"], statuses
print(json.dumps({"status": "PASS", "syntheticOnly": True, "routedBoards": 0,
                  "actualFrozenCliChecks": 3, "copperFixtureStatuses": statuses,
                  "allFourInputByteHashesAndGeometryUnchanged": True}))
