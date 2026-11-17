"""Install one authenticated P9 source entry in a private full-board runtime."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
bundles = Path(sys.argv[2]).resolve()
variant = sys.argv[3]
sha = lambda content: hashlib.sha256(content).hexdigest()
manifest_path = root / "runtime-manifest.json"
manifest_bytes = manifest_path.read_bytes()
manifest = json.loads(manifest_bytes)
build_bytes = (bundles / "manifest.json").read_bytes()
build = json.loads(build_bytes)
assert manifest["mainVersion"] == build["mainVersion"] == "0.0.3208"
assert not manifest["sourceOverrides"] and not manifest["dependencyOverrides"]
selected = build["variants"][variant]
compressed = (bundles / selected["filename"]).read_bytes()
assert len(compressed) == selected["compressedBytes"] and sha(compressed) == selected["compressedSha256"]
source_entry = gzip.decompress(compressed)
assert len(source_entry) == selected["entryBytes"] and sha(source_entry) == selected["entrySha256"]
published = next(package for package in manifest["packages"] if package["name"] == "@tscircuit/capacity-autorouter")
assert published["version"] == "0.0.1112"
assert published["entrySha256"] == build["originalAutorouterSHA256"]
original_folder = root / "npm" / published["label"]
original_entry = Path(published["entry"])
assert original_entry == original_folder / published["entryRelative"]
assert sha(original_entry.read_bytes()) == published["entrySha256"]
private_folder = root / "npm" / f"autorouter-{variant}"
private_folder.mkdir()
private_entry = private_folder / published["entryRelative"]
original_copy = private_entry.with_name("published-original.js")
source_folder = private_entry.parent / "source-pipeline9"
source_folder.mkdir(parents=True)
source_path = source_folder / "index.js"
for item in published["publishedFiles"]:
    relative = Path(item["path"])
    assert not relative.is_absolute() and ".." not in relative.parts
    original = original_folder / relative
    assert sha(original.read_bytes()) == item["sha256"]
    target = original_copy if original == original_entry else private_folder / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    os.link(original, target)
source_path.write_bytes(source_entry)
source_runtime_original = root / "autorouter-dependencies/node_modules/@tscircuit/solver-utils"
source_runtime_private = source_folder / "node_modules/@tscircuit/solver-utils"
source_runtime_private.mkdir(parents=True)
runtime_metadata = json.loads((source_runtime_original / "package.json").read_text())
assert runtime_metadata["name"] == "@tscircuit/solver-utils" and runtime_metadata["version"] == "0.0.23"
runtime_files = []
for original in sorted(source_runtime_original.rglob("*")):
    if original.is_dir():
        continue
    assert original.is_file() and not original.is_symlink()
    relative = original.relative_to(source_runtime_original)
    target = source_runtime_private / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    os.link(original, target)
    assert sha(target.read_bytes()) == sha(original.read_bytes())
    runtime_files.append({"path": str(relative), "sha256": sha(original.read_bytes()), "bytes": original.stat().st_size})
wrapper = ('export * from "./published-original.js"\n'
    'export { AutoroutingPipelineSolver9_PreloadedTraceGraph,\n'
    '  AutoroutingPipelineSolver9_PreloadedTraceGraph as AutoroutingPipelineSolver } from "./source-pipeline9/index.js"\n')
private_entry.write_text(wrapper)
(private_folder / "node_modules").symlink_to(root / "autorouter-dependencies/node_modules")
alias = root / "runtime/node_modules/@tscircuit/capacity-autorouter"
assert alias.is_symlink() and alias.resolve() == original_folder
alias.unlink()
alias.symlink_to(private_folder)
assert sha(original_entry.read_bytes()) == published["entrySha256"]
proof = {
    "variant": variant, "diagnosticOnly": True, "routingSourceOverride": True,
    "publishedPackage": published,
    "privatePackage": str(private_folder), "wrapperEntry": str(private_entry),
    "wrapperSha256": sha(private_entry.read_bytes()),
    "publishedCopyEntry": str(original_copy), "publishedCopySha256": sha(original_copy.read_bytes()),
    "sourceEntry": str(source_path), "sourceSha256": sha(source_path.read_bytes()),
    "packageMetadataSha256": sha((private_folder / "package.json").read_bytes()),
    "dependencyDirectory": str((private_folder / "node_modules").resolve()),
    "isolatedSourceRuntime": {
        "name": runtime_metadata["name"], "version": runtime_metadata["version"],
        "original": str(source_runtime_original.resolve()), "private": str(source_runtime_private),
        "files": runtime_files,
        "reason": "Published and source modules register distinct classes with the same names. Byte-identical modules at distinct paths isolate their module-scoped registries without changing or suppressing registration.",
    },
    "runtimeAlias": str(alias), "sourceBuildManifestSha256": sha(build_bytes),
    "sourceBuild": build, "selectedSourceBuild": selected,
    "publishedRuntimeManifestSha256": sha(manifest_bytes),
    "scope": "The private package's two P9 export bindings change, and its source bundle uses a byte-identical solver-utils module instance with an isolated registry. All other published exports and package files are preserved.",
}
(root / "published-runtime-manifest.json").write_bytes(manifest_bytes)
(root / "source-overlay.json").write_text(json.dumps(proof, indent=2) + "\n")
manifest["packages"] = [
    {"name": package["name"], "label": package["label"], "version": package["version"],
     "gitHead": package.get("gitHead"), "entryRelative": package["entryRelative"],
     "entry": str(private_entry), "entrySha256": proof["wrapperSha256"],
     "origin": "private-source-overlay", "publishedEntrySha256": published["entrySha256"]}
    if package["name"] == published["name"] else package
    for package in manifest["packages"]
]
manifest["sourceOverrides"] = True
manifest["sourceOverlay"] = {"path": str(root / "source-overlay.json"), "sha256": sha((root / "source-overlay.json").read_bytes())}
manifest["experiment"] = variant
manifest["packageAliases"] = [
    {**item, "target": str(private_folder)} if item["alias"] == str(alias) else item
    for item in manifest["packageAliases"]
]
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"variant": variant, "routingSourceOverride": True, "wrapperSha256": proof["wrapperSha256"], "sourceSha256": proof["sourceSha256"]}))
