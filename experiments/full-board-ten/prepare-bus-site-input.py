"""Authenticate native published inputs without re-running the board."""

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
plan = json.loads(Path(__file__).with_name("bus-site-plan.json").read_text())
artifact = plan["artifact"]
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
    for name, expected in plan["files"].items():
        content = bundle.read(name)
        if len(content) != expected["bytes"] or hashlib.sha256(content).hexdigest() != expected["sha256"]:
            raise RuntimeError(f"Artifact member identity mismatch: {name}")
        if "payloadSha256" in expected:
            if hashlib.sha256(gzip.decompress(content)).hexdigest() != expected["payloadSha256"]:
                raise RuntimeError(f"Native payload identity mismatch: {name}")
        (output / name).write_bytes(content)
progress = json.loads((output / "progress.json").read_text())
phase = next(item for item in progress["phases"] if item["index"] == 2)
if phase["name"] != "byte1" or phase["inputSha256"] != plan["expectedRawInputSha256"]:
    raise RuntimeError("Native phase identity mismatch")
(output / "input-proof.json").write_text(json.dumps({
    "scope": plan["purpose"], "artifact": metadata,
    "archiveSha256": archive_sha, "files": plan["files"],
    "phase": phase, "sourceSha256": progress["sourceSha256"],
    "noInputTransformations": True,
}, indent=2) + "\n")
print(json.dumps({"inputVerified": True, "phaseInputSha256": phase["inputSha256"]}))
