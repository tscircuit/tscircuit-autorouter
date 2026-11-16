#!/usr/bin/env python3
"""Resolve once, build a matched AR pair, and audit every bundled source."""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def run(command: list[str], cwd: Path) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def inventory(folder: Path) -> dict:
    records = {}
    for current, directories, filenames in os.walk(folder, followlinks=False):
        for name in directories + filenames:
            path = Path(current) / name
            relative = str(path.relative_to(folder))
            if path.is_symlink():
                target = path.resolve()
                if not target.is_relative_to(folder):
                    raise RuntimeError(f"Dependency symlink escapes its isolated graph: {path}")
                records[relative] = {"symlink": str(target.relative_to(folder))}
            elif path.is_file():
                records[relative] = {"sha256": digest(path), "bytes": path.stat().st_size}
    return records


def copy_graph(source: Path, destination: Path) -> None:
    shutil.copytree(source, destination, symlinks=True, copy_function=os.link)
    for current, directories, filenames in os.walk(destination, followlinks=False):
        for name in directories + filenames:
            path = Path(current) / name
            if path.is_symlink() and os.path.isabs(os.readlink(path)):
                target = Path(os.readlink(path))
                if not target.is_relative_to(source):
                    raise RuntimeError("Absolute dependency alias escapes the frozen source graph")
                path.unlink()
                path.symlink_to(destination / target.relative_to(source))


