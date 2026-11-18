"""Classify a diagnostic capture separately from a routing outcome."""
import gzip
import hashlib
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
    assert report["child2CaptureAttempted"] and report["child2Geometry"]
    capture = report["child2Geometry"]
    expected = "97225ab8d4c4365275e8fa542cbaf25f3acbe4732879669189e71dc6463bff85"
    assert capture["inputSha256"] == expected and capture["firstChildSolved"]
    assert capture["capturedBeforeFirstChild2Step"] and capture["inputTraceCount"] == 24
    assert capture["inputConnectionCount"] == 8
    assert capture["preparedLaneCaptured"]
    assert hashlib.sha256(gzip.decompress((root / "child2-lane-input.srj.json.gz").read_bytes())).hexdigest() == capture["laneInputSha256"]
    assert hashlib.sha256((root / "child2-lane-parameters.json").read_bytes()).hexdigest() == capture["laneParameterSha256"]
    for name, digest in [("child2-input.srj.json.gz", expected), ("solved-child1-output.srj.json.gz", capture["firstChildOutputSha256"])]:
        assert hashlib.sha256(gzip.decompress((root / name).read_bytes())).hexdigest() == digest
    if capture["routingInputSha256"] != expected:
        assert hashlib.sha256(gzip.decompress((root / "child2-routing-input.srj.json.gz").read_bytes())).hexdigest() == capture["routingInputSha256"]
    assert not report["captureDeadlineReached"], "Target geometry capture did not finish before the external guard"
    outcome = "second-child-geometry-captured-after-first-child-solved"
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
