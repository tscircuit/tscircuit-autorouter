"""Compare native completion against the exact published3198 control."""

import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
reference = json.loads((Path(__file__).parent / "published-reference.json").read_text())
folder = root / "results/h616/original"
result = json.loads((folder / "result.json").read_text())
progress = json.loads((folder / "progress.json").read_text())
assessment = json.loads((folder / "assessment.json").read_text())
observed = json.loads((folder / "bus-negotiation-observer.json").read_text())["summary"]
manifest = json.loads((root / "runtime-manifest.json").read_text())
source_bytes = Path(progress["sourcePath"]).read_bytes()
source = json.loads(source_bytes)
requested = {net["nativeName"] for net in source["nets"] if net["routable"]}
missing = {net["name"] for net in assessment["missingCopper"]}
connected = sorted(requested - missing)
if len(connected) != assessment["connectedNets"]:
    raise RuntimeError("Physical net names disagree with canonical assessment")
checks = {
    "sourceSha256": hashlib.sha256(source_bytes).hexdigest() == reference["sourceSha256"],
    "latestPublishedBase": manifest["mainVersion"] == "0.0.3198",
    "explicitCandidate": manifest["experiment"] == "bus-antipad-candidate" and bool(manifest["coreAntipadCandidate"]),
    "routingWasmAttempts": result["wasmUsage"]["routingOrUnknownAttempts"] == 0,
    "observerCompletedWithoutError": observed["observerCompletedWithoutError"],
}
packet = {
    "baselineRunId": reference["baselineRunId"],
    "checks": checks,
    "baseConnectedNativeNames": reference["connectedNativeNetNames"],
    "candidateConnectedNativeNames": connected,
    "addedNativeNames": sorted(set(connected) - set(reference["connectedNativeNetNames"])),
    "lostNativeNames": sorted(set(reference["connectedNativeNetNames"]) - set(connected)),
    "baseFindings": reference["findings"],
    "candidateFindings": assessment["findings"],
    "candidatePhases": [{key: phase[key] for key in ["name", "status", "connections", "solver"]} for phase in progress["phases"]],
    "limitations": "First native candidate screen; separate VMs and observer overhead prohibit a timing comparison. No Dataset18 or all-ten candidate claim.",
}
(root / "bus-antipad-comparison.json").write_text(json.dumps(packet, indent=2) + "\n")
print("BUS_ANTIPAD_COMPARISON " + json.dumps(packet))
if not all(checks.values()):
    raise RuntimeError("Candidate provenance or observation checks failed")
