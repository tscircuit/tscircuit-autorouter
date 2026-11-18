"""Classify the new-source structural capture without claiming routing completion."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1])
plan = json.loads(Path(__file__).with_name("bus-phase2-plan.json").read_text())
expected_input = plan["input"]["rawSha256"]
expected_core = plan["source"]["candidateCoreSha256"]
start = json.loads((root / "start-proof.json").read_text())
instrumentation = json.loads((root / "instrumentation-proof.json").read_text())
assert start["rawInputSha256"] == expected_input
assert start["coreSha256"] == instrumentation["sourceSha256"] == expected_core
assert start["observerSha256"] == instrumentation["instrumentedSha256"]
assert start["nativeOptions"] == {} and start["routingBudgetsChanged"] is False
assert start["externalDiagnosticWindowMs"] == plan["recommendedExecution"]["externalDiagnosticWindowMs"] == 900000
assert start["fullBoardRemainingBudgetEquivalent"] is False


def read_payload(name, expected_sha):
    raw = gzip.decompress((root / name).read_bytes())
    assert hashlib.sha256(raw).hexdigest() == expected_sha, name
    return json.loads(raw)


read_payload("phase-2-input.srj.json.gz", expected_input)
accepted_path = root / "child1-accepted-proof.json"
accepted = json.loads(accepted_path.read_text()) if accepted_path.exists() else None
if accepted:
    assert accepted["pipelineId"] == plan["geometryCapture"]["requiredSolvedChildId"]
    assert accepted["solved"] is True and accepted["failed"] is False
    read_payload("solved-child1-output.srj.json.gz", accepted["outputSha256"])
report_path = root / "report.json"
first_child = None
capture = None
errors = []
if report_path.exists():
    report = json.loads(report_path.read_text())
    errors = report["observerErrors"] + report["diagnosticMetadata"]["errors"]
    if report["executionError"] is not None:
        errors.append(report["executionError"])
    if report["wasmAttempts"]:
        errors.append("Unexpected routing WASM attempts")
    assert report["routingBudgetsChanged"] is False and report["nativeOptions"] == {}
    assert report["externalDiagnosticWindowMs"] == 900000 and report["fullBoardRemainingBudgetEquivalent"] is False
    assert report["canonicalRawInputBeforeSha256"] == report["canonicalRawInputAfterSha256"]
    assert report["adaptedBeforeSha256"] == report["adaptedAfterSha256"] == start["adaptedBeforeSha256"]
    assert report["rawInputSha256"] == expected_input
    assert report["originalEntrySha256"] == expected_core
    assert report["diagnosticEntrySha256"] == instrumentation["instrumentedSha256"]
    assert report["mainVersion"] == plan["source"]["publishedPackages"]["main"]
    assert report["coreVersion"] == plan["source"]["publishedPackages"]["core"]
    assert report["child1Accepted"] == accepted
    first_child = next((pipeline for pipeline in report["pipelines"] if pipeline["id"] == plan["geometryCapture"]["requiredSolvedChildId"]), None)
    capture = report["child2Geometry"]
    if errors:
        outcome = "diagnostic-execution-or-observer-error"
    elif capture:
        assert report["child2CaptureAttempted"]
        assert capture["pipelineId"] == plan["geometryCapture"]["targetChildId"]
        assert capture["parentId"] == 0
        assert first_child and first_child["final"]["solved"] and not first_child["final"]["failed"]
        assert capture["firstChildSolved"] and capture["capturedBeforeFirstChild2Step"]
        assert accepted and accepted["outputSha256"] == capture["firstChildOutputSha256"]
        child_input = read_payload("child2-input.srj.json.gz", capture["inputSha256"])
        read_payload("solved-child1-output.srj.json.gz", capture["firstChildOutputSha256"])
        assert len(child_input["traces"]) == capture["inputTraceCount"]
        assert len(child_input["connections"]) == capture["inputConnectionCount"]
        if capture["routingInputSha256"] != capture["inputSha256"]:
            read_payload("child2-routing-input.srj.json.gz", capture["routingInputSha256"])
        assert json.loads((root / "child2-geometry-proof.json").read_text()) == capture
        if capture.get("preparedLaneCaptured"):
            assert capture["ordinaryStepCalls"] == report["child2OrdinaryStepCalls"] == 1
            lane_input = read_payload("child2-lane-input.srj.json.gz", capture["laneInputSha256"])
            assert len(lane_input["traces"]) == capture["laneInputTraceCount"]
            parameters = (root / "child2-lane-parameters.json").read_bytes()
            assert hashlib.sha256(parameters).hexdigest() == capture["laneParameterSha256"]
            assert json.loads(parameters)["capturedAfterFirstPipelineStep"] is True
            outcome = "second-child-pristine-and-prepared-geometry-captured-after-first-child-solved"
        else:
            outcome = "second-child-pristine-captured-prepared-lane-unavailable"
    elif first_child and first_child["final"]["failed"]:
        outcome = "first-child-failed-before-second-child-capture"
    elif report["captureDeadlineReached"]:
        outcome = "soft-capture-before-second-child-geometry"
    elif report["failed"]:
        outcome = "pipeline-failed-before-second-child-capture"
    elif report["solved"]:
        read_payload("completed-output.srj.json.gz", report["outputSha256"])
        assert report["outputNeedsPhysicalValidation"] is True
        outcome = "phase-solved-without-target-capture-physical-validation-pending"
    else:
        outcome = "stopped-without-target-capture-or-routing-outcome"
        errors.append("Diagnostic stopped without the requested capture, a failure, a solve or an external deadline")
    elapsed_ms = report["elapsedMs"]
else:
    checkpoint = json.loads((root / "checkpoint.json").read_text())
    errors = checkpoint["observerErrors"]
    assert os.environ.get("OBSERVER_STEP_OUTCOME") == "failure"
    outcome = "interrupted-capture-cause-requires-workflow-log"
    elapsed_ms = checkpoint["elapsedMs"]
    first_child = next((pipeline for pipeline in checkpoint["pipelines"] if pipeline["id"] == plan["geometryCapture"]["requiredSolvedChildId"]), None)

proof = {
    "scope": "Observed phase structural diagnostic only; no physical completion, speedup or full-board result claim",
    "sourceCandidateCommit": plan["source"]["sourceCandidateCommit"],
    "candidateCoreSha256": expected_core,
    "rawInputSha256": expected_input,
    "outcome": outcome,
    "targetGeometryCaptured": outcome == "second-child-pristine-and-prepared-geometry-captured-after-first-child-solved",
    "lastObservedElapsedMs": elapsed_ms,
    "firstChild": first_child,
    "child1Accepted": accepted,
    "child2Geometry": capture,
    "observationalAssertionsPassed": not errors,
    "errors": errors,
    "controlLaneExecuted": False,
    "dynamicNeutralityProven": False,
    "reportedRoutingBudgetsUnchanged": True,
    "externalDiagnosticWindowMs": 900000,
    "fullBoardRemainingBudgetEquivalent": False,
    "timingLimitation": "Fresh phase diagnostic window; not the remaining full-board budget after byte0 and not a comparable end-to-end performance run.",
}
(root / "observation-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps(proof))
if errors:
    sys.exit(1)
