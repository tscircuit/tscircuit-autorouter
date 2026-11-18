"""Classify a diagnostic capture separately from a routing outcome."""
import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1])
report_path = root / "report.json"
if report_path.exists():
    report = json.loads(report_path.read_text())
    assert not report["observerErrors"] and not report["diagnosticMetadata"]["errors"]
    assert report["executionError"] is None and not report["wasmAttempts"]
    assert report["routingBudgetsChanged"] is False
    assert report["canonicalRawInputBeforeSha256"] == report["canonicalRawInputAfterSha256"]
    assert report["adaptedBeforeSha256"] == report["adaptedAfterSha256"]
    assert report["rawInputSha256"] == "cc7843ecfae413f5afc1eefc88fa5dcd92e152aba3bb97fa266bd6ef1cafb272"
    assert report["originalEntrySha256"] == "9dbc237005e3a517d804d7661abd1a2d4519b7b678abac237d636ad8d84d26d6"
    outcome = "solved-needs-physical-validation" if report["solved"] else "solver-failed" if report["failed"] else "soft-capture"
    assert report["solved"] or report["failed"] or report["captureDeadlineReached"]
else:
    checkpoint = json.loads((root / "checkpoint.json").read_text())
    assert not checkpoint["observerErrors"]
    start = json.loads((root / "start-proof.json").read_text())
    assert start["rawInputSha256"] == "cc7843ecfae413f5afc1eefc88fa5dcd92e152aba3bb97fa266bd6ef1cafb272"
    assert start["coreSha256"] == "9dbc237005e3a517d804d7661abd1a2d4519b7b678abac237d636ad8d84d26d6"
    assert start["nativeOptions"] == {} and start["routingBudgetsChanged"] is False
    assert os.environ.get("OBSERVER_STEP_OUTCOME") == "failure"
    outcome = "interrupted-capture-use-workflow-log-for-cause"
proof = {"scope": "Single observed phase diagnostic; not a performance comparison or full-board result", "outcome": outcome, "observerErrors": False, "controlLaneExecuted": False, "dynamicNeutralityProven": False, "reportedRoutingBudgetsUnchanged": True}
(root / "observation-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps(proof))
