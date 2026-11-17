"""Authenticate the native H616 input and retain the unchanged published entry."""
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
controller = Path(__file__).resolve().parent
manifest = json.loads((root / "runtime-manifest.json").read_text())
release = json.loads((controller / "release.json").read_text())
native = json.loads((controller / "h616-native-input.json").read_text())
sha = lambda contents: hashlib.sha256(contents).hexdigest()
assert manifest["mainVersion"] == "0.0.3207"
assert not manifest["sourceOverrides"] and not manifest["dependencyOverrides"]
for package in manifest["packages"]:
    frozen = next(item for item in release["packages"] if item["name"] == package["name"])
    assert package["version"] == frozen["version"]
    assert sha(Path(package["entry"]).read_bytes()) == frozen["entrySha256"]

# The API token is sent only to GitHub; the signed archive needs no credentials.
class StopRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None

request = urllib.request.Request(
    f'https://api.github.com/repos/tscircuit/tscircuit-autorouter/actions/artifacts/{native["artifactId"]}/zip',
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
    archive = response.read(native["artifactBytes"] + 1)
assert len(archive) == native["artifactBytes"] and sha(archive) == native["artifactSha256"]
folder = root / "native-artifact"
folder.mkdir()
with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
    for member in native["members"]:
        contents = zipped.read(member["filename"])
        assert len(contents) == member["bytes"] and sha(contents) == member["sha256"]
        (folder / member["filename"]).write_bytes(contents)
input_path = folder / "phase-4-input.srj.json.gz"
raw = gzip.decompress(input_path.read_bytes())
assert sha(raw) == native["inputSha256"]
srj = json.loads(raw)
assert {key: len(srj.get(key, [])) for key in native["counts"]} == native["counts"]
package = next(item for item in manifest["packages"] if item["name"] == "@tscircuit/capacity-autorouter")
entry = Path(package["entry"])
proof = {
    "variant": "published", "diagnosticOnly": True, "fullBoardResult": False,
    "inputPath": str(input_path), "inputSha256": sha(raw), "inputGzipSha256": sha(input_path.read_bytes()),
    "nativeResultPath": str(folder / "result.json"), "nativeInputProvenance": native,
    "originalAutorouterEntry": str(entry), "originalAutorouterSha256": sha(entry.read_bytes()),
    "selectedAutorouterEntry": str(entry), "selectedAutorouterSha256": sha(entry.read_bytes()),
    "constructor": "new P9(input, {capacityDepth:undefined,targetMinCapacity:undefined,cacheProvider:null,effort:undefined})",
    "captureSearchDebug": "absent, matching Core", "limitsMs": [900000, 960000],
    "diagnosticPacketLimitBytes": 1048576,
    "cacheCaveat": "Fresh process without earlier-phase caches. Original native input and final error can be qualified; original3207 internal HD prefix was not captured.",
    "packages": [{"name": item["name"], "version": item["version"], "entrySha256": item["entrySha256"]} for item in manifest["packages"]],
}
(root / "phase-replay-runtime.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps({key: proof[key] for key in ["variant", "inputSha256", "selectedAutorouterSha256", "diagnosticOnly"]}))
