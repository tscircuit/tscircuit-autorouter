#!/usr/bin/env python3
"""Build a source pair and reject any unreviewed bundled source difference."""

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command: list[str], cwd: Path) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def inventory(folder: Path) -> dict:
    records = {}
    for current, directories, files in os.walk(folder, followlinks=False):
        for name in directories + files:
            path = Path(current) / name
            relative = str(path.relative_to(folder))
            if path.is_symlink():
                target = path.resolve()
                if not target.is_relative_to(folder):
                    raise RuntimeError(f"Dependency alias escapes the source graph: {relative}")
                records[relative] = {"symlink": str(target.relative_to(folder))}
            elif path.is_file():
                records[relative] = {"sha256": digest(path)}
    return records


def source_bodies(map_path: Path, source_root: Path) -> dict:
    packet = json.loads(map_path.read_text())
    if len(packet["sources"]) != len(packet["sourcesContent"]):
        raise RuntimeError("Incomplete source map")
    bodies = {}
    for name, content in zip(packet["sources"], packet["sourcesContent"]):
        if not isinstance(content, str):
            raise RuntimeError(f"Missing source body: {name}")
        # Keep every nested package path. Collapsing node_modules would hide
        # different dependency versions used by separate solvers.
        path = Path(os.path.abspath(map_path.parent / name))
        if not path.is_relative_to(source_root):
            raise RuntimeError(f"Mapped source escapes the source checkout: {name}")
        key = str(path.relative_to(source_root))
        checksum = hashlib.sha256(content.encode()).hexdigest()
        if key in bodies and bodies[key] != checksum:
            raise RuntimeError(f"Ambiguous source map identity: {key}")
        bodies[key] = checksum
    return bodies


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--tiny-current", type=Path, required=True)
    args = parser.parse_args()
    root, source, current = args.root.resolve(), args.source.resolve(), args.tiny_current.resolve()
    controller = Path(__file__).resolve().parent
    plan = json.loads((controller / "tiny-source-plan.json").read_text())
    if not plan["frozen"]:
        raise RuntimeError("Source candidate has not been frozen for review")
    if subprocess.check_output(["bun", "--version"], text=True).strip() != "1.4.3":
        raise RuntimeError("Require Bun1.4.3")
    for checkout, expected in [(source, plan["autorouterCommit"]), (current, plan["tinyCurrentCommit"])]:
        if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip() != expected:
            raise RuntimeError("Wrong immutable source checkout")
        if subprocess.check_output(["git", "status", "--porcelain"], cwd=checkout, text=True).strip():
            raise RuntimeError("Source qualification requires clean checkouts")
    if subprocess.check_output(["git", "rev-parse", "HEAD:lib"], cwd=current, text=True).strip() != plan["tinyLibTree"]:
        raise RuntimeError("Current Tiny lib tree changed")
    proof = root / "source-pair"
    proof.mkdir()
    package_bytes = (source / "package.json").read_bytes()
    package = json.loads(package_bytes)
    published = root / "npm/autorouter"
    published_map = published / "dist/index.js.map"
    published_bodies = source_bodies(published_map, published)
    if digest(published_map) != plan["publishedSourceMapSha256"]:
        raise RuntimeError("Wrong published source-map bytes")
    if digest(source / "package.json") != published_bodies["package.json"]:
        raise RuntimeError("NPM gitHead manifest differs from the published source map")
    for name, pin in plan["requiredSourcePins"].items():
        if package["devDependencies"][name] != pin:
            raise RuntimeError(f"Unexpected source dependency pin: {name}")
    install_config = proof / "install.bunfig.toml"
    install_config.write_text("[install.lockfile]\nsave = true\n")
    seed = plan["sourceGraphSeed"]
    artifact = seed["artifact"]
    api = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{artifact['id']}"
    actual = json.loads(subprocess.check_output(["gh", "api", api]))
    for field in ["id", "name", "size_in_bytes", "digest", "workflow_run"]:
        if actual[field] != artifact[field]:
            raise RuntimeError(f"Source graph artifact changed: {field}")
    archive = subprocess.check_output(["gh", "api", api + "/zip"])
    if len(archive) != artifact["size_in_bytes"] or "sha256:" + hashlib.sha256(archive).hexdigest() != artifact["digest"]:
        raise RuntimeError("Source graph archive failed authentication")
    with zipfile.ZipFile(io.BytesIO(archive)) as packet:
        lock_bytes = packet.read(".full-board-run/source-pair/bun.lock")
        inventory_bytes = packet.read(".full-board-run/source-pair/dependency-inventory.json.gz")
    if hashlib.sha256(lock_bytes).hexdigest() != seed["lockSha256"] or hashlib.sha256(inventory_bytes).hexdigest() != seed["inventorySha256"]:
        raise RuntimeError("Source graph seed bytes changed")
    lock = source / "bun.lock"
    lock.write_bytes(lock_bytes)
    lock_sha = seed["lockSha256"]
    run(["bun", f"--config={install_config}", "install", "--frozen-lockfile", "--ignore-scripts", "--backend", "copy"], source)
    if digest(lock) != lock_sha or (source / "package.json").read_bytes() != package_bytes:
        raise RuntimeError("Dependency resolution changed the frozen source manifest or lock")
    shutil.copyfile(lock, proof / "bun.lock")
    (proof / "source-graph-seed-proof.json").write_text(json.dumps({"artifact": actual, "lockSha256": lock_sha, "inventorySha256": seed["inventorySha256"], "archiveAuthenticated": True}, indent=2) + "\n")
    tiny = (source / "node_modules/tiny-hypergraph").resolve()
    if not tiny.is_relative_to(source / "node_modules"):
        raise RuntimeError("Tiny alias escapes the isolated source graph")
    installed_lib = {str(path.relative_to(tiny)): digest(path) for path in (tiny / "lib").rglob("*") if path.is_file()}
    current_lib = {str(path.relative_to(current)): digest(path) for path in (current / "lib").rglob("*") if path.is_file()}
    if installed_lib != current_lib:
        raise RuntimeError("Pinned installed Tiny lib differs from reviewed current-main lib")
    for relative, expected in plan["productionFiles"].items():
        if digest(tiny / relative) != expected["beforeSha256"]:
            raise RuntimeError(f"Candidate source preimage changed: {relative}")
    tiny_package = (tiny / "package.json").read_bytes()
    graph_before = inventory(source / "node_modules")
    if graph_before != json.loads(gzip.decompress(inventory_bytes)):
        raise RuntimeError("Restored dependency graph bytes differ from the authenticated first attempt")
    with gzip.open(proof / "dependency-inventory.json.gz", "wt") as stream:
        json.dump(graph_before, stream, sort_keys=True)
    run(["bun", str(controller / "build-tiny-source-entry.mjs"), str(source), str(proof / "base")], source)
    base_bodies = source_bodies(proof / "base/index.js.map", source)
    differences = {key: {"published": published_bodies.get(key), "source": base_bodies.get(key)} for key in published_bodies.keys() | base_bodies.keys() if published_bodies.get(key) != base_bodies.get(key)}
    (proof / "published-closure-audit.json").write_text(json.dumps({"passed": not differences, "publishedSourceCount": len(published_bodies), "sourceCount": len(base_bodies), "differences": differences}, indent=2) + "\n")
    if differences:
        raise RuntimeError("Source-control closure differs from published1117; inspect audit before any routing")
    patch = controller / "tiny-production.patch"
    if digest(patch) != plan["productionPatchSha256"]:
        raise RuntimeError("Reviewed production patch changed")
    # The package manifest and exports remain those installed from AR's pin.
    # Only the six reviewed lib files are replaced; current-main metadata is
    # inspected above but never copied into the build graph.
    run(["patch", "--batch", "--forward", "-p1", "-i", str(patch)], tiny)
    for relative, expected in plan["productionFiles"].items():
        if digest(tiny / relative) != expected["afterSha256"]:
            raise RuntimeError(f"Candidate source does not match review: {relative}")
    graph_after = inventory(source / "node_modules")
    actual_changes = {key for key in graph_before.keys() | graph_after.keys() if graph_before.get(key) != graph_after.get(key)}
    expected_changes = {str((tiny / relative).relative_to(source / "node_modules")) for relative in plan["productionFiles"]}
    if actual_changes != expected_changes or (tiny / "package.json").read_bytes() != tiny_package:
        raise RuntimeError("Unexpected dependency graph or Tiny package/export change")
    run(["bun", str(controller / "build-tiny-source-entry.mjs"), str(source), str(proof / "candidate")], source)
    candidate_bodies = source_bodies(proof / "candidate/index.js.map", source)
    body_changes = {key for key in base_bodies.keys() | candidate_bodies.keys() if base_bodies.get(key) != candidate_bodies.get(key)}
    expected_bundled = {"node_modules/tiny-hypergraph/" + relative for relative in plan["productionFiles"] if "node_modules/tiny-hypergraph/" + relative in base_bodies}
    if body_changes != expected_bundled:
        raise RuntimeError(f"Candidate bundled source scope changed: {sorted(body_changes ^ expected_bundled)}")
    if digest(lock) != lock_sha or (source / "package.json").read_bytes() != package_bytes:
        raise RuntimeError("Build changed the shared lock or source manifest")
    records = {
        "passed": True, "autorouterCommit": plan["autorouterCommit"], "tinyPin": plan["tinyPin"],
        "tinyCurrentCommit": plan["tinyCurrentCommit"], "tinyLibTree": plan["tinyLibTree"],
        "lockSha256": lock_sha, "sourceManifestSha256": hashlib.sha256(package_bytes).hexdigest(),
        "sourceGraphSeedArtifact": artifact["id"], "sourceGraphMatchesSeedBytes": True,
        "tinyPackageSha256": hashlib.sha256(tiny_package).hexdigest(), "tinyPackage": json.loads(tiny_package),
        "currentTinyMetadataUsed": False, "publishedSourceCount": len(published_bodies),
        "nonTinySourceBodiesIdentical": True, "changedBundledSources": sorted(body_changes),
        "changedDependencyFiles": sorted(actual_changes), "productionPatchSha256": digest(patch),
        "entries": {lane: {"path": str(proof / lane / "index.js"), "sha256": digest(proof / lane / "index.js")} for lane in ["base", "candidate"]},
    }
    (proof / "provenance.json").write_text(json.dumps(records, indent=2) + "\n")
    print(json.dumps({"sourcePairQualified": True, "sourceCount": len(published_bodies), "changedBundledSources": sorted(body_changes)}))


if __name__ == "__main__":
    main()
