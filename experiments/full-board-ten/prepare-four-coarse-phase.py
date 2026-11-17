"""Authenticate one archived native input and install two isolated source entries."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request
import zipfile

root = Path(sys.argv[1]).resolve()
case_id = sys.argv[2]
controller = Path(__file__).resolve().parent
case = next(case for case in json.loads((controller / "four-coarse-phase-cases.json").read_text()) if case["id"] == case_id)
sha = lambda data: hashlib.sha256(data).hexdigest()
runtime = json.loads((root / "runtime-manifest.json").read_text())
release = json.loads((controller / "release.json").read_text())
builds = json.loads((controller / "source-bundles/manifest.json").read_text())
assert runtime["mainVersion"] == "0.0.3208" and not runtime["sourceOverrides"] and not runtime["dependencyOverrides"]
for package in runtime["packages"]:
    frozen = next(item for item in release["packages"] if item["name"] == package["name"])
    assert package["version"] == frozen["version"]
    assert sha(Path(package["entry"]).read_bytes()) == frozen["entrySha256"]

# Keep the token on the GitHub API request; fetch the signed archive without it.
class StopRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None

request = urllib.request.Request(
    f'https://api.github.com/repos/tscircuit/tscircuit-autorouter/actions/artifacts/{case["artifactId"]}/zip',
    headers={"Authorization": f'Bearer {os.environ["GITHUB_TOKEN"]}', "Accept": "application/vnd.github+json"},
)
try:
    urllib.request.build_opener(StopRedirect).open(request, timeout=90)
except urllib.error.HTTPError as error:
    assert error.code == 302
    archive_url = error.headers["Location"]
else:
    raise RuntimeError("Expected a signed artifact redirect")
assert archive_url.startswith("https://")
with urllib.request.urlopen(archive_url, timeout=90) as response:
    archive = response.read(case["artifactBytes"] + 1)
assert len(archive) == case["artifactBytes"] and sha(archive) == case["artifactSha256"]
folder = root / "native-phase"
folder.mkdir()
with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
    for file in case["nativeFiles"]:
        data = zipped.read(file["filename"])
        assert len(data) == file["bytes"] and sha(data) == file["sha256"]
        (folder / file["filename"]).write_bytes(data)
compressed_input = (folder / case["inputFilename"]).read_bytes()
input_bytes = gzip.decompress(compressed_input)
assert sha(compressed_input) == case["inputGzipSha256"] and sha(input_bytes) == case["inputSha256"]
srj = json.loads(input_bytes)
assert {"connections": len(srj["connections"]), "traces": len(srj.get("traces", [])), "obstacles": len(srj["obstacles"])} == case["counts"]
package = next(package for package in runtime["packages"] if package["name"] == "@tscircuit/capacity-autorouter")
assert sha(Path(package["entry"]).read_bytes()) == builds["originalAutorouterSHA256"]
assert builds["mainVersion"] == runtime["mainVersion"]
assert builds["routingSource"]["autorouterVersion"] == "0.0.1113"
assert builds["routingSource"]["autorouterCommit"] == "b9f024828936f9639a696c9943747cc776cda72e"
assert builds["routingSource"]["tinyCandidateCommit"] == "f1fe8edcfb3dfde8fd644d09d81bad18743144b3"
for variant in ["source-baseline", "handoff-only"]:
    selected = builds["variants"][variant]
    compressed = (controller / "source-bundles" / selected["filename"]).read_bytes()
    assert len(compressed) == selected["compressedBytes"] and sha(compressed) == selected["compressedSha256"]
    entry = gzip.decompress(compressed)
    assert len(entry) == selected["entryBytes"] and sha(entry) == selected["entrySha256"]
    destination = root / "npm" / f"phase-{variant}"
    destination.mkdir()
    (destination / "package.json").write_text('{"type":"module"}\n')
    (destination / "index.js").write_bytes(entry)
    (destination / "node_modules").symlink_to(root / "autorouter-dependencies/node_modules")
    proof = {
        "case": case, "variant": variant, "diagnosticOnly": True, "fullBoardResult": False,
        "routingSourceOverride": True, "routingSource": builds["routingSource"],
        "publishedRuntimeMainVersion": runtime["mainVersion"],
        "inputPath": str(folder / case["inputFilename"]), "inputSha256": sha(input_bytes),
        "nativeCoarsePath": str(folder / "coarse-diagnostics.json"),
        "originalAutorouterEntry": package["entry"], "originalAutorouterSha256": package["entrySha256"],
        "selectedAutorouterEntry": str(destination / "index.js"), "selectedAutorouterSha256": sha(entry),
        "sourceBuild": selected, "sourceBuildManifestSha256": sha((controller / "source-bundles/manifest.json").read_bytes()),
        "limitsMs": [900000, 960000], "captureSearchDebug": "absent, matching Core",
        "constructor": "new P9(input, {capacityDepth:undefined,targetMinCapacity:undefined,cacheProvider:null,effort:undefined})",
        "cacheCaveat": "Fresh process without earlier-phase warm caches; qualify every baseline's actual coarse contract against its original native run.",
        "packages": [{"name": item["name"], "version": item["version"], "entrySha256": item["entrySha256"]} for item in runtime["packages"]],
    }
    (root / f"phase-{variant}-runtime.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps({"case": case_id, "inputSha256": sha(input_bytes), "archiveAuthenticated": True, "variants": ["source-baseline", "handoff-only"]}))
