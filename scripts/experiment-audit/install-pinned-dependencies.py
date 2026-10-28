#!/usr/bin/env python3
"""Preserve source manifests and git commit pins in an isolated install."""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("checkout", type=pathlib.Path)
    args = parser.parse_args()
    checkout = args.checkout.resolve()
    original_bytes = (checkout / "package.json").read_bytes()
    manifest = json.loads(original_bytes)
    install_root = checkout.parent / (checkout.name + "-dependencies")
    install_root.mkdir(exist_ok=True)
    private_manifest = {"name": "isolated-experiment-" + checkout.name, "version": "1.0.0", "private": True, "type": "module"}
    direct = {}
    for section in ["dependencies", "devDependencies", "optionalDependencies"]:
        if section not in manifest:
            continue
        converted = {}
        for name, declaration in manifest[section].items():
            source = declaration
            if source.startswith(("git+https://github.com/", "github:")):
                match = re.fullmatch(r"(?:git\+https://github\.com/|github:)([^/#]+)/([^/#]+?)(?:\.git)?#([0-9a-f]+)", source)
                if not match:
                    raise ValueError("Expected immutable GitHub pin for " + name)
                source = f"https://codeload.github.com/{match[1]}/{match[2]}/tar.gz/{match[3]}"
            converted[name] = source
            direct[name] = {"declaration": declaration, "installedSource": source}
        private_manifest[section] = converted
    for key in ["overrides", "resolutions", "trustedDependencies"]:
        if key in manifest:
            private_manifest[key] = manifest[key]
    if "patchedDependencies" in manifest:
        private_manifest["patchedDependencies"] = manifest["patchedDependencies"]
        shutil.copytree(checkout / "patches", install_root / "patches", dirs_exist_ok=True)
    (install_root / "package.json").write_text(json.dumps(private_manifest, indent=2) + "\n")
    subprocess.run(["bun", "install", "--no-save"], cwd=install_root, check=True)
    modules = install_root / "node_modules"
    destination = checkout / "node_modules"
    if destination.exists() or destination.is_symlink():
        raise RuntimeError("Preserving existing node_modules; expected a fresh checkout")
    destination.symlink_to(modules, target_is_directory=True)
    for name, record in direct.items():
        package = modules / name / "package.json"
        if package.exists():
            package_bytes = package.read_bytes()
            resolved = json.loads(package_bytes)
            record.update({"resolvedName": resolved.get("name"), "resolvedVersion": resolved.get("version"),
                           "packageJsonSha256": hashlib.sha256(package_bytes).hexdigest()})
        else:
            record["missingPackageJson"] = True
    packages = []
    for package in sorted(modules.rglob("package.json")):
        try:
            data = package.read_bytes()
            parsed = json.loads(data)
        except (OSError, ValueError):
            continue
        if parsed.get("name") and parsed.get("version"):
            packages.append({"path": str(package.relative_to(modules)), "name": parsed["name"], "version": parsed["version"], "packageJsonSha256": hashlib.sha256(data).hexdigest()})
    provenance = {"sourcePackageJsonSha256": hashlib.sha256(original_bytes).hexdigest(), "directDependencies": direct,
                  "installedPackages": packages, "sourceLockfilePresent": (checkout / "bun.lock").exists(),
                  "reproducibilityLimitation": "The source repository has no lockfile. Git/archive dependency commits are preserved; registry ranges and transitive dependencies resolve at job time. Actual package versions/hashes are retained and equal declarations are compared between arms."}
    (checkout / "experiment-dependencies-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(json.dumps({"checkout": checkout.name, "directDependencyCount": len(direct), "recordedPackageCount": len(packages)}))


if __name__ == "__main__":
    main()
