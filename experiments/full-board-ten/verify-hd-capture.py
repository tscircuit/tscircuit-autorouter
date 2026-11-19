"""Classify diagnostic evidence; a captured routing failure is not a board gain."""

import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sys


CONTROLLER = Path(__file__).resolve().parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    spec = importlib.util.spec_from_file_location("hd_preparer", CONTROLLER / "prepare-hd-capture.py")
    preparer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(preparer)
    plan = preparer.verified_plan()
    output = Path(sys.argv[1]).resolve()
    case = plan["cases"]["h616"]
    runtime = preparer.verify_runtime(plan, output)
    proof = json.loads((output / "input-proof.json").read_text())
    require(proof["files"] == case["files"] and proof["noInputTransformations"] is True, "Input provenance mismatch")
    require(proof["runtime"] == runtime, "Published runtime changed after capture")
    for name, expected in case["files"].items():
        data = (output / name).read_bytes()
        require(len(data) == expected["bytes"] and sha(data) == expected["sha256"], f"Retained input changed: {name}")
    exit_code = int((output / "process-exit-code.txt").read_text())
    result = {"schemaVersion": 1, "scope": plan["purpose"], "planSha256": sha((CONTROLLER / "hd-capture-plan.json").read_bytes()), "runtimeVerifiedAfterCapture": True, "processExitCode": exit_code, "wholeBoardCompletionClaim": False, "primaryTargetConnection": case["primaryTargetConnection"], "fallbackTargetNode": case["fallbackTargetNode"]}
    summary_path = output / "summary.json"
    if not summary_path.exists():
        require(exit_code in [124, 137, 143], "Diagnostic exited without a report")
        result.update(classification="external_interruption_without_final_report", finalReportAuthenticated=False, targetCaptureComplete=False, inputInMemoryImmutabilityVerified=False)
    else:
        summary = json.loads(summary_path.read_text())
        data = (output / "hd-capture.json.gz").read_bytes()
        raw = gzip.decompress(data)
        require(sha(data) == summary["captureGzipSha256"] and len(data) == summary["captureGzipBytes"] and sha(raw) == summary["captureSha256"], "Diagnostic payload identity mismatch")
        capture = json.loads(raw)
        require({k: v for k, v in summary.items() if k not in ["captureSha256", "captureGzipSha256", "captureGzipBytes"]} == capture["summary"], "Summary differs from authenticated payload")
        require(summary["planSha256"] == result["planSha256"], "Runner used another plan")
        require(summary["inputSha256"] == case["files"]["phase-4-input.srj.json.gz"]["payloadSha256"], "Runner input mismatch")
        require(summary["inputCompressedSha256"] == case["files"]["phase-4-input.srj.json.gz"]["sha256"], "Compressed runner input mismatch")
        require(summary["initialInputCanonicalSha256"] == summary["finalInputCanonicalSha256"], "Solver mutated native input")
        require(all(summary[key] is True for key in ["inputFileUnchanged", "autorouterEntryUnchanged", "coreEntryUnchanged", "targetsAreIndependent"]), "Capture mutated input/runtime or combined targets")
        require(summary["entrySha256"] == next(p["entrySha256"] for p in plan["packages"] if p["name"] == "@tscircuit/capacity-autorouter"), "Runner module mismatch")
        require(summary["primaryTargetConnection"] == case["primaryTargetConnection"] and summary["fallbackTargetNode"] == case["fallbackTargetNode"], "Wrong diagnostic targets")
        require(summary["deadlineMs"] == 900000, "Runner deadline changed")
        require(not summary["executionError"] and not summary["captureError"] and not summary["wasmAttempts"], "Runner or observer failed")
        require(exit_code == 0, "Runner exited unsuccessfully")
        blobs = capture["blobs"]

        def value(item):
            return blobs[item["$blob"]] if isinstance(item, dict) and set(item) == {"$blob"} else item

        primary = []
        fallback = []
        for attempt in capture["attempts"]:
            final = value(attempt["final"])
            selected = value(attempt["selection"])
            pair = value(attempt["primaryPointPair"])
            node = value(attempt["node"])
            if attempt["kind"] == "b01" and selected["matchesPrimaryRoot"] and case["primaryTargetConnection"] in (final.get("error") or ""):
                require(pair["name"] == case["primaryTargetConnection"] and final["failed"] is True, "Primary failure capture mismatch")
                primary.append(attempt["id"])
            if attempt["kind"] == "regional" and selected["matchesFallbackNode"] and node["capacityMeshNodeId"] == case["fallbackTargetNode"] and final["failed"]:
                fallback.append(attempt["id"])
        error = summary["pipeline"].get("error") or ""
        if case["primaryTargetConnection"] in error:
            require(primary and summary["nativePathCaptured"] and summary["postUniformCaptured"], "Matching primary failure lacks original constructor/path capture")
        if case["fallbackTargetNode"] in error:
            require(fallback, "Matching fallback failure lacks its separate original constructor capture")
        outcome = summary["outcome"]
        require(outcome in ["pipeline_solved", "pipeline_failed", "diagnostic_deadline"], "Unknown diagnostic outcome")
        require((outcome == "pipeline_solved") == bool(summary["pipeline"]["solved"]), "Solver outcome mismatch")
        require((outcome == "pipeline_failed") == bool(summary["pipeline"]["failed"]), "Failure outcome mismatch")
        if outcome == "diagnostic_deadline":
            require(summary["elapsedMs"] >= plan["captureDeadlineMs"], "Soft diagnostic stopped before its deadline")
        result.update(classification="matching_primary_and_fallback_failure_captured" if outcome == "pipeline_failed" and primary and fallback else outcome, pipelineOutcome=outcome, finalReportAuthenticated=True, targetCaptureComplete=bool(primary and fallback), inputInMemoryImmutabilityVerified=True, primaryFailureAttemptIds=primary, fallbackFailureAttemptIds=fallback, pipeline=summary["pipeline"], activePhase=summary["activePhase"], elapsedMs=summary["elapsedMs"], observationMs=summary["observationMs"], failedB01Events=summary["failedB01Events"], regionalEvents=summary["regionalEvents"], finalHighDensityAccounting=summary["finalHighDensityAccounting"])
    (output / "verification.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
