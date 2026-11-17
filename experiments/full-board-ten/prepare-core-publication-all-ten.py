#!/usr/bin/env python3
"""Restore an already qualified Core graph; never build or route here."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile


CONTROLLER = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, indent=2) + "\n")


def authenticated_archive(expected):
    api = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{expected['id']}"
    actual = json.loads(subprocess.check_output(["gh", "api", api]))
    for field in ("id", "name", "size_in_bytes", "digest", "workflow_run"):
        require(actual[field] == expected[field], f"Artifact identity changed: {field}")
    require(not actual["expired"], "Required artifact expired")
    content = subprocess.check_output(["gh", "api", api + "/zip"])
    require(len(content) == expected["size_in_bytes"], "Artifact length changed")
    require("sha256:" + hashlib.sha256(content).hexdigest() == expected["digest"],
            "Artifact digest changed")
    packet = zipfile.ZipFile(io.BytesIO(content))
    names = packet.namelist()
    require(len(names) == len(set(names)), "Duplicate artifact member")
    require(all(not Path(name).is_absolute() and ".." not in Path(name).parts
                for name in names), "Unsafe artifact member")
    return packet, actual


def restore(root):
    alias = root / "runtime/node_modules/@tscircuit/core"
    original = root / "npm/core"
    require(alias.is_symlink() and alias.resolve() in (original, root / "npm/core-candidate"),
            "Unexpected Core alias during restore")
    alias.unlink()
    alias.symlink_to(original)
    shutil.copyfile(root / "published-runtime-manifest.json", root / "runtime-manifest.json")


def prepare(root, board, plan):
    binding = plan["primary"]
    require(binding["artifact"] is not None and binding["reviewedProofFiles"],
            "Primary qualification artifact is unbound; no candidate run is permitted")
    require(binding["rootApproved"] is True, "Primary artifact has not been approved")
    require({"core-source-pair/provenance.json", "core-source-pair/base-validation.json",
             "core-source-pair/candidate-validation.json", "core-source-pair/published-module-audit.json",
             "published-runtime-manifest.json"} <= binding["reviewedProofFiles"].keys(),
            "Primary artifact lacks the mandatory reviewed proof hashes")
    for name, expected in plan["frozenHarnessFiles"].items():
        require(digest(CONTROLLER / name) == expected, f"Frozen harness changed: {name}")
    published = read(root / "runtime-manifest.json")
    require(published["sourceOverrides"] is False and published["dependencyOverrides"] == [],
            "Prepare requires the unchanged published runtime")
    shutil.copyfile(root / "runtime-manifest.json", root / "published-runtime-manifest.json")
    destination = root / "qualified-primary"
    require(not destination.exists(), "Refuse to overwrite primary evidence")
    packet, artifact = authenticated_archive(binding["artifact"])
    with packet:
        prefix = ".full-board-run/"
        selected = [name for name in packet.namelist()
                    if name.startswith(prefix + "core-source-pair/")
                    or name == prefix + "published-runtime-manifest.json"]
        require(selected, "Primary artifact layout changed")
        for name in selected:
            if name.endswith("/"):
                continue
            target = destination / name.removeprefix(prefix)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(packet.read(name))
    for relative, expected in binding["reviewedProofFiles"].items():
        require(digest(destination / relative) == expected, f"Reviewed primary proof changed: {relative}")
    proof_path = destination / "core-source-pair/provenance.json"
    proof = read(proof_path)
    require(proof["passed"] and proof["unchangedDependencyGraph"], "Source qualification failed")
    require(proof["publishedModuleAudit"]["passed"], "Published module AST audit failed")
    require(proof["publishedModuleAudit"]["entirePublishedSourceClosureKnown"] is False,
            "Do not claim unknown npm build closure reconstruction")
    require(proof["sourceCommit"] == plan["sourceCommit"], "Wrong qualified Core source")
    require(all(proof["frozenSourceGraph"][key] is True for key in (
        "archiveDigestAndSizeVerified", "dependencyInventoryIdentical", "packageInventoryIdentical")),
        "Primary source dependency graph was not frozen")
    require(proof["productionFiles"] == plan["productionFiles"], "Production source changed")
    require(proof["reviewedProductionPatchSha256"] == plan["reviewedProductionPatchSha256"],
            "Reviewed production patch changed")
    require(all(proof["sourceTestGate"][key] is True for key in (
        "baselineExpectedFailure", "candidatePassed", "existingTestsPassed", "fullTypeScriptPassed")),
        "Source tests/typecheck did not qualify")
    require(proof["frozenHarnessFiles"] == plan["frozenHarnessFiles"], "Primary renderer differs")
    require(digest(destination / "core-source-pair/bun.lock") == proof["sharedLockSha256"],
            "Qualified source lock changed")
    validations = {lane: read(destination / f"core-source-pair/{lane}-validation.json")
                   for lane in ("base", "candidate")}
    for lane, validation in validations.items():
        require(validation["valid"] and validation["passed"], f"Native {lane} qualification failed")
        require(validation["sourceProofSha256"] == digest(proof_path), "Native proof source mismatch")
    require(validations["base"]["connectedNets"] == 0, "Published Butter control changed")
    require(set(validations["candidate"]["gainedNets"]) == set(plan["butterGainedNets"]),
            "Primary did not qualify all eight physical DQ nets")
    prior = read(destination / "published-runtime-manifest.json")
    require(published["mainVersion"] == prior["mainVersion"] == "0.0.3216", "Wrong main package")
    for field in ("runtimeDependencyFiles", "autorouterDependencyFiles", "additionalChangedPackages", "sourceCommits"):
        require(published[field] == prior[field], f"Frozen runtime inventory changed: {field}")
    require(proof["runtimeExternalGraph"] == {
        "runtime": published["runtimeDependencyFiles"], "autorouter": published["autorouterDependencyFiles"]},
        "Qualified external lock graph changed")
    packages = {row["name"]: row for row in published["packages"]}
    require(packages.keys() == {row["name"] for row in prior["packages"]}, "Package set changed")
    for expected in prior["packages"]:
        actual = packages[expected["name"]]
        for field in ("version", "integrity", "entryRelative", "entrySha256", "publishedFiles"):
            require(actual[field] == expected[field], f"Published package changed: {actual['name']}/{field}")
        folder = root / "npm" / actual["label"]
        for row in actual["publishedFiles"]:
            require(digest(folder / row["path"]) == row["sha256"], "Published package file changed")
    entry = proof["entries"]["candidate"]
    compiled = destination / "core-source-pair/candidate"
    require(entry["sha256"] == binding["candidateEntrySha256"], "Qualified candidate entry changed")
    require(digest(compiled / "index.js") == entry["sha256"], "Candidate entry bytes changed")
    actual_graph = [{"path": path.name, "sha256": digest(path)} for path in sorted(compiled.glob("*.js"))]
    require(actual_graph == entry["jsFiles"] == binding["candidateJsGraph"], "Candidate JS graph changed")
    core = packages["@tscircuit/core"]
    overlay = root / "npm/core-candidate"
    require(not overlay.exists(), "Refuse to replace existing Core overlay")
    files = []
    for row in core["publishedFiles"]:
        relative = row["path"]
        if relative.startswith("dist/") and relative.endswith((".js", ".js.map")):
            continue
        target = overlay / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        os.link(root / "npm/core" / relative, target)
        files.append(row)
    for path in sorted(compiled.iterdir()):
        if path.suffix not in (".js", ".map"):
            continue
        target = overlay / "dist" / path.name
        target.parent.mkdir(parents=True, exist_ok=True)
        os.link(path, target)
        files.append({"path": "dist/" + path.name, "bytes": path.stat().st_size, "sha256": digest(path)})
    (overlay / "node_modules").symlink_to(root / "runtime/node_modules")
    alias = root / "runtime/node_modules/@tscircuit/core"
    require(alias.is_symlink() and alias.resolve() == root / "npm/core", "Unexpected initial Core alias")
    alias.unlink()
    alias.symlink_to(overlay)
    override = {"name": "@tscircuit/core", "kind": "source", "version": core["version"],
                "originalEntrySha256": core["entrySha256"], "candidateEntrySha256": entry["sha256"],
                "sourceProofSha256": digest(proof_path), "primaryArtifactId": artifact["id"],
                "productionPatchSha256": proof["productionPatchSha256"],
                "runtimeDependenciesUnchanged": True, "coreRebuilt": False}
    replacement = {**core, "entry": str(overlay / core["entryRelative"]),
                   "entrySha256": entry["sha256"], "publishedFiles": files}
    manifest = {**published, "sourceOverrides": True, "experiment": "core-publication-all-ten",
                "dependencyOverrides": [override],
                "packages": [replacement if row["name"] == core["name"] else row for row in published["packages"]],
                "packageAliases": [{**row, "target": str(overlay)} if row["alias"] == str(alias) else row
                                   for row in published["packageAliases"]]}
    write(root / "runtime-manifest.json", manifest)
    write(root / "candidate-runtime-manifest.json", manifest)
    selected_cases = [row for row in plan["cases"] if row["board"] == board]
    require({row["cohort"] for row in selected_cases} == {"original", "spaced"}, "Missing paired cases")
    for case in selected_cases:
        packet, baseline_artifact = authenticated_archive(case["artifact"])
        baseline = root / "baselines" / board / case["cohort"]
        baseline.mkdir(parents=True)
        with packet:
            for row in case["requiredArtifactFiles"]:
                content = packet.read(row["name"])
                require(len(content) == row["bytes"] and hashlib.sha256(content).hexdigest() == row["sha256"],
                        f"Baseline member changed: {row['name']}")
                (baseline / row["name"]).write_bytes(content)
        write(baseline / "archive-proof.json", {"artifact": baseline_artifact, "archiveDigestAndSizeVerified": True})
        task_path = root / "cases" / f"{board}-{case['cohort']}.json"
        task = read(task_path)
        require(task["sourceSha256"] == case["sourceSha256"], "Authentic source changed")
        for key, value in case["immutablePolicy"].items():
            if key in task:
                require(task[key] == value, f"Case policy changed: {key}")
        task.update(experiment=manifest["experiment"], dependencyOverrides=[override])
        write(root / "cases" / f"candidate-{board}-{case['cohort']}.json", task)
    write(root / "core-all-ten-reuse.json", {
        "passed": True, "primaryArtifact": artifact, "primaryProofSha256": digest(proof_path),
        "candidateEntry": entry, "compiledJsGraph": actual_graph, "nativeValidation": validations,
        "originalRuntimeInventoriesMatched": True, "completeTransitiveByteInventoryClaimed": False,
        "coreBuilds": 0, "coreSourceDependencyResolutions": 0, "override": override,
        "runtimeManifestSha256": digest(root / "runtime-manifest.json")})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("operation", choices=["prepare", "restore"])
    parser.add_argument("board", nargs="?")
    args = parser.parse_args()
    if args.operation == "restore":
        restore(args.root.resolve())
    else:
        prepare(args.root.resolve(), args.board, read(CONTROLLER / "core-publication-all-ten-plan.json"))


if __name__ == "__main__":
    main()
