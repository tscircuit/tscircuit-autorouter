#!/usr/bin/env python3
"""Build only unchanged diagnostic helpers using the proven1117 source graph."""

import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory(folder: Path) -> dict:
    records = {}
    for current, directories, files in os.walk(folder, followlinks=False):
        for name in directories + files:
            path = Path(current) / name
            relative = str(path.relative_to(folder))
            if path.is_symlink():
                target = path.resolve()
                if not target.is_relative_to(folder):
                    raise RuntimeError(f"Dependency alias escapes graph: {relative}")
                records[relative] = {"symlink": str(target.relative_to(folder))}
            elif path.is_file():
                records[relative] = {"sha256": digest(path)}
    return records


def source_bodies(map_path: Path, root: Path) -> dict:
    packet = json.loads(map_path.read_text())
    if len(packet["sources"]) != len(packet["sourcesContent"]):
        raise RuntimeError("Incomplete source map")
    records = {}
    for name, content in zip(packet["sources"], packet["sourcesContent"]):
        path = Path(os.path.abspath(map_path.parent / name))
        if not isinstance(content, str) or not path.is_relative_to(root):
            raise RuntimeError(f"Unavailable or escaped mapped source: {name}")
        key = str(path.relative_to(root))
        checksum = hashlib.sha256(content.encode()).hexdigest()
        if key in records and records[key] != checksum:
            raise RuntimeError(f"Ambiguous mapped source: {key}")
        records[key] = checksum
    return records


