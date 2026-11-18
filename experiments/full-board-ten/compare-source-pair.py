"""Compare independently assessed full H616 runs from one source-build pair."""

import hashlib
import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1])
rows = {}
manifests = {}
for variant in ["source-base", "source-candidate"]:
    directory = root / "lanes" / variant / "results/h616/spaced"
    result = json.loads((directory / "result.json").read_text())
    progress = json.loads((directory / "progress.json").read_text())
    assessment = json.loads((directory / "assessment.json").read_text())
    manifest_path = root / "runtime-manifests" / f"{variant}.json"
    manifest = json.loads(manifest_path.read_text())
    assert result["assessmentReady"] and result["routingPolicyObserved"]
    assert result["completeSourceCounts"] and not assessment["geometryErrors"]
    assert result["captureDeadlineMs"] == 900000 and result["hardDeadlineMs"] == 960000
    assert result["requestedRoutableNets"] == assessment["requestedNets"] == 121
    assert result["routingSourceOverride"] == manifest["routingSourceOverride"]
    assert progress["runtime"]["routingSourceOverride"] == manifest["routingSourceOverride"]
    assert len(set(assessment["unconnectedNets"])) == len(assessment["unconnectedNets"])
    assert assessment["connectedNets"] + len(assessment["unconnectedNets"]) == 121
    manifests[variant] = manifest
    rows[variant] = {
        "sourceCommit": manifest["routingSourceOverride"]["sourceCommit"],
        "sourceTree": manifest["routingSourceOverride"]["sourceTree"],
        "bundleSha256": manifest["routingSourceOverride"]["archiveSha256"],
        "runtimeManifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        "sourceSha256": progress["sourceSha256"],
        "implementationFiles": progress["implementationFiles"],
        "connectedNets": assessment["connectedNets"],
        "requestedNets": assessment["requestedNets"],
        "unconnectedNets": assessment["unconnectedNets"],
        "phasesCompleted": result["phasesCompleted"],
        "renderSettled": result["renderSettled"],
        "hardTimedOut": result["hardTimedOut"],
        "renderWallMs": result["renderWallMs"],
        "findings": assessment["findings"],
        "circuitGzipSha256": hashlib.sha256((directory / "circuit.json.gz").read_bytes()).hexdigest(),
        "phasePayloads": [{key: phase[key] for key in ["index", "name", "status", "inputSha256"]} for phase in progress["phases"]],
    }

base, candidate = rows["source-base"], rows["source-candidate"]
base_manifest, candidate_manifest = manifests["source-base"], manifests["source-candidate"]
assert base["sourceSha256"] == candidate["sourceSha256"]
assert base["implementationFiles"] == candidate["implementationFiles"]
for field in ["runtimeDependencyFiles", "autorouterDependencyFiles", "runner", "sourceCommits"]:
    assert base_manifest[field] == candidate_manifest[field], f"Unrelated runtime field changed: {field}"
assert base_manifest["routingSourceOverride"]["dependencySnapshotSha256"] == candidate_manifest["routingSourceOverride"]["dependencySnapshotSha256"]
base_packages = {package["name"]: package for package in base_manifest["packages"] if package["name"] != "@tscircuit/capacity-autorouter"}
candidate_packages = {package["name"]: package for package in candidate_manifest["packages"] if package["name"] != "@tscircuit/capacity-autorouter"}
assert base_packages == candidate_packages
gained = sorted(set(base["unconnectedNets"]) - set(candidate["unconnectedNets"]))
lost = sorted(set(candidate["unconnectedNets"]) - set(base["unconnectedNets"]))
comparison = {
    "scope": "Fresh full-board H616 spaced, same ARM runner, paired source builds with identical dependencies, unchanged published3234 main/Core/Eval and native900/960-second limits.",
    "runId": os.environ.get("GITHUB_RUN_ID"),
    "controllerCommit": os.environ.get("GITHUB_SHA"),
    "variants": rows,
    "connectedDelta": candidate["connectedNets"] - base["connectedNets"],
    "gainedConnectedNets": gained,
    "lostConnectedNets": lost,
    "completionGainWithoutLostNets": bool(gained) and not lost,
    "interpretation": "Only physical assessor connectivity counts as completion. Source-pair results do not claim reconstruction of published autorouter transitive dependencies. Review this paired result before launching all ten candidate circuits.",
}
(root / "source-pair-comparison.json").write_text(json.dumps(comparison, indent=2) + "\n")
print(json.dumps({key: value for key, value in comparison.items() if key != "variants"}, indent=2))
if "GITHUB_STEP_SUMMARY" in os.environ:
    with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as summary:
        summary.write("### Paired H616 spaced source comparison\n\n")
        summary.write("| Build | Connected/requested | Settled | Hard timeout |\n|---|---|---|---|\n")
        for name, row in rows.items():
            summary.write(f"| {name} | {row['connectedNets']}/121 | {row['renderSettled']} | {row['hardTimedOut']} |\n")
        summary.write(f"\nNewly connected: {len(gained)}. Previously connected nets lost: {len(lost)}.\n")
