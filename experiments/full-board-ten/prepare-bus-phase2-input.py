"""Authenticate one captured native byte1 input without rendering the board."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile

output = Path(sys.argv[1])
plan = json.loads(Path(__file__).with_name("bus-phase2-plan.json").read_text())
assert plan["qualificationReady"] is True, "Pending-access structural capture remains held"
pending_plan = json.loads(Path(__file__).with_name("pending-access-plan.json").read_text())
assert plan["source"]["sourceCandidateCommit"] == pending_plan["source"]["candidateCommit"]
assert plan["source"]["sourcePatchSha256"] == pending_plan["source"]["patchSha256"]
assert plan["source"]["sourceMappingSha256"] == pending_plan["sourceMappingSha256"]
assert plan["source"]["publishedPackages"] == pending_plan["runtime"]
output.mkdir(parents=True, exist_ok=True)
artifact = plan["input"]["artifact"]
endpoint = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{artifact['id']}"
metadata = json.loads(subprocess.check_output(["gh", "api", endpoint]))
for field in ["id", "name", "size_in_bytes", "digest", "workflow_run"]:
    assert metadata[field] == artifact[field], field
archive = subprocess.check_output(["gh", "api", endpoint + "/zip"])
assert len(archive) == artifact["size_in_bytes"]
assert "sha256:" + hashlib.sha256(archive).hexdigest() == artifact["digest"]
with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
    assert len(bundle.namelist()) == len(set(bundle.namelist()))
    for name, expected in plan["input"]["members"].items():
        content = bundle.read(name)
        assert len(content) == expected["bytes"], name
        assert hashlib.sha256(content).hexdigest() == expected["sha256"], name
        if "jsonSha256" in expected:
            assert hashlib.sha256(gzip.decompress(content)).hexdigest() == expected["jsonSha256"], name
        (output / Path(name).name).write_bytes(content)
progress = json.loads((output / "progress.json").read_text())
phase = next(item for item in progress["phases"] if item["index"] == 2)
assert phase["name"] == "byte1"
assert phase["inputSha256"] == plan["input"]["rawSha256"]
assert progress["id"] == "butterstick" and progress["cohort"] == "spaced"
override = progress["runtime"]["routingSourceOverride"]
assert override["sourceCandidateCommit"] == plan["source"]["sourceCandidateCommit"]
assert override["sourcePatchSha256"] == plan["source"]["sourcePatchSha256"]
assert override["sourceMappingSha256"] == plan["source"]["sourceMappingSha256"]
assert override["candidateCoreSha256"] == plan["source"]["candidateCoreSha256"]
assert override["autorouterSourceOverride"] is False
manifest = json.loads((output.parent / "candidate-runtime-manifest.json").read_text())
assert manifest["routingSourceOverride"] == override
case = json.loads((output.parent / "lanes/candidate/cases/butterstick-spaced.json").read_text())
assert case["sourceSha256"] == progress["sourceSha256"]
raw = gzip.decompress((output / "phase-2-input.srj.json.gz").read_bytes())
assert hashlib.sha256(raw).hexdigest() == plan["input"]["rawSha256"]
native = json.loads(raw)
assert len(native["obstacles"]) == plan["input"]["obstacles"]
assert len(native["traces"]) == plan["input"]["retainedTraces"]
assert sum(point["route_type"] == "via" for trace in native["traces"] for point in trace["route"]) == plan["input"]["retainedVias"]
assert len(native["connections"]) == plan["input"]["connections"]
assert sum(len(connection["pointsToConnect"]) for connection in native["connections"]) == plan["input"]["terminals"]
assert [connection["name"] for connection in native["connections"]] == plan["input"]["connectionOrder"]
(output / "input-proof.json").write_text(json.dumps({"artifact": metadata, "archiveSha256": hashlib.sha256(archive).hexdigest(), "members": plan["input"]["members"], "phase": phase, "sourceSha256": progress["sourceSha256"], "routingSourceOverride": override, "inputTransformations": "Only native Core adapter applied later; captured byte0 is not rerouted"}, indent=2) + "\n")
print(json.dumps({"inputVerified": True, "phaseInputSha256": phase["inputSha256"]}))
