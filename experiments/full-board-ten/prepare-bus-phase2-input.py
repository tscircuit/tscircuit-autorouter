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
output.mkdir(parents=True, exist_ok=True)
plan = json.loads(Path(__file__).with_name("bus-phase2-plan.json").read_text())
artifact = plan["input"]["artifact"]
endpoint = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{artifact['id']}"
metadata = json.loads(subprocess.check_output(["gh", "api", endpoint]))
for field in ["id", "name", "size_in_bytes", "digest", "workflow_run"]:
    assert metadata[field] == artifact[field], field
archive = subprocess.check_output(["gh", "api", endpoint + "/zip"])
assert len(archive) == artifact["size_in_bytes"]
assert "sha256:" + hashlib.sha256(archive).hexdigest() == artifact["digest"]
with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
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
(output / "input-proof.json").write_text(json.dumps({"artifact": metadata, "members": plan["input"]["members"], "phase": phase, "sourceSha256": progress["sourceSha256"], "inputTransformations": "Only native Core adapter applied later"}, indent=2) + "\n")
print(json.dumps({"inputVerified": True, "phaseInputSha256": phase["inputSha256"]}))