def audit_maps(source: Path, maps: list[tuple[Path, Path]], upstream_proofs: dict) -> dict:
    bundled = {}
    upstream_sources = {}
    for path, original_map_path in maps:
        packet = json.loads(path.read_text())
        if len(packet["sources"]) != len(packet["sourcesContent"]):
            raise RuntimeError("Source map is missing source contents")
        for filename, content in zip(packet["sources"], packet["sourcesContent"]):
            if content is None:
                raise RuntimeError("Source map has an unavailable source")
            normalized = "/" + filename.replace("\\", "/")
            resolved = (original_map_path.parent / filename).resolve()
            if not resolved.is_relative_to(source):
                raise RuntimeError(f"Bundled source escaped its lane: {filename} from {original_map_path}")
            content_hash = hashlib.sha256(content.encode()).hexdigest()
            if resolved.is_file():
                if content_hash != digest(resolved):
                    raise RuntimeError(f"Bundled content differs from the actual source file: {resolved}")
            else:
                # Published dependencies can ship dist/maps without their
                # original TS. Require the exact content from a shipped map
                # in this lane's frozen dependency graph, never a guessed file.
                if not resolved.is_relative_to(source / "node_modules"):
                    raise RuntimeError(f"Missing bundled project source: {resolved}")
                package = next((parent for parent in resolved.parents if (parent / "package.json").is_file()), None)
                if package is None or not package.is_relative_to(source / "node_modules"):
                    raise RuntimeError(f"Missing upstream source-map package: {resolved}")
                if package not in upstream_sources:
                    originals = {}
                    for shipped_map in package.rglob("*.map"):
                        try:
                            upstream = json.loads(shipped_map.read_text())
                        except (ValueError, UnicodeError):
                            continue
                        for original_name, original_content in zip(upstream.get("sources", []), upstream.get("sourcesContent", [])):
                            if original_content is None:
                                continue
                            original_path = (shipped_map.parent / original_name).resolve()
                            original_hash = hashlib.sha256(original_content.encode()).hexdigest()
                            originals.setdefault((original_path, original_hash), []).append(str(shipped_map.relative_to(source)))
                    upstream_sources[package] = originals
                evidence = upstream_sources[package].get((resolved, content_hash))
                if not evidence:
                    raise RuntimeError(f"No shipped source-map evidence for original source: {resolved}")
                upstream_proofs[str(resolved.relative_to(source))] = {"sha256": content_hash, "shippedMaps": evidence}
            if "/node_modules/" in normalized:
                key = "node_modules/" + normalized.rsplit("/node_modules/", 1)[1]
            else:
                if resolved.is_relative_to(source):
                    key = str(resolved.relative_to(source))
                else:
                    raise RuntimeError("Unknown source-map boundary")
            bundled.setdefault(key, set()).add(hashlib.sha256(content.encode()).hexdigest())
    return {key: sorted(hashes) for key, hashes in sorted(bundled.items())}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    graph = parser.add_mutually_exclusive_group(required=True)
    graph.add_argument("--seed-artifact", type=Path)
    graph.add_argument("--reuse-artifact", type=Path)
    arguments = parser.parse_args()
    root = arguments.root.resolve()
    controller = Path(__file__).resolve().parent
    frozen = json.loads((controller / "experiment.json").read_text())
    if not frozen["frozen"] or not frozen["files"]:
        raise RuntimeError("Candidate source manifest is not frozen/reviewed")
    patch_target = frozen["patchTarget"]
    if patch_target not in ["autorouter", "tiny"]:
        raise RuntimeError("Select exactly one source patch target")
    if subprocess.check_output(["bun", "--version"], text=True).strip() != "1.4.3":
        raise RuntimeError("Bun1.4.3 is required for both builds")
    base, candidate = root / "same-machine-base", root / "same-machine-pr"
    artifact = root / ("dataset-source-proof" if arguments.reuse_artifact else "source-pair-artifact")
    artifact.mkdir()
    # AR intentionally disables lockfile saving. Override only dependency
    # installation; official builds and tests keep the repository's bunfig.
    install_config = artifact / "install.bunfig.toml"
    install_config.write_text("[install.lockfile]\nsave = true\n")
    install_command = ["bun", f"--config={install_config}", "install", "--save-text-lockfile"]
    for source in [base, candidate]:
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
        if revision != frozen["autorouterCommit"]:
            raise RuntimeError("Source AR revision does not match published1103")
    if (base / "package.json").read_bytes() != (candidate / "package.json").read_bytes():
        raise RuntimeError("AR source manifests differ")
    package = json.loads((base / "package.json").read_text())
    if frozen["tinyCommit"] not in package["devDependencies"]["tiny-hypergraph"]:
        raise RuntimeError("AR1103 no longer pins the expected Tiny base")
    if frozen["dataset18Commit"] not in package["devDependencies"]["dataset-srj18"]:
        raise RuntimeError("Dataset18 source changed")
    # Both modes restore the proven source-base graph. Seed mode builds a NEW
    # pair; Dataset18 reuse mode later restores that new pair's worker outputs.
    shared = (arguments.reuse_artifact or arguments.seed_artifact).resolve()
    if digest(shared / "bun.lock") != frozen["expectedLockSha256"]:
        raise RuntimeError("Source graph seed is not the proven0a388 lock")
    shutil.copyfile(shared / "bun.lock", base / "bun.lock")
    run([*install_command, "--frozen-lockfile", "--ignore-scripts", "--backend", "copy"], base)
    if digest(base / "bun.lock") != frozen["expectedLockSha256"]:
        raise RuntimeError("Frozen install changed the proven dependency lock")
    # The repository's test preload imports Sharp. Install its native image
    # library before inventory/copy so both lanes receive identical bytes.
    sharp = (base / "node_modules/sharp").resolve()
    if not sharp.is_relative_to(base / "node_modules"):
        raise RuntimeError("Sharp installer escaped the isolated source graph")
    run(["bun", "run", "install"], sharp)
    if (base / "package.json").read_bytes() != (candidate / "package.json").read_bytes():
        raise RuntimeError("Dependency setup changed the AR source manifest")
    shutil.copyfile(base / "bun.lock", artifact / "bun.lock")
    shutil.copyfile(base / "package.json", artifact / "package.json")
    graph_before = inventory(base / "node_modules")
    with gzip.open(shared / "dependency-inventory.json.gz", "rt") as stream:
        expected_graph = json.load(stream)["control"]
    if graph_before != expected_graph:
        raise RuntimeError("Restored dependency bytes differ from the proven source-base graph")
    copy_graph(base / "node_modules", candidate / "node_modules")
    shutil.copyfile(base / "bun.lock", candidate / "bun.lock")
    source_base = base if patch_target == "autorouter" else (base / "node_modules/tiny-hypergraph").resolve()
    source_candidate = candidate if patch_target == "autorouter" else (candidate / "node_modules/tiny-hypergraph").resolve()
    expected_differences = set()
    for patch in frozen["files"]:
        relative = Path(patch["path"])
        if not relative.parts or relative.is_absolute() or ".." in relative.parts:
            raise RuntimeError("Reviewed source patches must be relative paths")
        expected_root = "tests" if patch["role"] == "test" else "lib"
        if relative.parts[0] != expected_root or patch["bundled"] != (patch["role"] == "production"):
            raise RuntimeError("Source role/bundled flag does not match its lib/tests scope")
        if patch["role"] not in ["production", "test"] or (patch_target == "tiny" and patch["role"] != "production"):
            raise RuntimeError("Unsupported reviewed source role")
        original = source_base / relative
        revised = source_candidate / relative
        payload = controller / "candidate" / relative
        if patch["beforeSha256"] is None:
            if original.exists():
                raise RuntimeError("Expected new source file already exists")
        elif digest(original) != patch["beforeSha256"]:
            raise RuntimeError("Source preimage differs")
        if digest(payload) != patch["afterSha256"]:
            raise RuntimeError("Candidate source differs from review manifest")
        revised.parent.mkdir(parents=True, exist_ok=True)
        temporary = revised.with_name(revised.name + ".candidate")
        shutil.copyfile(payload, temporary)
        temporary.replace(revised)  # breaks hardlinks before any candidate edit
        if patch_target == "tiny":
            expected_differences.add(str(revised.relative_to(candidate / "node_modules")))
    graph_after = inventory(candidate / "node_modules")
    actual_differences = {key for key in graph_before.keys() | graph_after.keys() if graph_before.get(key) != graph_after.get(key)}
    if actual_differences != expected_differences:
        raise RuntimeError(f"Unreviewed dependency changes: {sorted(actual_differences ^ expected_differences)}")
    project_differences = set(subprocess.check_output(["git", "diff", "--name-only"], cwd=candidate, text=True).splitlines())
    project_differences.update(subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard"], cwd=candidate, text=True).splitlines())
    if digest(candidate / "bun.lock") != frozen["expectedLockSha256"]:
        raise RuntimeError("Candidate lock differs from the frozen shared dependency graph")
    project_differences.discard("bun.lock")
    expected_project_differences = {patch["path"] for patch in frozen["files"]} if patch_target == "autorouter" else set()
    if project_differences != expected_project_differences:
        raise RuntimeError(f"Unreviewed AR source-tree changes: {sorted(project_differences ^ expected_project_differences)}")
    with gzip.open(artifact / "dependency-inventory.json.gz", "wt") as stream:
        json.dump({"control": graph_before, "candidateChanges": {key: graph_after[key] for key in actual_differences}}, stream)
    if arguments.reuse_artifact:
        expected = json.loads((shared / "provenance.json").read_text())
        if digest(base / "bun.lock") != expected["lockSha256"]:
            raise RuntimeError("Dataset18 lock differs from the globally shared build")
        for label, source in [("base", base), ("pr", candidate)]:
            shutil.copytree(shared / "generated" / label, source / "lib/runtime/generated", dirs_exist_ok=True)
        (artifact / "provenance.json").write_text(json.dumps({
            "lockSha256": expected["lockSha256"], "graphResolvedAgain": False,
            "sourceGraphBytesMatchSetup": True, "candidateDifferences": sorted(actual_differences),
            "experiment": frozen, "patchTarget": patch_target,
            "candidateSourceFiles": frozen["files"],
            "projectSourceDifferences": sorted(project_differences),
        }, indent=2) + "\n")
        return
    map_sets = {}
    upstream_map_proofs = {}
    dist_hashes = {}
    for label, source in [("base", base), ("pr", candidate)]:
        run(["bun", "run", "build"], source)
        if label == "pr":
            run(["bun", "test", "--timeout", "9999999", *frozen["testFiles"]], source)
        if digest(source / "bun.lock") != digest(artifact / "bun.lock"):
            raise RuntimeError("Official build changed the shared frozen lock")
        worker_output = artifact / "worker-audit" / label
        run(["bun", str(controller / "audit-worker-maps.ts"), str(source), str(worker_output)], source)
        maps = [(path, path) for path in sorted((source / "dist").rglob("*.js.map"))]
        maps += [(Path(row["path"]), Path(row["originalMapPath"])) for row in json.loads((worker_output / "map-origins.json").read_text())]
        if len(maps) < 5:
            raise RuntimeError("Official main/runtime source maps are missing")
        upstream_map_proofs[label] = {}
        map_sets[label] = audit_maps(source, maps, upstream_map_proofs[label])
        package_output = artifact / "packages" / label
        package_output.mkdir(parents=True)
        shutil.copyfile(source / "package.json", package_output / "package.json")
        shutil.copytree(source / "dist", package_output / "dist")
        shutil.copytree(source / "lib/runtime/generated", artifact / "generated" / label)
        dist_hashes[label] = {str(path.relative_to(package_output)): digest(path) for path in package_output.rglob("*") if path.is_file()}
    source_prefix = "" if patch_target == "autorouter" else "node_modules/tiny-hypergraph/"
    bundled_files = [patch for patch in frozen["files"] if patch["bundled"]]
    allowed = {source_prefix + patch["path"] for patch in bundled_files}
    generated = {"lib/runtime/generated/bunWorkerSource.ts", "lib/runtime/generated/nodeWorkerSource.ts"}
    differences = {key for key in map_sets["base"].keys() | map_sets["pr"].keys() if map_sets["base"].get(key) != map_sets["pr"].get(key)}
    if differences - allowed - generated:
        raise RuntimeError(f"Unreviewed bundled source changes: {sorted(differences - allowed - generated)}")
    for patch in bundled_files:
        key = source_prefix + patch["path"]
        if patch["beforeSha256"] is not None and map_sets["base"].get(key) != [patch["beforeSha256"]]:
            raise RuntimeError(f"Control module differs from the pinned source: {key}")
        if map_sets["pr"].get(key) != [patch["afterSha256"]]:
            raise RuntimeError(f"Candidate module not proven in built sources: {key}")
    # Freeze the external production closure from the SAME lock; no range resolution.
    production = root / "production-closure"
    production.mkdir()
    shutil.copyfile(base / "package.json", production / "package.json")
    shutil.copyfile(base / "bun.lock", production / "bun.lock")
    run([*install_command, "--production", "--frozen-lockfile", "--ignore-scripts", "--backend", "copy"], production)
    if digest(production / "bun.lock") != digest(artifact / "bun.lock"):
        raise RuntimeError("Production closure changed the shared frozen lock")
    production_inventory = inventory(production / "node_modules")
    for current, directories, filenames in os.walk(production / "node_modules", followlinks=False):
        for name in directories + filenames:
            path = Path(current) / name
            if path.is_symlink() and os.path.isabs(os.readlink(path)):
                target = path.resolve()
                path.unlink()
                path.symlink_to(os.path.relpath(target, path.parent))
    shutil.move(str(production / "node_modules"), artifact / "runtime-node_modules")
    provenance = {
        "experiment": frozen, "bun": "1.4.3", "graphResolvedAgain": False,
        "patchTarget": patch_target, "candidateSourceFiles": frozen["files"],
        "projectSourceDifferences": sorted(project_differences),
        "sourceGraphSeed": {"run": 43840051309, "lockSha256": frozen["expectedLockSha256"]},
        "packageSha256": digest(base / "package.json"), "lockSha256": digest(artifact / "bun.lock"),
        "dependencyDifferences": sorted(actual_differences), "bundledSourceDifferences": sorted(differences),
        "bundledSources": map_sets, "distFiles": dist_hashes,
        "upstreamSourceMapEvidence": upstream_map_proofs,
        "productionDependencyInventory": production_inventory,
        "workerDiagnosticJsMatchesOfficial": True,
    }
    (artifact / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(json.dumps({"sourcePairPrepared": True, "artifact": str(artifact), "lockSha256": provenance["lockSha256"], "bundledSourceDifferences": sorted(differences)}))


if __name__ == "__main__":
    main()