def main() -> None:
    root, source = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    controller = Path(__file__).resolve().parent
    plan = json.loads((controller / "manifest.json").read_text())
    if subprocess.check_output(["bun", "--version"], text=True).strip() != "1.4.3":
        raise RuntimeError("Require Bun1.4.3")
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip() != plan["autorouterCommit"]:
        raise RuntimeError("Wrong immutable autorouter checkout")
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=source, text=True).strip():
        raise RuntimeError("Helper source checkout must start clean")
    output = root / "h616-source-helpers"
    output.mkdir()
    artifact = plan["sourceArtifact"]
    api = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{artifact['id']}"
    actual = json.loads(subprocess.check_output(["gh", "api", api]))
    for field in ["id", "name", "size_in_bytes", "digest", "workflow_run"]:
        if actual[field] != artifact[field]:
            raise RuntimeError(f"Qualified source artifact changed: {field}")
    archive = subprocess.check_output(["gh", "api", api + "/zip"])
    if len(archive) != artifact["size_in_bytes"] or "sha256:" + hashlib.sha256(archive).hexdigest() != artifact["digest"]:
        raise RuntimeError("Source archive failed authentication")
    with zipfile.ZipFile(io.BytesIO(archive)) as packet:
        prefix = ".full-board-run/"
        lock_bytes = packet.read(prefix + "source-pair/bun.lock")
        graph_bytes = packet.read(prefix + "source-pair/dependency-inventory.json.gz")
        prior = json.loads(packet.read(prefix + "source-pair/provenance.json"))
        closure = json.loads(packet.read(prefix + "source-pair/published-closure-audit.json"))
        prior_runtime = json.loads(packet.read(prefix + "runtime-manifest.json"))
    if not prior["passed"] or not prior["sourceGraphMatchesSeedBytes"] or not closure["passed"] or closure["differences"]:
        raise RuntimeError("Source graph lacks exact published1117 qualification")
    if hashlib.sha256(lock_bytes).hexdigest() != plan["lockSha256"] or hashlib.sha256(graph_bytes).hexdigest() != plan["inventorySha256"]:
        raise RuntimeError("Qualified source lock/inventory changed")
    runtime = json.loads((root / "runtime-manifest.json").read_text())
    for field in ["runtimeDependencyFiles", "autorouterDependencyFiles", "additionalChangedPackages"]:
        if runtime[field] != prior_runtime[field]:
            raise RuntimeError(f"Published external runtime changed: {field}")
    identities = lambda value: {row["name"]: (row["version"], row["entrySha256"]) for row in value["packages"]}
    if identities(runtime) != identities(prior_runtime) or runtime["sourceOverrides"] or runtime["dependencyOverrides"]:
        raise RuntimeError("Expected unchanged published four-package runtime")
    published = root / "npm/autorouter"
    published_map = published / "dist/index.js.map"
    if digest(published_map) != plan["publishedSourceMapSha256"]:
        raise RuntimeError("Wrong published source map")
    published_bodies = source_bodies(published_map, published)
    package_sha = digest(source / "package.json")
    if package_sha != published_bodies["package.json"]:
        raise RuntimeError("NPM source manifest differs from published map")
    (source / "bun.lock").write_bytes(lock_bytes)
    install_config = output / "install.bunfig.toml"
    install_config.write_text("[install.lockfile]\nsave = true\n")
    subprocess.run(["bun", f"--config={install_config}", "install", "--frozen-lockfile", "--ignore-scripts", "--backend", "copy"], cwd=source, check=True)
    expected_graph = json.loads(gzip.decompress(graph_bytes))
    if inventory(source / "node_modules") != expected_graph or digest(source / "bun.lock") != plan["lockSha256"] or digest(source / "package.json") != package_sha:
        raise RuntimeError("Source graph restore differs from authenticated qualification")
    entry = controller / "entry.ts"
    if digest(entry) != plan["barrelSha256"]:
        raise RuntimeError("Diagnostic export barrel changed")
    entry_target = source / "h616-diagnostic-helpers.ts"
    if entry_target.exists():
        raise RuntimeError("Refuse to replace an existing source file")
    shutil.copyfile(entry, entry_target)
    subprocess.run(["bun", str(controller / "build.mjs"), str(source), str(output)], cwd=source, check=True)
    bodies = source_bodies(output / "index.js.map", source)
    differences = {name: checksum for name, checksum in bodies.items() if checksum != (plan["barrelSha256"] if name == entry_target.name else published_bodies.get(name))}
    for name, checksum in plan["helperSourceBodies"].items():
        if bodies.get(name) != checksum:
            differences[name] = bodies.get(name)
    (output / "source-body-audit.json").write_text(json.dumps({"passed": not differences, "sourceCount": len(bodies), "sources": bodies, "differences": differences}, indent=2) + "\n")
    if differences or inventory(source / "node_modules") != expected_graph:
        raise RuntimeError("Helper build changed a source body or dependency input")
    # One helper export shares a module with a registered repair solver. Give
    # unused helper-side registrations a separate, byte-identical registry;
    # actual published solver constructors keep their original runtime graph.
    external = root / "autorouter-dependencies/node_modules"
    private_modules = output / "node_modules"
    private_modules.mkdir()
    for child in external.iterdir():
        if child.name == ".bin":
            continue
        if child.name == "@tscircuit":
            scope = private_modules / child.name
            scope.mkdir()
            for package in child.iterdir():
                if package.name != "solver-utils":
                    (scope / package.name).symlink_to(package.resolve())
        else:
            (private_modules / child.name).symlink_to(child.resolve())
    original_utils = (external / "@tscircuit/solver-utils").resolve()
    private_utils = private_modules / "@tscircuit/solver-utils"
    original_files = inventory(original_utils)
    if any("symlink" in value for value in original_files.values()):
        raise RuntimeError("Unexpected aliases inside frozen solver-utils package")
    shutil.copytree(original_utils, private_utils, copy_function=os.link)
    if inventory(private_utils) != original_files:
        raise RuntimeError("Private helper registry package differs from published bytes")
    metadata = json.loads((original_utils / "package.json").read_text())
    if metadata["version"] != "0.0.23" or metadata["exports"]["."] != "./dist/index.js":
        raise RuntimeError("Unexpected frozen registry package")
    original_entry = original_utils / "dist/index.js"
    private_entry = private_utils / "dist/index.js"
    proof = {
        "qualified": True, "sourceArtifact": actual, "autorouterCommit": plan["autorouterCommit"],
        "lockSha256": plan["lockSha256"], "sourceGraphIdentical": True,
        "publishedSourceMapSha256": plan["publishedSourceMapSha256"], "helperSourcesIdentical": True,
        "barrelSha256": plan["barrelSha256"], "exports": plan["exports"],
        "helperEntry": str(output / "index.js"), "helperEntrySha256": digest(output / "index.js"),
        "helperMapSha256": digest(output / "index.js.map"),
        "helperSolverUtilsEntry": str(private_entry), "publishedSolverUtilsEntry": str(original_entry),
        "solverUtilsEntrySha256": digest(original_entry), "privateSolverUtilsFiles": original_files,
        "runtimeContract": "Assert helper and published SolverRuntime identities differ; import helpers before published AR; route only with published direct constructors; original regional control must match params and5482iterations.",
    }
    (output / "helper-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
    print(json.dumps({"preparedHelperEntry": proof["helperEntry"], "sourceBodies": len(bodies), "sourceGraphIdentical": True, "privateRegistryPackageBytesIdentical": True}))


if __name__ == "__main__":
    main()
