"""Select authenticated source builds for a frozen native phase benchmark."""
import gzip
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
variant = sys.argv[2]
if variant not in {"source-baseline", "via-reservation", "guard-only", "via-plus-guard"}:
    raise ValueError("Unknown frozen source variant")
controller = Path(__file__).resolve().parent
manifest = json.loads((root / "runtime-manifest.json").read_text())
release = json.loads((controller / "release.json").read_text())
source_builds = json.loads((controller / "source-bundles/manifest.json").read_text())
sha = lambda contents: hashlib.sha256(contents).hexdigest()
assert manifest["mainVersion"] == "0.0.3207" and not manifest["sourceOverrides"]
assert not manifest["dependencyOverrides"]
for package in manifest["packages"]:
    frozen = next(item for item in release["packages"] if item["name"] == package["name"])
    assert package["version"] == frozen["version"]
    assert sha(Path(package["entry"]).read_bytes()) == frozen["entrySha256"]
package = next(item for item in manifest["packages"] if item["name"] == "@tscircuit/capacity-autorouter")
original_entry = Path(package["entry"])
original = original_entry.read_bytes()
assert sha(original) == source_builds["originalAutorouterSHA256"]
selected = source_builds["variants"][variant]
compressed_entry = (controller / "source-bundles" / selected["filename"]).read_bytes()
assert len(compressed_entry) == selected["compressedBytes"] and sha(compressed_entry) == selected["compressedSha256"]
entry = gzip.decompress(compressed_entry)
assert len(entry) == selected["entryBytes"] and sha(entry) == selected["entrySha256"]
folder = root / "npm" / f"autorouter-phase-{variant}"
folder.mkdir()
(folder / "package.json").write_text('{"type":"module"}\n')
selected_entry = folder / "index.js"
selected_entry.write_bytes(entry)
(folder / "node_modules").symlink_to(root / "autorouter-dependencies/node_modules")
input_path = root / "native-artifact/phase-4-input.srj.json.gz"
compressed = input_path.read_bytes()
assert sha(compressed) == "d8ba29edacd668a92a7872c4dfcb69432ee3074f0512801db75bd917a304627b"
raw = gzip.decompress(compressed)
assert sha(raw) == "469694b90af95e44a1ef964c454370fdf361705400d152519391f9624896da6d"
srj = json.loads(raw)
assert (len(srj["connections"]), len(srj["traces"]), len(srj["obstacles"])) == (166, 36, 2041)
proof = {
    "variant": variant, "diagnosticOnly": True, "fullBoardResult": False,
    "inputPath": str(input_path), "inputSha256": sha(raw), "inputGzipSha256": sha(compressed),
    "sourceArtifactId": 14279817246, "sourceRunId": 43972696308,
    "sourceArchivePreviouslyAuthenticatedSha256": "4b0613f38bb5299ba0be54e8b5d8e1f75bb6254d28451b34ecf6c749f9fb1bae",
    "originalAutorouterEntry": str(original_entry), "originalAutorouterSha256": sha(original),
    "selectedAutorouterEntry": str(selected_entry), "selectedAutorouterSha256": sha(entry),
    "sourceBuild": selected, "sourceBuildManifestSha256": sha((controller / "source-bundles/manifest.json").read_bytes()),
    "constructor": "new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {capacityDepth:undefined,targetMinCapacity:undefined,cacheProvider:null,effort:undefined})",
    "captureSearchDebug": "absent, matching Core", "limitsMs": [900000, 960000],
    "diagnosticPacketLimitBytes": 1048576,
    "cacheCaveat": "Fresh process lacks prior-phase warmed internal HD global cache. Qualify source baseline against published native queue, coarse roles, failure and private candidate geometry.",
    "packages": [{"name": item["name"], "version": item["version"], "entrySha256": item["entrySha256"]} for item in manifest["packages"]],
}
assert sha(original_entry.read_bytes()) == source_builds["originalAutorouterSHA256"]
(root / "phase-replay-runtime.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps({key: proof[key] for key in ["variant", "inputSha256", "selectedAutorouterSha256", "diagnosticOnly"]}))
