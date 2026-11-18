"""Authenticate previously published native inputs for a diagnostic replay."""

import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile

board, output_name = sys.argv[1:]
output = Path(output_name)
output.mkdir(parents=True, exist_ok=True)
plan = json.loads(Path(__file__).with_name("hd-capture-plan.json").read_text())
case = plan["cases"][board]
artifact = case["artifact"]
endpoint = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{artifact['id']}"
metadata = json.loads(subprocess.check_output(["gh", "api", endpoint]))
for field in ["id", "name", "size_in_bytes", "digest", "workflow_run"]:
    if metadata[field] != artifact[field]:
        raise RuntimeError(f"Artifact metadata changed: {field}")
archive = subprocess.check_output(["gh", "api", endpoint + "/zip"])
archive_sha = hashlib.sha256(archive).hexdigest()
if len(archive) != artifact["size_in_bytes"] or "sha256:" + archive_sha != artifact["digest"]:
    raise RuntimeError("Artifact ZIP identity mismatch")
with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
    for name, expected in case["files"].items():
        content = bundle.read(name)
        if len(content) != expected["bytes"] or hashlib.sha256(content).hexdigest() != expected["sha256"]:
            raise RuntimeError(f"Authenticated artifact member changed: {name}")
        if "payloadSha256" in expected and hashlib.sha256(gzip.decompress(content)).hexdigest() != expected["payloadSha256"]:
            raise RuntimeError(f"Native SRJ payload changed: {name}")
        (output / name).write_bytes(content)
progress = json.loads((output / "progress.json").read_text())
phase = next(phase for phase in progress["phases"] if phase["index"] == 4)
if phase["name"] != "other_signals" or phase["inputSha256"] != case["files"]["phase-4-input.srj.json.gz"]["payloadSha256"]:
    raise RuntimeError("Native phase identity mismatch")
(output / "input-proof.json").write_text(json.dumps({
    "board": board, "scope": plan["purpose"], "artifact": metadata,
    "archiveSha256": archive_sha, "files": case["files"], "phase": phase,
    "targetRoot": case["targetRoot"], "sourceSha256": progress["sourceSha256"],
    "noInputTransformations": True,
}, indent=2) + "\n")
print(json.dumps({"board": board, "inputVerified": True, "phaseInputSha256": phase["inputSha256"]}))
