#!/usr/bin/env python3
"""Build and test one frozen Core source pair before native qualification."""

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command, cwd):
    subprocess.run(command, cwd=cwd, check=True)


def inventory(folder):
    records = {}
    for current, directories, files in os.walk(folder, followlinks=False):
        for name in directories + files:
            path = Path(current) / name
            key = str(path.relative_to(folder))
            if path.is_symlink():
                target = path.resolve()
                if not target.is_relative_to(folder):
                    raise RuntimeError(f"Dependency alias escapes frozen graph: {key}")
                records[key] = {"symlink": str(target.relative_to(folder))}
            elif path.is_file():
                records[key] = {"sha256": digest(path)}
    return records


def source_bodies(folder, source):
    bodies = {}
    for path in folder.glob("*.js.map"):
        packet = json.loads(path.read_text())
        if len(packet["sources"]) != len(packet["sourcesContent"]):
            raise RuntimeError("Incomplete source map")
        for name, content in zip(packet["sources"], packet["sourcesContent"]):
            if not isinstance(content, str):
                raise RuntimeError(f"Missing source body: {name}")
            resolved = Path(os.path.abspath(path.parent / name))
            if not resolved.is_relative_to(source):
                raise RuntimeError(f"Source map escapes isolated checkout: {name}")
            key = str(resolved.relative_to(source))
            value = hashlib.sha256(content.encode()).hexdigest()
            if key in bodies and bodies[key] != value:
                raise RuntimeError(f"Ambiguous source body: {key}")
            bodies[key] = value
    if not bodies:
        raise RuntimeError("Build produced no source bodies")
    return bodies


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    root, source = args.root.resolve(), args.source.resolve()
    controller = Path(__file__).resolve().parent
    plan = json.loads((controller / "core-publication-plan.json").read_text())
    if not plan["frozen"]:
        raise RuntimeError("Core source/tests have not been frozen and reviewed")
    if subprocess.check_output(["bun", "--version"], text=True).strip() != "1.4.3":
        raise RuntimeError("Require Bun1.4.3")
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip() != plan["corePrepublishBuildCommit"]:
        raise RuntimeError("Wrong Core prepublish source checkout")
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=source, text=True).strip():
        raise RuntimeError("Core source checkout is not clean")
    proof = root / "core-source-pair"
    proof.mkdir()
    original_manifest = (source / "package.json").read_bytes()
    manifest = json.loads(original_manifest)
    published_manifest = json.loads((root / "npm/core/package.json").read_text())
    expected_manifest = {**published_manifest, "version": plan["coreEmbeddedVersion"]}
    if manifest != expected_manifest:
        raise RuntimeError("Prepublish source manifest differs beyond verified release version bump")
    for relative, expected in plan["productionFiles"].items():
        if digest(source / relative) != expected["beforeSha256"]:
            raise RuntimeError(f"Production source preimage changed: {relative}")
    test_patch = controller / "core-publication-tests.patch"
    production_patch = controller / "core-publication-production.patch"
    for path, expected in [(test_patch, plan["testPatchSha256"]), (production_patch, plan["productionPatchSha256"])]:
        if digest(path) != expected:
            raise RuntimeError(f"Reviewed patch changed: {path.name}")
    install_config = proof / "install.bunfig.toml"
    install_config.write_text("[install.lockfile]\nsave = true\n")
    frozen_graph = plan["frozenSourceGraph"]
    artifact = frozen_graph["artifact"]
    api = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{artifact['id']}"
    actual = json.loads(subprocess.check_output(["gh", "api", api]))
    for field in ["id", "name", "size_in_bytes", "digest", "workflow_run"]:
        if actual[field] != artifact[field]:
            raise RuntimeError(f"Frozen source graph artifact changed: {field}")
    archive = subprocess.check_output(["gh", "api", api + "/zip"])
    if len(archive) != artifact["size_in_bytes"] or "sha256:" + hashlib.sha256(archive).hexdigest() != artifact["digest"]:
        raise RuntimeError("Frozen source graph archive failed authentication")
    frozen_directory = proof / "frozen-source-graph"
    frozen_directory.mkdir()
    with zipfile.ZipFile(io.BytesIO(archive)) as packet:
        names = packet.namelist()
        if len(names) != len(set(names)):
            raise RuntimeError("Frozen source graph archive has duplicate members")
        for filename, record in frozen_graph["files"].items():
            if names.count(record["member"]) != 1:
                raise RuntimeError(f"Frozen source graph member missing: {filename}")
            content = packet.read(record["member"])
            if len(content) != record["bytes"] or hashlib.sha256(content).hexdigest() != record["sha256"]:
                raise RuntimeError(f"Frozen source graph member changed: {filename}")
            (frozen_directory / filename).write_bytes(content)
    shutil.copyfile(frozen_directory / "bun.lock", source / "bun.lock")
    run(["bun", f"--config={install_config}", "install", "--frozen-lockfile", "--ignore-scripts", "--backend", "copy"], source)
    lock = source / "bun.lock"
    lock_sha = digest(lock)
    if lock_sha != frozen_graph["files"]["bun.lock"]["sha256"]:
        raise RuntimeError("Installation changed the authenticated source lock")
    (proof / "bun.lock").write_bytes(lock.read_bytes())
    if (source / "package.json").read_bytes() != original_manifest:
        raise RuntimeError("Installation changed source manifest")
    graph = inventory(source / "node_modules")
    with gzip.open(frozen_directory / "dependency-inventory.json.gz", "rt") as stream:
        if graph != json.load(stream):
            raise RuntimeError("Resolved source dependency inventory differs from the first authenticated graph")
    with gzip.open(proof / "dependency-inventory.json.gz", "wt") as stream:
        json.dump(graph, stream, sort_keys=True)
    packages = []
    for relative in graph:
        if relative.endswith("/package.json"):
            path = source / "node_modules" / relative
            if path.is_file():
                package = json.loads(path.read_text())
                packages.append({"path": relative, "name": package.get("name"), "version": package.get("version"), "sha256": digest(path)})
    expected_packages = json.loads((frozen_directory / "resolved-packages.json").read_text())
    if sorted(packages, key=lambda row: row["path"]) != sorted(expected_packages, key=lambda row: row["path"]):
        raise RuntimeError("Resolved source package inventory differs from the first authenticated graph")
    (frozen_directory / "proof.json").write_text(json.dumps({"artifact": actual, "archiveDigestAndSizeVerified": True, "selectedFiles": frozen_graph["files"], "dependencyInventoryIdentical": True, "packageInventoryIdentical": True}, indent=2) + "\n")
    (proof / "resolved-packages.json").write_text(json.dumps(packages, indent=2) + "\n")
    run(["patch", "--batch", "--forward", "-p1", "-i", str(test_patch)], source)
    for relative, checksum in plan["testFiles"].items():
        if digest(source / relative) != checksum:
            raise RuntimeError(f"Reviewed test differs: {relative}")

    def tests(name, paths, expected_failure=False, update_new_snapshots=False):
        command = ["bun", "test", *paths, "--timeout", "120000"]
        environment = {**os.environ, "NO_COLOR": "1"}
        environment.pop("BUN_UPDATE_SNAPSHOTS", None)
        if update_new_snapshots:
            environment["BUN_UPDATE_SNAPSHOTS"] = "1"
        result = subprocess.run(command, cwd=source, env=environment, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (proof / f"{name}.log").write_text(result.stdout)
        record = {"command": command, "exitCode": result.returncode, "updateNewSnapshots": update_new_snapshots, "logSha256": digest(proof / f"{name}.log")}
        if expected_failure:
            if (result.returncode != 1
                or not all(text in result.stdout for text in plan["baselineFailureMustContain"])
                or not all(re.search(pattern, result.stdout) for pattern in plan["baselineFailurePatterns"])):
                raise RuntimeError("Baseline repro did not fail at its reviewed accepted-phase assertion")
        elif result.returncode != 0:
            raise RuntimeError(f"Focused Core tests failed: {name}")
        return record

    def preserve_snapshots(lane):
        directory = proof / "test-snapshots" / lane
        records = []
        for relative in plan["testFiles"]:
            test = Path(relative)
            stem = test.name.replace(".test.tsx", "").replace(".test.ts", "")
            for path in sorted((source / test.parent / "__snapshots__").glob(stem + "*.svg")):
                destination = directory / path.relative_to(source)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, destination)
                records.append({"path": str(destination.relative_to(proof)), "sha256": digest(destination)})
        if not records:
            raise RuntimeError(f"Actual held-phase SVG snapshot missing: {lane}")
        (directory / "proof.json").write_text(json.dumps(records, indent=2) + "\n")

    def typecheck(lane, focused=False):
        command = ["bunx", "--no-install", "tsc", "--noEmit", "--pretty", "false"]
        if focused:
            config = proof / "tsconfig.focused.json"
            config.write_text(json.dumps({
                "extends": str(source / "tsconfig.json"),
                "include": [str(source / name) for name in [*plan["productionFiles"], *plan["testFiles"]]],
            }, indent=2) + "\n")
            command.extend(["-p", str(config)])
        result = subprocess.run(command, cwd=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        name = f"{lane}-typescript{'-focused' if focused else ''}.log"
        (proof / name).write_text(result.stdout)
        return {"command": command, "exitCode": result.returncode, "logSha256": digest(proof / name)}

    records = {"baselineExisting": tests("baseline-existing", plan["existingTests"])}
    records["baselineRepro"] = tests("baseline-repro", [plan["reproTest"]], expected_failure=True, update_new_snapshots=True)
    preserve_snapshots("base")
    records["baselineTypeScript"] = typecheck("base")
    if records["baselineTypeScript"]["exitCode"] != 0:
        records["baselineFocusedTypeScript"] = typecheck("base", focused=True)
    run(["bun", str(controller / "build-core-source-entry.mjs"), str(source), str(proof / "base")], source)
    run(["bun", str(controller / "audit-core-source-build.mjs"), str(source), str(root / "npm/core/dist"), str(proof / "base"), str(proof / "published-module-audit.json")], source)
    base_bodies = source_bodies(proof / "base", source)
    run(["patch", "--batch", "--forward", "-p1", "-i", str(production_patch)], source)
    for relative, expected in plan["productionFiles"].items():
        if digest(source / relative) != expected["afterSha256"]:
            raise RuntimeError(f"Candidate differs from reviewed source: {relative}")
    changed = set(subprocess.check_output(["git", "diff", "--name-only"], cwd=source, text=True).splitlines())
    if changed != set(plan["productionFiles"]):
        raise RuntimeError(f"Unexpected tracked source change: {sorted(changed)}")
    records["candidateNew"] = tests("candidate-new", plan["candidateTests"], update_new_snapshots=True)
    preserve_snapshots("candidate")
    records["candidateExisting"] = tests("candidate-existing", plan["existingTests"])
    records["candidateTypeScript"] = typecheck("candidate")
    if records["baselineTypeScript"]["exitCode"] != 0 or records["candidateTypeScript"]["exitCode"] != 0:
        records["candidateFocusedTypeScript"] = typecheck("candidate", focused=True)
    (proof / "test-results.json").write_text(json.dumps(records, indent=2) + "\n")
    if records["baselineTypeScript"]["exitCode"] != 0 or records["candidateTypeScript"]["exitCode"] != 0:
        raise RuntimeError("Core TypeScript validation failed; inspect baseline/candidate and focused diagnostics before routing")
    run(["bun", str(controller / "build-core-source-entry.mjs"), str(source), str(proof / "candidate")], source)
    candidate_bodies = source_bodies(proof / "candidate", source)
    changes = {key for key in base_bodies.keys() | candidate_bodies.keys() if base_bodies.get(key) != candidate_bodies.get(key)}
    if changes != set(plan["productionFiles"]):
        raise RuntimeError(f"Unexpected bundled source change: {sorted(changes)}")
    if inventory(source / "node_modules") != graph or digest(lock) != lock_sha or (source / "package.json").read_bytes() != original_manifest:
        raise RuntimeError("Tests/builds changed the frozen dependency graph or manifest")
    entries = {}
    for lane in ["base", "candidate"]:
        folder = proof / lane
        entries[lane] = {"path": str(folder / "index.js"), "sha256": digest(folder / "index.js"), "jsFiles": [{"path": path.name, "sha256": digest(path)} for path in sorted(folder.glob("*.js"))]}
    task = json.loads((root / "cases/butterstick-spaced.json").read_text())
    evidence = {
        "passed": True, "sourceCommit": plan["corePrepublishBuildCommit"],
        "productionPatchSha256": plan["productionPatchSha256"], "productionFiles": plan["productionFiles"],
        "reviewedProductionPatchSha256": plan["reviewedProductionPatchSha256"],
        "sharedLockSha256": lock_sha, "unchangedDependencyGraph": True,
        "frozenSourceGraph": json.loads((frozen_directory / "proof.json").read_text()),
        "publishedModuleAudit": json.loads((proof / "published-module-audit.json").read_text()),
        "sourceTestGate": {"baselineExpectedFailure": True, "candidatePassed": True, "existingTestsPassed": True, "fullTypeScriptPassed": True},
        "sourceTestResults": records, "entries": entries, "changedBundledSources": sorted(changes),
        "frozenHarnessFiles": {name: digest(controller / name) for name in plan["frozenHarnessFiles"]},
        "frozenAssessorFiles": {row["path"]: row["sha256"] for row in task["assessmentSourceFiles"]},
        "runtimeExternalGraph": {"runtime": json.loads((root / "runtime-manifest.json").read_text())["runtimeDependencyFiles"], "autorouter": json.loads((root / "runtime-manifest.json").read_text())["autorouterDependencyFiles"]},
    }
    if evidence["frozenHarnessFiles"] != plan["frozenHarnessFiles"]:
        raise RuntimeError("Frozen full-board harness changed")
    (proof / "provenance.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"sourcePairQualified": True, "focusedTestsPassed": True, "compiledControlMatchesPublished": True, "changedBundledSources": sorted(changes)}))


if __name__ == "__main__":
    main()
