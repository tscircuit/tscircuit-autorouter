#!/usr/bin/env python3
"""Reuse qualified compiled entries and authenticate the actual Butter input."""

import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile


def read_artifact(expected: dict, selected: list[str]) -> tuple[dict, dict]:
    api = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{expected['id']}"
    actual = json.loads(subprocess.check_output(["gh", "api", api]))
    for field in ["id", "name", "size_in_bytes", "digest", "workflow_run"]:
        if actual[field] != expected[field]:
            raise RuntimeError(f"Artifact identity changed: {field}")
    archive = subprocess.check_output(["gh", "api", api + "/zip"])
    if len(archive) != expected["size_in_bytes"] or "sha256:" + hashlib.sha256(archive).hexdigest() != expected["digest"]:
        raise RuntimeError("Artifact archive failed authentication")
    with zipfile.ZipFile(io.BytesIO(archive)) as packet:
        names = packet.namelist()
        if len(names) != len(set(names)) or not set(selected).issubset(names):
            raise RuntimeError("Missing or duplicate artifact members")
        if any(Path(name).is_absolute() or ".." in Path(name).parts for name in names):
            raise RuntimeError("Unsafe artifact member")
        return actual, {name: packet.read(name) for name in selected}


def main() -> None:
    root = Path(sys.argv[1]).resolve()
    controller = Path(__file__).resolve().parent
    plan = json.loads((controller / "butter-phase-plan.json").read_text())
    prefix = ".full-board-run/"
    source_members = [
        prefix + "source-pair/provenance.json",
        prefix + "source-pair/published-closure-audit.json",
        prefix + "native-phase/base/validation.json",
        prefix + "runtime-manifest.json",
        *[prefix + f"source-pair/{lane}/{name}" for lane in ["base", "candidate"] for name in ["index.js", "index.js.map"]],
    ]
    source_artifact, source = read_artifact(plan["sourceArtifact"], source_members)
    proof = json.loads(source[prefix + "source-pair/provenance.json"])
    closure = json.loads(source[prefix + "source-pair/published-closure-audit.json"])
    previous_control = json.loads(source[prefix + "native-phase/base/validation.json"])
    if proof["passed"] is not True or proof["nonTinySourceBodiesIdentical"] is not True or proof["productionPatchSha256"] != plan["productionPatchSha256"]:
        raise RuntimeError("Source pair is not the reviewed qualified candidate")
    if closure["passed"] is not True or closure["differences"] != {} or previous_control["valid"] is not True:
        raise RuntimeError("Source pair lacks published closure or native control parity")
    prior_runtime = json.loads(source[prefix + "runtime-manifest.json"])
    runtime = json.loads((root / "runtime-manifest.json").read_text())
    for packet in [prior_runtime, runtime]:
        if packet["sourceOverrides"] is not False or packet["dependencyOverrides"] != []:
            raise RuntimeError("Expected the unchanged published external runtime")
    for field in ["runtimeDependencyFiles", "autorouterDependencyFiles", "additionalChangedPackages"]:
        if runtime[field] != prior_runtime[field]:
            raise RuntimeError(f"External runtime changed: {field}")
    identities = lambda packet: {row["name"]: (row["version"], row["entrySha256"]) for row in packet["packages"]}
    if identities(runtime) != identities(prior_runtime):
        raise RuntimeError("Published package chain changed")
    selected = [plan["inputFile"], "coarse-diagnostics.json"]
    baseline_artifact, baseline = read_artifact(plan["baselineArtifact"], selected)
    if hashlib.sha256(gzip.decompress(baseline[plan["inputFile"]])).hexdigest() != plan["inputSha256"]:
        raise RuntimeError("Native Butter plane-escape input changed")
    if hashlib.sha256(baseline["coarse-diagnostics.json"]).hexdigest() != plan["baselineCoarseSha256"]:
        raise RuntimeError("Native Butter coarse baseline changed")
    native = root / "native-input"
    native.mkdir()
    for name, content in baseline.items():
        (native / name).write_bytes(content)
    retained = root / "retained-source"
    retained.mkdir()
    for name in ["provenance.json", "published-closure-audit.json"]:
        (retained / name).write_bytes(source[prefix + "source-pair/" + name])
    (retained / "glider-control-validation.json").write_bytes(source[prefix + "native-phase/base/validation.json"])
    original = next(row for row in runtime["packages"] if row["label"] == "autorouter")
    for lane in ["base", "candidate"]:
        folder = retained / lane
        folder.mkdir()
        for name, expected_sha in plan["sourceEntries"][lane].items():
            content = source[prefix + f"source-pair/{lane}/{name}"]
            if hashlib.sha256(content).hexdigest() != expected_sha:
                raise RuntimeError(f"Qualified compiled bytes changed: {lane}/{name}")
            (folder / name).write_bytes(content)
        if proof["entries"][lane]["sha256"] != plan["sourceEntries"][lane]["index.js"]:
            raise RuntimeError("Compiled entry differs from source qualification")
        (folder / "node_modules").symlink_to(root / "autorouter-dependencies/node_modules")
        record = {
            "variant": lane, "targetPhase": "plane_escape",
            "selectedAutorouterEntry": str(folder / "index.js"),
            "selectedAutorouterSha256": plan["sourceEntries"][lane]["index.js"],
            "originalAutorouterEntry": original["entry"], "originalAutorouterSha256": original["entrySha256"],
            "inputPath": str(native / plan["inputFile"]), "inputSha256": plan["inputSha256"],
            "captureDeadlineMs": plan["limits"]["captureMs"], "hardDeadlineMs": plan["limits"]["hardMs"],
            "sourceArtifactId": source_artifact["id"], "sourceProofSha256": hashlib.sha256(source[prefix + "source-pair/provenance.json"]).hexdigest(),
        }
        (root / f"phase-runtime-{lane}.json").write_text(json.dumps(record, indent=2) + "\n")
    (root / "butter-artifact-proof.json").write_text(json.dumps({
        "authenticated": True, "sourceArtifact": source_artifact, "baselineArtifact": baseline_artifact,
        "sourceMembers": {name: hashlib.sha256(content).hexdigest() for name, content in source.items()},
        "baselineMembers": {name: hashlib.sha256(content).hexdigest() for name, content in baseline.items()},
        "recompiled": False, "externalRuntimeUnchanged": True,
    }, indent=2) + "\n")
    print(json.dumps({"prepared": plan["case"], "phase": plan["phase"], "recompiled": False}))


if __name__ == "__main__":
    main()
