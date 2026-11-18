"""Select one authenticated source build inside the frozen benchmark runtime."""

import argparse
import copy
import hashlib
import json
from pathlib import Path
import tarfile


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--variant", required=True, choices=["base", "candidate"])
    arguments = parser.parse_args()
    root = arguments.root.resolve()
    controller = Path(__file__).resolve().parent
    assets = controller / "source-builds"
    provenance_path = assets / "bundle-manifest.json"
    if not provenance_path.is_file():
        raise RuntimeError("Reviewed source build bundles and provenance are not ready")
    provenance = json.loads(provenance_path.read_text())
    if provenance["schemaVersion"] != 1:
        raise RuntimeError("Unexpected source bundle manifest schema")
    snapshot = provenance["dependencySnapshotSha256"]
    if len(snapshot) != 64 or not all(character in "0123456789abcdef" for character in snapshot):
        raise RuntimeError("Source builds require one authenticated dependency snapshot")
    for record in provenance["dependencyProvenanceFiles"]:
        relative = Path(record["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise RuntimeError("Dependency provenance must be relative to source-builds")
        path = assets / relative
        if path.stat().st_size != record["bytes"] or digest(path) != record["sha256"]:
            raise RuntimeError(f"Dependency build provenance changed: {relative}")
    snapshot_record = next(record for record in provenance["dependencyProvenanceFiles"] if record["path"] == "provenance/dependency-snapshot.json")
    if snapshot_record["sha256"] != snapshot:
        raise RuntimeError("Shared dependency snapshot identity differs from its authenticated provenance")

    published_path = root / "runtime-manifest.json"
    published = json.loads(published_path.read_text())
    if published["sourceOverrides"] or published["dependencyOverrides"]:
        raise RuntimeError("Source activation must start from the unchanged published runtime manifest")
    package_name = "@tscircuit/capacity-autorouter"
    published_package = next(package for package in published["packages"] if package["name"] == package_name)
    if published["mainVersion"] != "0.0.3234" or published_package["version"] != "0.0.1127":
        raise RuntimeError("Source experiment requires the frozen3234/1127 package chain")
    if provenance["publishedSourceCommit"] != published_package["gitHead"]:
        raise RuntimeError("Source build provenance does not name the frozen published autorouter commit")
    if provenance["builds"]["base"]["sourceTree"] != "6aa92656c137019fff88e23c2bf872aff7face3c":
        raise RuntimeError("Source control tree differs from published autorouter1127")

    build = provenance["builds"][arguments.variant]
    if build["buildExitCode"] != 0 or len(build["sourceCommit"]) != 40:
        raise RuntimeError("Source build must have a successful build and immutable commit")
    if build["packageName"] != package_name or build["packageVersion"] != published_package["version"]:
        raise RuntimeError("Source package identity differs from the frozen autorouter")
    archive = assets / f"{arguments.variant}.tgz"
    if Path(build["archivePath"]).name != archive.name:
        raise RuntimeError("Source bundle archive name differs from the reviewed manifest")
    if archive.stat().st_size != build["archiveBytes"] or digest(archive) != build["archiveSha256"]:
        raise RuntimeError("Source build archive identity changed")
    expected_files = {record["path"]: record for record in build["files"]}
    if len(expected_files) != len(build["files"]) or "package.json" not in expected_files or "dist/index.js" not in expected_files:
        raise RuntimeError("Source build file manifest is incomplete or contains duplicates")
    destination = root / "source-autorouter" / arguments.variant
    if destination.exists():
        raise RuntimeError("Refuse to overwrite an existing selected source build")
    destination.mkdir(parents=True)
    extracted = set()
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle:
            if member.isdir():
                continue
            if not member.isfile():
                raise RuntimeError("Source build archive must contain ordinary files only")
            relative = Path(member.name).relative_to("package")
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError("Unsafe source build archive member")
            name = str(relative)
            if name not in expected_files or name in extracted:
                raise RuntimeError(f"Unexpected or duplicate source build file: {name}")
            data = bundle.extractfile(member).read()
            expected = expected_files[name]
            if len(data) != expected["bytes"] or hashlib.sha256(data).hexdigest() != expected["sha256"]:
                raise RuntimeError(f"Source build member identity changed: {name}")
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            extracted.add(name)
    if extracted != set(expected_files):
        raise RuntimeError("Source build archive omitted declared files")
    metadata = json.loads((destination / "package.json").read_text())
    original_metadata = json.loads((root / "npm/autorouter/package.json").read_text())
    for field in ["name", "version", "main", "exports", "dependencies"]:
        if metadata[field] != original_metadata[field]:
            raise RuntimeError(f"Source build changed the runtime package contract: {field}")
    (destination / "node_modules").symlink_to(root / "autorouter-dependencies/node_modules")

    alias = root / "runtime/node_modules" / package_name
    allowed_targets = {root / "npm/autorouter", root / "source-autorouter/base", root / "source-autorouter/candidate"}
    if not alias.is_symlink() or alias.resolve() not in allowed_targets:
        raise RuntimeError("Refuse to replace an unexpected runtime package alias")
    previous_target = str(alias.resolve())
    alias.unlink()
    alias.symlink_to(destination)

    variant = f"source-{arguments.variant}"
    manifest = copy.deepcopy(published)
    manifest["experiment"] = variant
    manifest["sourceOverrides"] = True
    manifest["publishedPackages"] = copy.deepcopy(published["packages"])
    override = {
        "name": package_name,
        "kind": "verified-source-build",
        "variant": variant,
        "sourceCommit": build["sourceCommit"],
        "sourceTree": build["sourceTree"],
        "baseSourceCommit": provenance["builds"]["base"]["sourceCommit"],
        "baseSourceTree": provenance["builds"]["base"]["sourceTree"],
        "publishedGitHead": published_package["gitHead"],
        "dependencySnapshotSha256": snapshot,
        "bundleManifestSha256": digest(provenance_path),
        "archiveSha256": build["archiveSha256"],
        "archiveBytes": build["archiveBytes"],
        "files": build["files"],
        "buildCommand": build["buildCommand"],
    }
    manifest["routingSourceOverride"] = override
    selected_package = {
        "label": "autorouter", "name": package_name, "version": metadata["version"],
        "gitHead": build["sourceCommit"], "entryRelative": "dist/index.js",
        "entry": str(destination / "dist/index.js"),
        "entrySha256": expected_files["dist/index.js"]["sha256"],
        "artifactKind": "source-build", "sourceBuild": override,
    }
    manifest["packages"] = [selected_package if package["name"] == package_name else package for package in manifest["packages"]]
    manifest["packageAliases"] = [record for record in manifest["packageAliases"] if record["alias"] != str(alias)]
    manifest["packageAliases"].append({"alias": str(alias), "target": str(destination), "previousVerifiedTarget": previous_target})
    output = root / "runtime-manifests" / f"{variant}.json"
    output.parent.mkdir(exist_ok=True)
    if output.exists():
        raise RuntimeError("Refuse to overwrite an immutable source runtime manifest")
    output.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"variant": variant, "sourceCommit": build["sourceCommit"], "entrySha256": selected_package["entrySha256"], "dependencySnapshotSha256": snapshot, "runtimeManifest": str(output)}))


if __name__ == "__main__":
    main()
