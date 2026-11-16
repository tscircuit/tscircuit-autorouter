#!/usr/bin/env python3
"""Prepare only this benchmark's isolated, verified published runtime."""

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import urllib.request


def sha256(path: Path) -> str:
    checksum = hashlib.sha256()
    block_size = 1024 * 1024
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(block_size), b""):
            checksum.update(block)
    return checksum.hexdigest()


def install_dependencies(seed: Path, destination: Path, bun: str) -> dict:
    destination.mkdir()
    for filename in ["package.json", "bun.lock"]:
        shutil.copyfile(seed / filename, destination / filename)
    expected_lock = sha256(destination / "bun.lock")
    subprocess.run(
        [bun, "install", "--frozen-lockfile", "--ignore-scripts", "--backend", "hardlink"],
        cwd=destination,
        check=True,
    )
    if sha256(destination / "bun.lock") != expected_lock:
        raise RuntimeError("Frozen dependency lock changed")
    return {"packageSha256": sha256(destination / "package.json"), "lockSha256": expected_lock}


def extract_package(package: dict, destination: Path) -> dict:
    with urllib.request.urlopen(package["tarball"], timeout=180) as response:
        archive_bytes = response.read()
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(archive_bytes).digest()).decode()
    if integrity != package["integrity"]:
        raise RuntimeError(f"Tarball integrity mismatch: {package['name']}")
    destination.mkdir()
    files = []
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r|gz") as archive:
        for member in archive:
            if member.isdir():
                continue
            if not member.isfile():
                raise RuntimeError(f"Unexpected npm archive member: {member.name}")
            relative = Path(member.name).relative_to("package")
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError("Unsafe npm archive path")
            content = archive.extractfile(member).read()
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            files.append({"path": str(relative), "bytes": len(content), "sha256": sha256(target)})
    metadata = json.loads((destination / "package.json").read_text())
    if metadata["name"] != package["name"] or metadata["version"] != package["version"]:
        raise RuntimeError("Extracted package identity differs from frozen release")
    entry = destination / package["entryRelative"]
    if sha256(entry) != package["entrySha256"]:
        raise RuntimeError("Published package entry differs from frozen release")
    return {**package, "entry": str(entry), "publishedFiles": files}


def link_package(alias: Path, target: Path, expected_name: str) -> dict:
    alias.parent.mkdir(parents=True, exist_ok=True)
    replaced = None
    if alias.is_symlink():
        replaced = {"kind": "symlink", "target": str(alias.resolve())}
        alias.unlink()
    elif alias.exists():
        metadata = json.loads((alias / "package.json").read_text())
        if metadata["name"] != expected_name:
            raise RuntimeError("Refuse to replace an unrelated benchmark dependency")
        replaced = {"name": metadata["name"], "version": metadata["version"]}
        shutil.rmtree(alias)
    alias.symlink_to(target)
    return {"alias": str(alias), "target": str(target), "replacedAutoInstalled": replaced}


