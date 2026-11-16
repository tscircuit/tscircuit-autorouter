#!/usr/bin/env python3
"""Prepare an exact published-AR pair with identical Dataset18 evaluation code."""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def inventory(folder: Path) -> dict:
    records = {}
    for current, directories, filenames in os.walk(folder, followlinks=False):
        for name in directories + filenames:
            path = Path(current) / name
            if path.is_symlink():
                target = path.resolve()
                if not target.is_relative_to(folder):
                    raise RuntimeError(f"Dependency alias escaped its graph: {path}")
                records[str(path.relative_to(folder))] = {"symlink": str(target.relative_to(folder))}
            elif path.is_file():
                records[str(path.relative_to(folder))] = {"sha256": digest(path), "bytes": path.stat().st_size}
    return records


def copy_graph(source: Path, destination: Path) -> None:
    shutil.copytree(source, destination, symlinks=True, copy_function=os.link)
    for current, directories, filenames in os.walk(destination, followlinks=False):
        for name in directories + filenames:
            path = Path(current) / name
            if path.is_symlink() and os.path.isabs(os.readlink(path)):
                target = Path(os.readlink(path))
                if not target.is_relative_to(source):
                    raise RuntimeError("Absolute dependency alias escaped the shared graph")
                path.unlink()
                path.symlink_to(destination / target.relative_to(source))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--runtime-root", required=True, type=Path)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    workspace, runtime = args.workspace.resolve(), args.runtime_root.resolve()
    controller = Path(__file__).resolve().parent
    frozen = json.loads((controller / "experiment.json").read_text())
    artifact = workspace / "dataset18-pair-proof"
    base, candidate = workspace / "same-machine-base", workspace / "same-machine-pr"
    if subprocess.check_output(["bun", "--version"], text=True).strip() != "1.4.3":
        raise RuntimeError("Both lanes require Bun1.4.3")
    if not frozen["frozen"]:
        raise RuntimeError("Diagnostic adapter is not frozen")

    if args.verify_only:
        proof = json.loads((artifact / "provenance.json").read_text())
        with gzip.open(artifact / "harness-dependencies.json.gz", "rt") as stream:
            expected_graph = json.load(stream)
        for lane, folder in [("base", base), ("pr", candidate)]:
            if inventory(folder / "node_modules") != expected_graph:
                raise RuntimeError(f"{lane} harness dependency bytes changed")
            for name, expected in proof["lanes"][lane]["harnessFiles"].items():
                if digest(folder / name) != expected:
                    raise RuntimeError(f"{lane} measured harness changed: {name}")
            if digest(folder / "bun.lock") != proof["harnessLockSha256"]:
                raise RuntimeError("Shared harness lock changed")
            entry = proof["routingEntries"][lane]
            if digest(Path(entry["entry"])) != entry["sha256"]:
                raise RuntimeError(f"{lane} routing entry changed")
        if inventory(Path(proof["routingEntries"]["sharedRoutingDependencies"])) != proof["routingDependencyInventory"]:
            raise RuntimeError("Frozen published routing dependencies changed")
        if digest(runtime / "runtime-manifest.json") != proof["routingEntries"]["originalRuntimeManifestSha256"]:
            raise RuntimeError("Published runtime manifest changed")
        for package in json.loads((runtime / "runtime-manifest.json").read_text())["packages"]:
            if digest(Path(package["entry"])) != package["entrySha256"]:
                raise RuntimeError("Original published package entry changed")
        print("DATASET18_PAIR_POSTCHECK " + json.dumps({"routingAndHarnessBytesUnchanged": True}))
        return

    artifact.mkdir()
    for folder in [base, candidate]:
        if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=folder, text=True).strip() != frozen["harnessCommit"]:
            raise RuntimeError("Dataset18 source is not exact AR1107")
        if subprocess.check_output(["git", "status", "--porcelain"], cwd=folder):
            raise RuntimeError("Dataset18 source checkout is not pristine")
        if (folder / "node_modules").exists():
            raise RuntimeError("Refuse to replace existing source dependencies")
    package_bytes = (base / "package.json").read_bytes()
    if package_bytes != (candidate / "package.json").read_bytes():
        raise RuntimeError("The source harness manifests differ")
    package = json.loads(package_bytes)
    if frozen["datasetCommit"] not in package["devDependencies"]["dataset-srj18"]:
        raise RuntimeError("Dataset18 revision changed")
    install_config = artifact / "install.bunfig.toml"
    install_config.write_text("[install.lockfile]\nsave = true\n")
    # One evaluation/development graph only. The measured routing modules keep
    # the separate, unchanged published runtime dependency graph from bootstrap.
    subprocess.run(["bun", f"--config={install_config}", "install", "--save-text-lockfile", "--ignore-scripts", "--backend", "copy"], cwd=base, check=True)
    sharp = (base / "node_modules/sharp").resolve()
    if not sharp.is_relative_to(base / "node_modules"):
        raise RuntimeError("Sharp escaped the isolated evaluation graph")
    subprocess.run(["bun", "run", "install"], cwd=sharp, check=True)
    if (base / "package.json").read_bytes() != package_bytes:
        raise RuntimeError("Installation changed the evaluation manifest")
    graph = inventory(base / "node_modules")
    copy_graph(base / "node_modules", candidate / "node_modules")
    if inventory(candidate / "node_modules") != graph:
        raise RuntimeError("Evaluation dependency graph differs between lanes")
    shutil.copyfile(base / "bun.lock", candidate / "bun.lock")
    shutil.copyfile(base / "bun.lock", artifact / "bun.lock")
    with gzip.open(artifact / "harness-dependencies.json.gz", "wt") as stream:
        json.dump(graph, stream, sort_keys=True)
    subprocess.run(["bun", str(controller / "prepare-entries.mjs"), str(runtime), str(artifact / "routing-entries.json")], check=True)
    entries = json.loads((artifact / "routing-entries.json").read_text())
    imports = {
        "scripts/benchmark/benchmark-run-task.ts": [
            ('import * as autorouterModule from "../../lib"', 'import * as autorouterModule from "../../selected-autorouter.mjs"'),
            ('import { convertSrjToGraphicsObject } from "../../lib"', 'import { convertSrjToGraphicsObject } from "../../selected-autorouter.mjs"'),
        ],
        "scripts/benchmark/index.ts": [
            ('import { AUTOROUTER_VERSION } from "../../lib"', 'import { AUTOROUTER_VERSION } from "../../selected-autorouter.mjs"'),
        ],
    }
    lanes = {}
    for lane, folder in [("base", base), ("pr", candidate)]:
        changed = {}
        for name, replacements in imports.items():
            path = folder / name
            original = subprocess.check_output(["git", "show", f"HEAD:{name}"], cwd=folder).decode()
            if path.read_text() != original:
                raise RuntimeError("Source import preimage changed")
            modified = original
            for before, after in replacements:
                if modified.count(before) != 1:
                    raise RuntimeError(f"Expected one routing import: {name}")
                modified = modified.replace(before, after)
            path.write_text(modified)
            changed[name] = {"beforeSha256": hashlib.sha256(original.encode()).hexdigest(), "afterSha256": digest(path)}
        (folder / "selected-autorouter.mjs").write_text("export * from " + json.dumps(Path(entries[lane]["entry"]).as_uri()) + ";\n")
        (folder / "selected-entry.json").write_text(json.dumps(entries[lane]) + "\n")
        shutil.copyfile(controller / "probe-entry.mjs", folder / "probe-entry.mjs")
        identity = subprocess.check_output(["bun", "probe-entry.mjs"], cwd=folder, text=True)
        identity_lines = [line.removeprefix("DATASET18_ENTRY_IDENTITY ") for line in identity.splitlines() if line.startswith("DATASET18_ENTRY_IDENTITY ")]
        if len(identity_lines) != 1:
            raise RuntimeError("Missing exact entry/fixture identity")
        packet = json.loads(identity_lines[0])
        (artifact / f"{lane}-identity.json").write_text(json.dumps(packet, indent=2) + "\n")
        print("DATASET18_ENTRY_IDENTITY " + json.dumps({"lane": lane, **packet}))
        tracked_changes = set(subprocess.check_output(["git", "diff", "--name-only"], cwd=folder, text=True).splitlines()) - {"bun.lock"}
        if tracked_changes != set(imports):
            raise RuntimeError("A production source file or another harness file changed")
        untracked = set(subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard"], cwd=folder, text=True).splitlines())
        if untracked - {"bun.lock", "selected-autorouter.mjs", "selected-entry.json", "probe-entry.mjs"}:
            raise RuntimeError("Unexpected generated source file")
        files = set(subprocess.check_output(["git", "ls-files", "scripts/benchmark", "benchmark.sh", "bunfig.toml", "tsconfig.json", "lib/testing", "lib/utils", "lib/types", "lib/solvers/BaseSolver.ts", "lib/autorouter-pipelines/index.ts", "lib/index.ts"], cwd=folder, text=True).splitlines())
        files.update({"selected-autorouter.mjs", "selected-entry.json", "probe-entry.mjs"})
        lanes[lane] = {"commonImportChanges": changed, "identity": packet,
            "harnessFiles": {name: digest(folder / name) for name in sorted(files)}}
    if lanes["base"]["identity"]["fixtures"] != lanes["pr"]["identity"]["fixtures"]:
        raise RuntimeError("Dataset18 inputs differ")
    if lanes["base"]["commonImportChanges"] != lanes["pr"]["commonImportChanges"]:
        raise RuntimeError("The common routing-import adaptation differs")
    proof = {"experiment": frozen, "harnessCommit": frozen["harnessCommit"],
        "harnessPackageSha256": hashlib.sha256(package_bytes).hexdigest(),
        "harnessLockSha256": digest(artifact / "bun.lock"), "harnessGraphResolvedOnce": True,
        "harnessDependencyCount": len(graph), "routingEntries": entries,
        "routingDependencyInventory": inventory(Path(entries["sharedRoutingDependencies"])),
        "lanes": lanes, "freshSolvesPending": True, "officialSourceBuildPerformed": False}
    (artifact / "provenance.json").write_text(json.dumps(proof, indent=2) + "\n")
    print("DATASET18_PAIR_PREPARED " + json.dumps({"harnessCommit": frozen["harnessCommit"],
        "harnessLockSha256": proof["harnessLockSha256"], "datasetScenarios": 16,
        "publishedAR": entries["base"]["sha256"], "diagnosticAR": entries["pr"]["sha256"],
        "harnessGraphResolvedOnce": True, "routingExecuted": False}))


if __name__ == "__main__":
    main()
