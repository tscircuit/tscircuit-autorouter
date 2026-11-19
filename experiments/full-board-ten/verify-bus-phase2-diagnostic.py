"""Classify a full-phase diagnostic; never count partial child geometry as accepted output."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1])
plan = json.loads(Path(__file__).with_name("bus-phase2-plan.json").read_text())
start = json.loads((root / "start-proof.json").read_text())
exposure = json.loads((root / "instrumentation-proof.json").read_text())
assert start["rawInputSha256"] == plan["input"]["rawSha256"]
assert start["coreSha256"] == exposure["sourceSha256"] == plan["source"]["candidateCoreSha256"]
assert start["observerSha256"] == exposure["instrumentedSha256"] == plan["source"]["diagnosticCoreSha256"]
assert exposure["sourcePrefixExact"] and exposure["replacementCount"] == 0 and exposure["existingSourceBytesChanged"] is False
assert start["nativeOptions"] == {} and start["routingBudgetsChanged"] is False and start["sourceHooks"] == 0
assert start["externalDiagnosticWindowMs"] == 900000 and start["fullBoardRemainingBudgetEquivalent"] is False
raw = gzip.decompress((root / "phase-2-input.srj.json.gz").read_bytes())
assert hashlib.sha256(raw).hexdigest() == plan["input"]["rawSha256"]
physical_path = root / "physical-assessment.json"
physical = json.loads(physical_path.read_text()) if physical_path.exists() else None
errors = []
report_path = root / "report.json"
accepted_output = False
if report_path.exists():
    report = json.loads(report_path.read_text())
    assert report["rawInputSha256"] == start["rawInputSha256"]
    assert report["originalEntrySha256"] == start["coreSha256"]
    assert report["diagnosticEntrySha256"] == start["observerSha256"]
    assert report["canonicalRawInputBeforeSha256"] == report["canonicalRawInputAfterSha256"]
    assert report["adaptedBeforeSha256"] == report["adaptedAfterSha256"] == start["adaptedBeforeSha256"]
    assert report["nativeOptions"] == {} and report["routingBudgetsChanged"] is False and report["sourceHooks"] == 0
    assert report["mainVersion"] == plan["source"]["publishedPackages"]["main"] and report["coreVersion"] == plan["source"]["publishedPackages"]["core"]
    assert report["nativeRoutingNames"] == plan["input"]["connectionOrder"]
    assert report["retainedInputTraceCount"] == plan["input"]["retainedTraces"]
    if report["executionError"] is not None:
        errors.append(report["executionError"])
    if report["wasmAttempts"]:
        errors.append("Unexpected routing WASM attempt")
    accepted_output = report["acceptedOutputCaptured"]
    if accepted_output:
        assert report["solved"] and not report["failed"] and not errors
        result_bytes = gzip.decompress((root / "completed-output.srj.json.gz").read_bytes())
        assert hashlib.sha256(result_bytes).hexdigest() == report["outputSha256"]
        assert physical and physical["performed"] and physical["acceptedOutputSha256"] == report["outputSha256"]
        outcome = "phase-solved-native-validated" if physical["passed"] else "phase-solved-physical-validation-failed"
    elif errors:
        outcome = "diagnostic-execution-error"
    elif report["failed"]:
        outcome = "native-phase-failed"
    elif report["captureDeadlineReached"]:
        outcome = "soft-diagnostic-deadline"
    else:
        outcome = "unexplained-stop"
        errors.append("No accepted final solve, native failure, execution error or external deadline")
    elapsed = report["elapsedMs"]
    state = {key: report[key] for key in ["phase", "iterations", "maxIterations", "solved", "failed", "error", "currentTraceCount", "stats"]}
else:
    checkpoint = json.loads((root / "checkpoint.json").read_text())
    assert os.environ.get("OBSERVER_STEP_OUTCOME") == "failure"
    assert checkpoint["rawInputSha256"] == start["rawInputSha256"]
    errors = ["Unexpected routing WASM attempt"] if checkpoint["wasmAttempts"] else []
    elapsed = checkpoint["elapsedMs"]
    state = checkpoint
    outcome = "interrupted-diagnostic-cause-requires-workflow-log"
proof = {
    "scope": "One frozen3236 isolated final-phase diagnostic; no latest3242, full-board gain or speedup claim",
    "sourceCandidateCommit": plan["source"]["sourceCandidateCommit"],
    "candidateCoreSha256": start["coreSha256"], "rawInputSha256": start["rawInputSha256"],
    "outcome": outcome, "acceptedFinalOutput": accepted_output,
    "diagnosticGoalMet": outcome == "phase-solved-native-validated",
    "lastObservedElapsedMs": elapsed, "lastObservedState": state,
    "physicalAssessment": physical, "errors": errors,
    "observationalAssertionsPassed": not errors, "sourceHooks": 0,
    "controlLaneExecuted": False, "dynamicNeutralityProven": False,
    "reportedRoutingBudgetsUnchanged": True, "externalDiagnosticWindowMs": 900000,
    "fullBoardRemainingBudgetEquivalent": False,
    "interpretation": "Only the final accepted output is assessed against all16 native nets/48 terminals and retained copper. One fresh phase window cannot establish a same-budget full-board gain. Failure does not authorize another replay.",
}
(root / "observation-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps(proof))
if errors:
    sys.exit(1)
