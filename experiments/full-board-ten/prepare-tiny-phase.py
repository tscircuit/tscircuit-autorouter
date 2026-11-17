#!/usr/bin/env python3
"""Authenticate the existing native input; do not recreate or trim the board."""

import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile


def main() -> None:
    root = Path(sys.argv[1]).resolve()
    controller = Path(__file__).resolve().parent
    plan = json.loads((controller / "tiny-source-plan.json").read_text())
    proof = json.loads((root / "source-pair/provenance.json").read_text())
    if proof["passed"] is not True or proof["nonTinySourceBodiesIdentical"] is not True:
        raise RuntimeError("Native routing requires a qualified source closure")
    expected = plan["baselineArtifact"]
    api = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{expected['id']}"
    actual = json.loads(subprocess.check_output(["gh", "api", api]))
    for field in ["id", "name", "size_in_bytes", "digest", "workflow_run"]:
        if actual[field] != expected[field]:
            raise RuntimeError(f"Baseline artifact identity changed: {field}")
    archive = subprocess.check_output(["gh", "api", api + "/zip"])
    if len(archive) != expected["size_in_bytes"] or "sha256:" + hashlib.sha256(archive).hexdigest() != expected["digest"]:
        raise RuntimeError("Baseline archive failed authentication")
    destination = root / "native-input"
    destination.mkdir()
    selected = {"phase-4-input.srj.json.gz", "coarse-diagnostics.json", "progress.json", "result.json"}
    with zipfile.ZipFile(io.BytesIO(archive)) as packet:
        for name in packet.namelist():
            path = Path(name)
            if path.is_absolute() or ".." in path.parts:
                raise RuntimeError("Unsafe baseline archive member")
        if not selected.issubset(set(packet.namelist())):
            raise RuntimeError("Native baseline artifact is incomplete")
        for name in selected:
            (destination / name).write_bytes(packet.read(name))
    input_path = destination / "phase-4-input.srj.json.gz"
    if hashlib.sha256(gzip.decompress(input_path.read_bytes())).hexdigest() != plan["inputSha256"]:
        raise RuntimeError("Wrong actual Glider other_signals input")
    if hashlib.sha256((destination / "coarse-diagnostics.json").read_bytes()).hexdigest() != plan["coarseSha256"]:
        raise RuntimeError("Wrong native baseline coarse witness")
    (destination / "archive-proof.json").write_text(json.dumps({"authenticated": True, "artifact": actual, "selectedFiles": sorted(selected)}, indent=2) + "\n")
    published_manifest = json.loads((root / "runtime-manifest.json").read_text())
    published_ar = next(item for item in published_manifest["packages"] if item["label"] == "autorouter")
    for lane in ["base", "candidate"]:
        entry = proof["entries"][lane]
        folder = Path(entry["path"]).parent
        (folder / "node_modules").symlink_to(root / "autorouter-dependencies/node_modules")
        record = {
            "variant": lane, "selectedAutorouterEntry": entry["path"], "selectedAutorouterSha256": entry["sha256"],
            "originalAutorouterEntry": published_ar["entry"], "originalAutorouterSha256": published_ar["entrySha256"],
            "inputPath": str(input_path), "inputSha256": plan["inputSha256"],
            "captureDeadlineMs": plan["captureDeadlineMs"], "hardDeadlineMs": plan["hardDeadlineMs"],
            "sourceProofSha256": hashlib.sha256((root / "source-pair/provenance.json").read_bytes()).hexdigest(),
        }
        (root / f"phase-runtime-{lane}.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"authenticatedNativeInput": plan["inputSha256"], "baselineArtifact": expected["id"]}))


if __name__ == "__main__":
    main()
