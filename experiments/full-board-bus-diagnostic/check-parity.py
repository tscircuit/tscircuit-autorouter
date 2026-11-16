"""Keep a diagnostic observation separate from a routing improvement claim."""

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
observation = json.loads((folder / "bus-negotiation-observer.json").read_text())
observed = observation["summary"]
source_bytes = Path(progress["sourcePath"]).read_bytes()
source = json.loads(source_bytes)
requested = {net["nativeName"] for net in source["nets"] if net["routable"]}
missing = {net["name"] for net in assessment["missingCopper"]}
connected = sorted(requested - missing)
if len(connected) != assessment["connectedNets"]:
    raise RuntimeError("Physical net names disagree with canonical assessment")
phases = [{key: phase[key] for key in ["name", "status", "connections", "solver"]} for phase in progress["phases"]]
checks = {
    "sourceSha256": hashlib.sha256(source_bytes).hexdigest() == reference["sourceSha256"],
    "countsAndBlocker": {key: result[key] for key in reference["counts"]} == reference["counts"],
    "findings": assessment["findings"] == reference["findings"],
    "connectedNativeNetNames": connected == reference["connectedNativeNetNames"],
    "phaseOrderAndOutcome": phases == reference["phases"],
    "routingWasmAttempts": result["wasmUsage"]["routingOrUnknownAttempts"] == 0,
    "observerCompletedWithoutError": observed["observerCompletedWithoutError"],
    "boundedResultObserved": observed["observedBoundedResult"],
    "completedNullObserved": observed["observedCompletedNull"],
    "fatalWitnessObserved": bool(observation["witnesses"]["fatalWitnesses"]),
}
packet = {
    "baselineRunId": reference["baselineRunId"],
    "matchesAvailablePublishedEvidence": all(checks.values()),
    "checks": checks,
    "diagnosticOnly": True,
    "limitations": "Observation adds timing overhead. Public baseline has no full decoded SRJ/circuit hashes. Matching physical output and blocker does not prove identical internal search timing.",
}
(root / "bus-observer-parity.json").write_text(json.dumps(packet, indent=2) + "\n")
print("BUS_OBSERVER_PARITY " + json.dumps(packet))
if not packet["matchesAvailablePublishedEvidence"]:
    raise RuntimeError("Diagnostic outcome differs from the latest published reference")
