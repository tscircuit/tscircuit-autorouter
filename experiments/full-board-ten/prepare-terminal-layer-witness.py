"""Verify unchanged published runtime and authenticated first-phase input."""
import gzip
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
controller = Path(__file__).resolve().parent
manifest = json.loads((root / "runtime-manifest.json").read_text())
release = json.loads((controller / "release.json").read_text())
sha = lambda contents: hashlib.sha256(contents).hexdigest()
assert manifest["mainVersion"] == "0.0.3209" and not manifest["sourceOverrides"]
assert not manifest["dependencyOverrides"]
for package in manifest["packages"]:
    frozen = next(item for item in release["packages"] if item["name"] == package["name"])
    assert package["version"] == frozen["version"]
    assert sha(Path(package["entry"]).read_bytes()) == frozen["entrySha256"]
package = next(item for item in manifest["packages"] if item["name"] == "@tscircuit/capacity-autorouter")
assert package["version"] == "0.0.1117"
core = next(item for item in manifest["packages"] if item["name"] == "@tscircuit/core")
core_source = Path(core["entry"]).read_text()
constructor_anchor = """const solverOptions = {
      capacityDepth,
      targetMinCapacity,
      cacheProvider: solverCacheProvider,
      effort
    };"""
assert core_source.count(constructor_anchor) == 1
assert core_source.count("new SOLVERS[solverName](input, solverOptions)") == 1
input_path = root / "native-artifact/phase-1-input.srj.json.gz"
compressed = input_path.read_bytes()
assert sha(compressed) == "e5392c09a437a9992535d6250d25ea632cc06405a16340b6a088e4cdd82cfe1c"
raw = gzip.decompress(compressed)
assert sha(raw) == "34006ec9507ce50917214bb22fd3fb1e97f44f92bc9a347468d30a943fa855a6"
srj = json.loads(raw)
assert (len(srj["connections"]), len(srj["traces"]), len(srj["obstacles"])) == (8, 0, 2038)
proof = {
    "diagnosticOnly": True, "fullBoardResult": False, "variant": "published",
    "inputPath": str(input_path), "inputSha256": sha(raw), "inputGzipSha256": sha(compressed),
    "sourceArtifactId": 14313970220, "sourceRunId": 44049457297,
    "sourceArchivePreviouslyAuthenticatedSha256": "493bf221ecbb428def8918a4fea29e27bafb8ea15b1040574e5623f88fc174f1",
    "autorouterEntry": package["entry"], "autorouterSha256": package["entrySha256"],
    "constructor": "new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {capacityDepth:undefined,targetMinCapacity:undefined,cacheProvider:null,effort:undefined})",
    "constructorAnchorSha256": sha(constructor_anchor.encode()),
    "captureSearchDebug": "absent, matching Core", "limitsMs": [900000, 960000],
    "diagnosticPacketLimitBytes": 8388608,
    "cacheCaveat": "Fresh native phase1 process; no prior routing phases or preloaded copper. Reproduction of published full-board failure is required.",
    "packages": [{"name": item["name"], "version": item["version"], "entrySha256": item["entrySha256"]} for item in manifest["packages"]],
}
(root / "terminal-witness-runtime.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps({key: proof[key] for key in ["variant", "inputSha256", "autorouterSha256", "diagnosticOnly"]}))
