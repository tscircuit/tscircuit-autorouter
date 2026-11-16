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
census = report.get("currentSearchCensus", {})
frontier = census.get("minimumFrontierCost", {})
minimum = observation.get("queue", {}).get("first") or []
census_selected_packet = {"id": "glider", "cohort": "spaced", "phase": "other_signals", "reportCount": 1, "currentSearchCensus": census}
checks.update({
    "currentSearchCensusObserved": census.get("status") in ["disconnected-under-current-hard-admission", "cost-independent-connection-found", "census-limit-reached"],
    "currentSearchIdentity": census.get("routeId") == route.get("routeId") and census.get("net") == route.get("netId") and census.get("nativeIterations") == 2_000_000,
    "recordedFrontierCostsObserved": frontier.get("status") == "observed-recorded-costs",
    "sameMinimumFrontierCandidate": len(minimum) == 6 and [frontier.get("candidate", {}).get(key) for key in ["port", "nextRegion", "g", "h", "f"]] == [minimum[0], minimum[1], minimum[3], minimum[4], minimum[5]],
    "currentSearchPacketBelow24KiB": len(json.dumps(census_selected_packet, separators=(",", ":"), ensure_ascii=False).encode()) < 24 * 1024,
})
recoverability = report.get("goalSideRecoverability", {})
modes = recoverability.get("modes", [])
recoverability_selected_packet = {"id": "glider", "cohort": "spaced", "phase": "other_signals", "reportCount": 1, "goalSideRecoverability": recoverability}
expected_modes = ["current", "verified-movable-owners-relaxed", "all-assignments-relaxed"]
checks.update({
    "goalSideRecoverabilityObserved": recoverability.get("status") == "observed",
    "goalSideIdentity": recoverability.get("routeId") == route.get("routeId") and recoverability.get("net") == route.get("netId") and recoverability.get("nativeIterations") == 2_000_000,
    "threeCompleteNecessaryConditionModes": [mode.get("mode") for mode in modes] == expected_modes and all(mode.get("status") in ["disconnected-under-mode", "cost-independent-connection-found"] for mode in modes),
    "forwardReverseCurrentAgreement": bool(modes) and ((census.get("status") == "disconnected-under-current-hard-admission" and modes[0].get("status") == "disconnected-under-mode") or (census.get("status") == "cost-independent-connection-found" and modes[0].get("status") == "cost-independent-connection-found")),
    "recoverabilityPacketBelow24KiB": len(json.dumps(recoverability_selected_packet, separators=(",", ":"), ensure_ascii=False).encode()) < 24 * 1024,
})
packet = {
    "baselineCommit": "102c27644a53cf02861199d38608a9931dbef25d",
    "priorDiagnosticCommit": "99bfea070042f1c766d51e3dcc98946bbedc66a8",
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
