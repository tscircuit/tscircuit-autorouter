"""Gate fresh diagnostic interpretation on the existing native outcome."""

import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
board = sys.argv[2]
expected = json.loads((Path(__file__).parent / "quality-reference.json").read_text())["cases"][board]
folder = root / "results" / board / "spaced"
assessment = json.loads((folder / "assessment.json").read_text())
result = json.loads((folder / "result.json").read_text())
acceptance = json.loads((folder / "acceptance-stats.json").read_text())
names_hash = hashlib.sha256(json.dumps(sorted(assessment["unconnectedNets"]), separators=(",", ":")).encode()).hexdigest()
checks = {
    "sameNativeMembership": names_hash == expected["unconnectedNativeNamesSha256"] and assessment["connectedNets"] == expected["connectedNets"] and assessment["requestedNets"] == expected["requestedNets"],
    "sameCopperCounts": assessment["pcbTraces"] == expected["pcbTraces"] and assessment["vias"] == expected["vias"],
    "sameFindingsVector": assessment["findings"] == expected["findings"],
    "sameSourceCounts": all(result["emittedCounts"][key] == value for key, value in expected["sourceCounts"].items()),
    "sameFailure": result["lastError"] == expected["lastError"] and result["lastPhase"] == expected["lastPhase"],
    "sameSourceModule": result["budgetDiagnostic"]["outputSha256"] == expected["routingSourceSha256"],
    "sameLimits": [result[key] for key in ["captureDeadlineMs", "hardDeadlineMs", "assessmentDeadlineMs"]] == expected["limitsMs"],
    "originalAssessmentPassed": result["assessmentReady"] and result["geometryErrorCount"] == 0 and result["completeSourceCounts"],
    "storedAcceptanceStatsAvailable": bool(acceptance) and all(item["recordedStatsAvailable"] for item in acceptance),
}
if board == "glider":
    quality = json.loads((folder / "quality-diagnostics.json").read_text())
    checks.update({
        "sixRealRepresentatives": quality.get("status") == "observed" and len(quality["representatives"]) == 6,
        "findingCountsPreserved": quality.get("countsUnchanged") == expected["findings"] and quality.get("physicalErrorCount") == 143,
        "boundedWitness": len(json.dumps({"id": board, "cohort": "spaced", "quality": quality}, separators=(",", ":")).encode()) < 24 * 1024,
        "viaCensusMatchesOriginalRows": quality.get("viaDuplicateCensus", {}).get("viaRows") == expected["vias"],
        "viaCensusSpanCoverage": quality.get("viaDuplicateCensus", {}).get("unclassifiedViaRows") == 0,
        "referencedGeometryAvailable": bool(quality.get("representatives")) and all(item.get("referencedGeometry") for item in quality["representatives"]),
    })
diagnostic = json.loads((folder / "coarse-diagnostics.json").read_text())
projection = []
for report in diagnostic["reports"]:
    final = report.get("final")
    item = {key: report.get(key) for key in ["id", "cohort", "phase", "inputNetCount", "configured", "lifecycleCounts", "firstExhaustedSearch", "firstRejectedGoalApproach", "firstNonfiniteGoalApproachWithoutPriorGoal"]}
    item["id"] = board
    item["cohort"] = "spaced"
    item["innerHookInstalled"] = report.get("innerHookInstalled", bool(report.get("configured")))
    item["final"] = None
    if final is not None:
        item["final"] = {key: final.get(key) for key in ["iterations", "MAX_ITERATIONS", "currentRoute", "pendingRouteCount", "neverAttemptedCount", "iterationsSincePreviousRouteEvent", "candidateQueueLength", "bestCompleteSnapshotPresent", "selectiveRerip"]}
        item["final"]["neverSuccessfullyRoutedCount"] = len(final["neverSuccessfullyRouted"])
    projection.append(item)
checks.update({
    "sameWireLength": assessment["wireLengthMm"] == expected["wireLengthMm"],
    "samePrimaryConfigurationStateAndLifecycle": projection == expected["coarseProjection"],
    "noHardOrAuditTimeout": not result["hardTimedOut"] and not result["auditTimedOut"] and result["auditExitCode"] == 0,
    "sameRenderExit": result["renderExitCode"] == expected["renderExitCode"],
    "routingPolicyPreserved": result["routingPolicyObserved"] and result["wasmUsage"]["routingOrUnknownAttempts"] == 0,
    "budgetInstallerProof": result["routingSourceOverride"] and result["budgetDiagnostic"]["publishedCorePreserved"] and result["budgetDiagnostic"]["assessmentAutorouterUnchanged"],
})
packet = {"board": board, "diagnosticOnly": True, "canonicalOutcomeParityPassed": all(checks.values()), "checks": checks,
          "qualification": "Diagnostics only; native full-board completion remains unqualified. No findings were filtered or deduplicated."}
(folder / "quality-parity.json").write_text(json.dumps(packet, indent=2) + "\n")
print("BUDGET_QUALITY_PARITY " + json.dumps(packet))
if not packet["canonicalOutcomeParityPassed"]:
    raise RuntimeError("Native outcome or diagnostic completeness changed; do not attribute the reference findings/strategy")