def verify_sources(root: Path, provenance: dict) -> list:
    verified = []
    for cohort, source in provenance.items():
        checkout = root / "sources" / cohort
        head = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
        if head != source["commit"]:
            raise RuntimeError(f"Wrong public source commit: {cohort}")
        for item in source["files"]:
            path = checkout / item["path"]
            if sha256(path) != item["sha256"]:
                raise RuntimeError(f"Public source changed: {cohort}/{item['path']}")
        verified.append({"cohort": cohort, "repository": source["repository"], "commit": head, "verifiedFiles": len(source["files"])})
    return verified


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--bun", default="bun")
    arguments = parser.parse_args()
    root = arguments.root.resolve()
    controller = Path(__file__).resolve().parent
    if subprocess.check_output([arguments.bun, "--version"], text=True).strip() != "1.4.3":
        raise RuntimeError("This benchmark requires Bun1.4.3")
    release = json.loads((controller / "release.json").read_text())
    experiment = os.environ.get("FULL_BOARD_EXPERIMENT", "published")
    dependency_overrides = release.get("dependencyOverrides", [])
    if experiment == "published" and dependency_overrides:
        raise RuntimeError("The published control cannot override dependencies")
    if experiment == "checks-279" and [
        (override["name"], override["from"], override["to"])
        for override in dependency_overrides
    ] != [("@tscircuit/checks", "0.0.278", "0.0.279")]:
        raise RuntimeError("The checks experiment must change only the declared checker")
    sources = verify_sources(root, json.loads((controller / "source-provenance.json").read_text()))
    runtime = root / "runtime"
    ar_dependencies = root / "autorouter-dependencies"
    npm = root / "npm"
    if any(path.exists() for path in [runtime, ar_dependencies, npm]):
        raise RuntimeError("Refuse to overwrite an existing benchmark runtime")
    runtime_lock = install_dependencies(controller / "runtime", runtime, arguments.bun)
    ar_lock = install_dependencies(controller / "autorouter-dependencies", ar_dependencies, arguments.bun)
    npm.mkdir()
    packages = [extract_package(package, npm / package["label"]) for package in release["packages"]]
    aliases = [link_package(runtime / "node_modules" / package["name"], npm / package["label"], package["name"]) for package in packages]
    (npm / "node_modules").symlink_to(runtime / "node_modules")
    (npm / "autorouter" / "node_modules").symlink_to(ar_dependencies / "node_modules")
    for path in [controller, root / "sources" / "original", root / "sources" / "spaced"]:
        (path / "node_modules").symlink_to(runtime / "node_modules")
    extra_packages = []
    for expected in release["additionalChangedPackages"]:
        folder = runtime / "node_modules" / expected["name"]
        metadata = json.loads((folder / "package.json").read_text())
        entry = folder / expected["entryRelative"]
        if metadata["version"] != expected["version"] or sha256(entry) != expected["entrySha256"]:
            raise RuntimeError("Changed declared dependency was not reconciled")
        extra_packages.append({"name": expected["name"], "version": metadata["version"], "entrySha256": sha256(entry)})
    manifest = {
        "mainVersion": release["mainVersion"], "packages": packages,
        "dependencyOverrides": dependency_overrides,
        "experiment": experiment,
        "additionalChangedPackages": extra_packages, "sourceCommits": sources,
        "runtimeDependencyFiles": runtime_lock, "autorouterDependencyFiles": ar_lock,
        "packageAliases": aliases, "sourceOverrides": False,
    }
    cpu_lines = Path("/proc/cpuinfo").read_text().splitlines()
    model_lines = [line for line in cpu_lines if line.split(":", 1)[0].strip() in ["model name", "Model", "Hardware", "CPU part"]]
    memory_lines = Path("/proc/meminfo").read_text().splitlines()
    memory_max = Path("/sys/fs/cgroup/memory.max")
    manifest["runner"] = {
        "uname": dict(platform.uname()._asdict()), "architecture": platform.machine(),
        "cpuCount": os.cpu_count(), "cpuModel": model_lines[0].split(":", 1)[1].strip() if model_lines else None,
        "memTotal": next(line.split(":", 1)[1].strip() for line in memory_lines if line.startswith("MemTotal:")),
        "cgroupMemoryMax": memory_max.read_text().strip() if memory_max.exists() else None,
        "artificialMemoryLimitApplied": False, "bun": "1.4.3",
    }
    if manifest["runner"]["architecture"] not in ["aarch64", "arm64"]:
        raise RuntimeError("Expected the declared Blacksmith ARM runner")
    (root / "runtime-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"preparedRuntime": release["mainVersion"], "experiment": manifest["experiment"], "dependencyOverrides": manifest["dependencyOverrides"], "packageVersions": {package["name"]: package["version"] for package in packages}, "sourceCommits": sources}))


if __name__ == "__main__":
    main()
