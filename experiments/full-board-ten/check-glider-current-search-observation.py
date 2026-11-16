"""Validate the observation only; canonical parity awaits comparison with the frozen live-reachability run."""

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
    "nativeGliderSpaced": result["id"] == "glider" and result["cohort"] == "spaced" and result["experiment"] == "live-reachability-candidate" and result["executionMode"] == "full",
    "sameFrozenRoutingCandidate": result.get("liveReachabilityCandidate", {}).get("outputSha256") == "5f184e09c5873093a16e542238797e0a629f028e1651f087191ed246d34d4880" and result.get("routingSourceOverride") is True,
    "noRoutingWasm": result["wasmUsage"]["routingOrUnknownAttempts"] == 0,
    "observerCompletedWithoutError": observation.get("status") == "observed" and "observerError" not in observation,
    "capturedBeforeFinalAcceptance": observation.get("trigger") == "before_tryFinalAcceptance",
    "completeTerminalNeighborhood": observation.get("complete") is True,
    "actualPendingRoute": bool(route) and route.get("routeId") == 374 and route.get("connectionId") == "source_net_205" and captured_route.get("id") == route.get("routeId") and captured_route.get("connectionId") == route.get("connectionId") and captured_route.get("net") == route.get("netId") and captured_route.get("currentNet") == route.get("netId") and captured_route.get("endpointPorts") == route.get("portIds") and captured_route.get("goal") in route.get("portIds", []),
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
packet = {
    "baselineCommit": "17e4ec5fa90c4e3ef8036535cb44f34ea1f4977a",
    "priorDiagnosticCommit": "99bfea070042f1c766d51e3dcc98946bbedc66a8",
    "release": "tscircuit@0.0.3200",
    "diagnosticOnly": True,
    "observationValid": all(checks.values()),
    "checks": checks,
    "canonicalOutputParity": "pending_frozen_live_reachability_candidate_comparison",
    "benefitClaim": False,
    "limitations": "This gate validates the selected observation only. Physical net membership, copper counts, findings, phases/errors and coarse state still require comparison with the frozen candidate before interpreting the diagnostic. Observation adds timing overhead.",
}
(root / "glider-current-search-observation-gate.json").write_text(json.dumps(packet, indent=2) + "\n")
print("GLIDER_CURRENT_SEARCH_OBSERVATION_GATE " + json.dumps(packet))
if not packet["observationValid"]:
    raise RuntimeError("Glider diagnostic lacks a complete error-free witness of its actual pending route at the native cap")
