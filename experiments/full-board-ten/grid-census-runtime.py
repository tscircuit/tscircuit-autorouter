"""Install a private counter-only Core copy for a bounded diagnostic worker."""

import hashlib
import json
import os
from pathlib import Path
import sys


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(root: Path, instrumented_alias: bool) -> dict:
    proof = json.loads((root / "grid-census-runtime-proof.json").read_text())
    for item in proof["immutableFiles"] + proof["instrumentedFiles"]:
        if sha(Path(item["path"])) != item["sha256"]:
            raise RuntimeError(f"Diagnostic file changed: {item['path']}")
    for item in proof["originalAliases"]:
        expected = proof["instrumentedFolder"] if instrumented_alias and item["name"] == "@tscircuit/core" else item["target"]
        if str(Path(item["path"]).resolve()) != expected:
            raise RuntimeError(f"Unexpected diagnostic package alias: {item['name']}")
    return {"originalPublishedFilesVerified": True, "instrumentedFilesVerified": True,
            "originalCoreRestored": not instrumented_alias,
            "originalCoreSha256": proof["originalCoreSha256"],
            "instrumentedCoreSha256": proof["instrumentedCoreSha256"]}


def install(root: Path) -> dict:
    controller = Path(__file__).resolve().parent
    anchor = json.loads((controller / "grid-census-anchor.json").read_text())
    release = json.loads((controller / "release.json").read_text())
    manifest_path = root / "runtime-manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest["mainVersion"] != "0.0.3203" or manifest["experiment"] != "published" or manifest["dependencyOverrides"] or manifest["sourceOverrides"]:
        raise RuntimeError("Expected fresh original published3203 runtime")
    if len(manifest["packages"]) != 4:
        raise RuntimeError("Expected the frozen four-package chain")
    immutable, aliases = [], []
    for package in manifest["packages"]:
        expected = next(row for row in release["packages"] if row["name"] == package["name"])
        if package["version"] != expected["version"] or package["entrySha256"] != expected["entrySha256"]:
            raise RuntimeError("Published package identity changed")
        folder = root / "npm" / package["label"]
        if Path(package["entry"]) != folder / package["entryRelative"]:
            raise RuntimeError("Unexpected published package path")
        for item in package["publishedFiles"]:
            path = folder / item["path"]
            if sha(path) != item["sha256"]:
                raise RuntimeError(f"Published file changed: {path}")
            immutable.append({"path": str(path), "sha256": item["sha256"]})
        alias = root / "runtime/node_modules" / package["name"]
        if not alias.is_symlink() or alias.resolve() != folder:
            raise RuntimeError("Unexpected original package alias")
        aliases.append({"name": package["name"], "path": str(alias), "target": str(folder)})
    for relative in ["runtime/package.json", "runtime/bun.lock", "autorouter-dependencies/package.json", "autorouter-dependencies/bun.lock"]:
        immutable.append({"path": str(root / relative), "sha256": sha(root / relative)})
    core = next(row for row in manifest["packages"] if row["name"] == "@tscircuit/core")
    if core["entrySha256"] != anchor["originalCoreSHA256"]:
        raise RuntimeError("Unexpected original Core bytes")
    source = Path(core["entry"]).read_bytes()
    old, new = anchor["old"].encode(), anchor["new"].encode()
    if source.count(old) != 1 or new in source or source.index(old) != anchor["byteOffset"]:
        raise RuntimeError("Grid census replacement anchor changed")
    instrumented = source.replace(old, new, 1)
    if hashlib.sha256(instrumented).hexdigest() != anchor["expectedDiagnosticCoreSHA256"]:
        raise RuntimeError("Unexpected instrumented Core digest")
    folder = root / "npm/core-grid-census"
    folder.mkdir()
    instrumented_files = []
    for item in core["publishedFiles"]:
        original = root / "npm/core" / item["path"]
        destination = folder / item["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        if original == Path(core["entry"]):
            destination.write_bytes(instrumented)
            expected_hash = anchor["expectedDiagnosticCoreSHA256"]
        else:
            os.link(original, destination)
            expected_hash = item["sha256"]
        instrumented_files.append({"path": str(destination), "sha256": expected_hash})
    original_manifest = root / "grid-census-original-runtime.json"
    original_manifest.write_bytes(manifest_bytes)
    immutable.append({"path": str(original_manifest), "sha256": sha(original_manifest)})
    diagnostic = {"originalCoreEntry": core["entry"], "originalCoreSha256": core["entrySha256"],
                  "instrumentedEntry": str(folder / core["entryRelative"]),
                  "instrumentedCoreSha256": anchor["expectedDiagnosticCoreSHA256"],
                  "counterOnly": True, "algorithmChanged": False, "profiled": False}
    manifest["gridCensusInstrumentation"] = diagnostic
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    immutable.append({"path": str(manifest_path), "sha256": sha(manifest_path)})
    proof = {**diagnostic, "instrumentedFolder": str(folder), "immutableFiles": immutable,
             "instrumentedFiles": instrumented_files, "originalAliases": aliases, "anchor": anchor}
    (root / "grid-census-runtime-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
    alias = root / "runtime/node_modules/@tscircuit/core"
    alias.unlink()
    alias.symlink_to(folder)
    return verify(root, instrumented_alias=True)


if __name__ == "__main__":
    mode, root_arg = sys.argv[1:]
    root = Path(root_arg).resolve()
    if mode == "install":
        result = install(root)
    elif mode == "restore":
        verify(root, instrumented_alias=True)
        alias = root / "runtime/node_modules/@tscircuit/core"
        alias.unlink()
        alias.symlink_to(root / "npm/core")
        result = verify(root, instrumented_alias=False)
        (root / "grid-census-post-proof.json").write_text(json.dumps(result, indent=2) + "\n")
    else:
        raise ValueError("Expected install or restore mode")
    print("GRID_CENSUS_RUNTIME_PROOF " + json.dumps({"stage": mode, **result}, separators=(",", ":")))
