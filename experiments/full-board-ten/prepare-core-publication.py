#!/usr/bin/env python3
"""Authenticate the native control and switch only the isolated Core package."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("operation", choices=["baseline", "base", "candidate", "restore"])
    args = parser.parse_args()
    root = args.root.resolve()
    controller = Path(__file__).resolve().parent
    plan = json.loads((controller / "core-publication-plan.json").read_text())
    manifest_path = root / "runtime-manifest.json"
    published_path = root / "published-runtime-manifest.json"
    if args.operation == "baseline":
        manifest = json.loads(manifest_path.read_text())
        if manifest["sourceOverrides"] or manifest["dependencyOverrides"]:
            raise RuntimeError("Baseline must use the untouched published runtime")
        shutil.copyfile(manifest_path, published_path)
        artifact = plan["baselineArtifact"]
        api = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{artifact['id']}"
        actual = json.loads(subprocess.check_output(["gh", "api", api]))
        for field in ["id", "name", "size_in_bytes", "digest", "workflow_run"]:
            if actual[field] != artifact[field]:
                raise RuntimeError(f"Baseline artifact identity changed: {field}")
        archive = subprocess.check_output(["gh", "api", api + "/zip"])
        if len(archive) != artifact["size_in_bytes"] or "sha256:" + hashlib.sha256(archive).hexdigest() != artifact["digest"]:
            raise RuntimeError("Baseline archive failed authentication")
        destination = root / "published-baseline"
        destination.mkdir()
        with zipfile.ZipFile(io.BytesIO(archive)) as packet:
            names = packet.namelist()
            if len(names) != len(set(names)):
                raise RuntimeError("Baseline archive contains duplicate member names")
            for row in plan["frozenArtifactFiles"]:
                # upload-artifact's single directory root produces flat members.
                matches = [name for name in names if name == row["name"]]
                if len(matches) != 1:
                    raise RuntimeError(f"Missing or ambiguous native baseline file: {row['name']}")
                content = packet.read(matches[0])
                if len(content) != row["bytes"] or hashlib.sha256(content).hexdigest() != row["sha256"]:
                    raise RuntimeError(f"Native baseline bytes changed: {row['name']}")
                (destination / row["name"]).write_bytes(content)
        (destination / "archive-proof.json").write_text(json.dumps({"artifact": actual, "archiveDigestAndSizeVerified": True}, indent=2) + "\n")
        return

    published_manifest = json.loads(published_path.read_text())
    core = next(row for row in published_manifest["packages"] if row["name"] == "@tscircuit/core")
    original = root / "npm/core"
    alias = root / "runtime/node_modules/@tscircuit/core"
    if args.operation == "restore":
        if not alias.is_symlink() or alias.resolve() not in [original, root / "npm/core-base", root / "npm/core-candidate"]:
            raise RuntimeError("Unexpected Core alias during restore")
        alias.unlink()
        alias.symlink_to(original)
        shutil.copyfile(published_path, manifest_path)
        return

    lane = args.operation
    proof_path = root / "core-source-pair/provenance.json"
    proof = json.loads(proof_path.read_text())
    if not proof["passed"] or not proof["unchangedDependencyGraph"] or not proof["publishedModuleAudit"]["passed"]:
        raise RuntimeError("Source pair has not passed qualification")
    if not plan["frozen"]:
        raise RuntimeError("Qualification plan is not frozen")
    for package in published_manifest["packages"]:
        folder = Path(package["entry"]).parent
        for _ in Path(package["entryRelative"]).parts[:-1]:
            folder = folder.parent
        for record in package["publishedFiles"]:
            if digest(folder / record["path"]) != record["sha256"]:
                raise RuntimeError(f"Original published package changed: {package['name']}/{record['path']}")
    for path, checksum in proof["frozenAssessorFiles"].items():
        if digest(Path(path)) != checksum:
            raise RuntimeError("Original assessor source changed")
    for relative, checksum in proof["frozenHarnessFiles"].items():
        if digest(controller / relative) != checksum:
            raise RuntimeError("Frozen renderer/harness changed")
    entry = proof["entries"][lane]
    source_folder = Path(entry["path"]).parent
    if digest(Path(entry["path"])) != entry["sha256"]:
        raise RuntimeError("Qualified compiled Core entry changed")
    overlay = root / f"npm/core-{lane}"
    overlay.mkdir()
    files = []
    for record in core["publishedFiles"]:
        relative = record["path"]
        if relative.startswith("dist/") and relative.endswith((".js", ".js.map")):
            continue
        target = overlay / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        os.link(original / relative, target)
        files.append(record)
    for path in sorted(source_folder.iterdir()):
        if not path.name.endswith((".js", ".js.map")):
            continue
        target = overlay / "dist" / path.name
        target.parent.mkdir(parents=True, exist_ok=True)
        os.link(path, target)
        files.append({"path": f"dist/{path.name}", "bytes": target.stat().st_size, "sha256": digest(target)})
    actual_js = [{"path": path.name, "sha256": digest(path)} for path in sorted((overlay / "dist").glob("*.js"))]
    if actual_js != entry["jsFiles"]:
        raise RuntimeError("Overlay compiled JS graph differs from qualified entry graph")
    (overlay / "node_modules").symlink_to(root / "runtime/node_modules")
    if not alias.is_symlink() or alias.resolve() not in [original, root / "npm/core-base"]:
        raise RuntimeError("Unexpected isolated Core alias")
    alias.unlink()
    alias.symlink_to(overlay)
    override = {
        "name": core["name"], "kind": "source", "version": core["version"], "lane": lane,
        "originalEntrySha256": core["entrySha256"], "candidateEntrySha256": entry["sha256"],
        "sourceProofSha256": digest(proof_path), "productionPatchSha256": proof["productionPatchSha256"],
        "runtimeDependenciesUnchanged": True,
        "runtimeOverrideKind": "Core compiled package graph only; no solver or output injection",
    }
    replacement = {**core, "entry": str(overlay / core["entryRelative"]), "entrySha256": entry["sha256"], "publishedEntry": core["entry"], "publishedEntrySha256": core["entrySha256"], "publishedFiles": files}
    manifest = {
        **published_manifest, "sourceOverrides": True, "experiment": f"core-phase-continuation-{lane}", "dependencyOverrides": [override],
        "packages": [replacement if row["name"] == core["name"] else row for row in published_manifest["packages"]],
        "packageAliases": [{**row, "target": str(overlay), "publishedTarget": str(original)} if row["alias"] == str(alias) else row for row in published_manifest["packageAliases"]],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    case_name = f"{plan['case']['board']}-{plan['case']['cohort']}"
    task = json.loads((root / f"cases/{case_name}.json").read_text())
    task.update(experiment=manifest["experiment"], dependencyOverrides=[override])
    (root / f"cases/{lane}-{case_name}.json").write_text(json.dumps(task, indent=2) + "\n")
    (root / f"core-source-pair/{lane}-overlay.json").write_text(json.dumps({
        **override, "originalPackagesVerified": True, "onlyCoreOverridden": True,
        "assessmentFilesUnchanged": True, "runtimeManifestSha256": digest(manifest_path),
        "externalRuntimeDependencyFiles": manifest["runtimeDependencyFiles"],
        "autorouterDependencyFiles": manifest["autorouterDependencyFiles"],
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
