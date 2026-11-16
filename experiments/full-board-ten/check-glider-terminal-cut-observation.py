"""Validate the observation only; canonical output parity awaits the fresh3200 control."""

import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
release = json.loads((Path(__file__).parent / "release.json").read_text())
folder = root / "results/glider/spaced"
result = json.loads((folder / "result.json").read_text())
diagnostic = json.loads((folder / "coarse-diagnostics.json").read_text())
reports = [report for report in diagnostic["reports"] if report["phase"] == "other_signals"]
if len(reports) != 1:
    raise RuntimeError("Expected exactly one native Glider other_signals diagnostic")
report = reports[0]
observation = report.get("pendingTerminalCut", {})
final = report["final"]
route = final.get("currentRoute") or {}
captured_route = observation.get("route", {})
selected_packet = {"id": "glider", "cohort": "spaced", "phase": "other_signals", "reportCount": 1, "pendingTerminalCut": observation}
checks = {
    "published3200": release["mainVersion"] == "0.0.3200",
    "nativeGliderSpaced": result["id"] == "glider" and result["cohort"] == "spaced" and result["experiment"] == "published" and result["executionMode"] == "full",
    "noSourceOverrides": result["dependencyOverrides"] == [],
    "noRoutingWasm": result["wasmUsage"]["routingOrUnknownAttempts"] == 0,
    "observerCompletedWithoutError": observation.get("status") == "observed" and "observerError" not in observation,
    "capturedBeforeFinalAcceptance": observation.get("trigger") == "before_tryFinalAcceptance",
    "completeTerminalNeighborhood": observation.get("complete") is True,
    "actualPendingRoute": bool(route) and captured_route.get("id") == route.get("routeId") and captured_route.get("connectionId") == route.get("connectionId") and captured_route.get("net") == route.get("netId") and captured_route.get("currentNet") == route.get("netId") and captured_route.get("endpointPorts") == route.get("portIds") and captured_route.get("goal") in route.get("portIds", []),
    "nativeTwoMillionIterationCap": report["configured"]["MAX_ITERATIONS"] == 2_000_000 and report["configured"]["solveGraphOptions"]["MAX_ITERATIONS"] == 2_000_000 and final["MAX_ITERATIONS"] == 2_000_000 and final["iterations"] == 2_000_000 and observation.get("maxIterations") == 2_000_000 and observation.get("iterations") == 2_000_000,
    "sameNativeQueue": observation.get("queue", {}).get("length") == final["candidateQueueLength"],
    "selectedPacketBelow24KiB": len(json.dumps(selected_packet, separators=(",", ":"), ensure_ascii=False).encode()) < 24 * 1024,
}
packet = {
    "baselineCommit": "102c27644a53cf02861199d38608a9931dbef25d",
    "release": "tscircuit@0.0.3200",
    "diagnosticOnly": True,
    "observationValid": all(checks.values()),
    "checks": checks,
    "canonicalOutputParity": "pending_fresh3200_control_comparison",
    "benefitClaim": False,
    "limitations": "This gate validates the selected observation only. Physical net membership, copper counts, findings, phases/errors and coarse state still require comparison with the fresh3200 control before interpreting the diagnostic. Observation adds timing overhead.",
}
(root / "glider-terminal-cut-observation-gate.json").write_text(json.dumps(packet, indent=2) + "\n")
print("GLIDER_TERMINAL_CUT_OBSERVATION_GATE " + json.dumps(packet))
if not packet["observationValid"]:
    raise RuntimeError("Glider diagnostic lacks a complete error-free witness of its actual pending route at the native cap")
