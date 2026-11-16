#!/usr/bin/env python3
"""Give one source-built AR its own unchanged Main/Core runtime parents."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace_alias(alias: Path, target: Path) -> None:
    if not alias.is_symlink():
        raise RuntimeError(f"Expected a private benchmark alias: {alias}")
    alias.unlink()
    alias.symlink_to(target)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--published", required=True, type=Path)
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--variant", choices=["base", "pr"], required=True)
    arguments = parser.parse_args()
    published, artifact = arguments.published.resolve(), arguments.artifact.resolve()
    controller = Path(__file__).resolve().parent.parent / "full-board-ten"
    provenance = json.loads((artifact / "provenance.json").read_text())
    specification = importlib.util.spec_from_file_location("matched_source_pair", Path(__file__).parent / "prepare-source-pair.py")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    if module.inventory(artifact / "runtime-node_modules") != provenance["productionDependencyInventory"]:
        raise RuntimeError("Downloaded external production dependencies changed")
    manifest = json.loads((published / "runtime-manifest.json").read_text())
    output = published.parent / ("source-" + arguments.variant)
    output.mkdir()
    farm = output / "runtime/node_modules"
    farm.mkdir(parents=True)
    for alias in (published / "runtime/node_modules").iterdir():
        if alias.name.startswith("."):
            continue
        if alias.name.startswith("@"):
            namespace = farm / alias.name
            namespace.mkdir()
            for package in alias.iterdir():
                (namespace / package.name).symlink_to(package)
        else:
            (farm / alias.name).symlink_to(alias)
    release = json.loads((controller / "release.json").read_text())
    extra_packages = {record["name"]: record for record in release["additionalChangedPackages"]}
    records = list(manifest["packages"])
    for record in manifest["additionalChangedPackages"]:
        expected = extra_packages[record["name"]]
        if any(record[key] != expected[key] for key in ["name", "version", "entrySha256"]):
            raise RuntimeError("Extra published dependency differs from the frozen release")
        records.append(expected)
    for record in records:
        package = output / "npm" / record["label"]
        if record["label"] == "autorouter":
            source = artifact / "packages" / arguments.variant
        elif record["name"] in extra_packages:
            source = published / "runtime/node_modules" / record["name"]
        else:
            source = published / "npm" / record["label"]
        shutil.copytree(source, package, copy_function=os.link, symlinks=True,
                        ignore=shutil.ignore_patterns("node_modules"))
        if (package / "node_modules").exists():
            raise RuntimeError("Copied package retained a stale dependency scope")
        replace_alias(farm / record["name"], package)
        if record["label"] != "autorouter" and digest(package / record["entryRelative"]) != record["entrySha256"]:
            raise RuntimeError("A published Main/Core/helper dependency changed")
    (output / "npm/node_modules").symlink_to(farm)
    (output / "npm/autorouter/node_modules").symlink_to(artifact / "runtime-node_modules")
    for relative, expected in provenance["distFiles"][arguments.variant].items():
        if digest(output / "npm/autorouter" / relative) != expected:
            raise RuntimeError("Source package artifact differs from the official build")
    override = {
        "name": "@tscircuit/capacity-autorouter", "from": "published0.0.1103",
        "to": "matched-source-" + arguments.variant,
        "reason": "Frozen AR1103 source graph; only the reviewed high-density completion fix differs between source lanes",
    }
    for record in manifest["packages"]:
        record["entry"] = str(output / "npm" / record["label"] / record["entryRelative"])
        if record["label"] == "autorouter":
            record["entrySha256"] = digest(Path(record["entry"]))
            record["sourceBuild"] = True
            record["sourceCommit"] = provenance["experiment"]["autorouterCommit"]
            record["sourceGraphLockSha256"] = provenance["lockSha256"]
    manifest.update(
        experiment="hd-completion-source-" + arguments.variant,
        dependencyOverrides=[override], routingSourceOverrides=True,
        sourceOverrides=True, publishedMainAndCoreUnchanged=True,
        sourceBuildProvenance=str(artifact / "provenance.json"),
    )
    (output / "runtime-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    # Each lane is a fresh process; update only owned benchmark import aliases.
    for path in [controller, published / "sources/original", published / "sources/spaced"]:
        replace_alias(path / "node_modules", farm)
    print(json.dumps({"activated": manifest["experiment"], "runtimeManifest": str(output / "runtime-manifest.json")}))


if __name__ == "__main__":
    main()
