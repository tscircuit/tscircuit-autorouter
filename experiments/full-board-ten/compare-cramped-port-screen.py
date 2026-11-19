"""Compare one candidate phase to the authenticated historical published failure."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

C = Path(__file__).resolve().parent
sha = lambda data: hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    spec = importlib.util.spec_from_file_location("prepare", C / "prepare-cramped-port-screen.py")
    prep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prep)
    plan = prep.verified_plan()
    inputs, output = map(lambda path: Path(path).resolve(), sys.argv[1:])
    runtime = prep.verify_runtime(plan, inputs)
    candidate = plan["sourceCandidate"]
    overlay = json.loads((inputs / "overlay-proof.json").read_text())
    require(overlay["mappingSha256"] == candidate["mappingSha256"] and overlay["candidateAutorouterSha256"] == candidate["candidateAutorouterSha256"] and overlay["source"] == candidate["source"], "Candidate source identity mismatch")
    require(overlay["runtimeProof"] == runtime and overlay["publishedRuntimeUnchanged"] and overlay["packageAliasesUnchanged"] and overlay["candidateNotUsedByAssessment"], "Published graph or assessment changed")
    require(sha(Path(overlay["candidateEntry"]).read_bytes()) == candidate["candidateAutorouterSha256"], "Candidate entry changed")
    case = plan["cases"]["imx6"]
    proof = json.loads((inputs / "input-proof.json").read_text())
    require(proof["files"] == case["files"] and proof["noInputTransformations"] is True and proof["nativeCounts"] == case["nativeCounts"], "Native input proof mismatch")
    for name, expected in case["files"].items():
        data = (inputs / name).read_bytes()
        require(len(data) == expected["bytes"] and sha(data) == expected["sha256"], "Native assessment input changed: " + name)
    reference = plan["historicalPublished"]
    historical_dir = inputs / "historical-published"
    historical_proof = json.loads((historical_dir / "proof.json").read_text())
    for field in ["id", "name", "size_in_bytes", "digest", "workflow_run"]:
        require(historical_proof["artifact"][field] == reference["artifact"][field], "Historical artifact metadata mismatch")
    require("sha256:" + historical_proof["zipSha256"] == reference["artifact"]["digest"] and historical_proof["files"] == reference["files"] and historical_proof["baselineRoutingRepeated"] is False and historical_proof["nativeInputOptionsAndPublishedGraphMatch"] is True, "Historical archive qualification missing")
    for name, expected in reference["files"].items():
        data = (historical_dir / name).read_bytes()
        require(sha(data) == expected["sha256"] and len(data) == expected["bytes"], "Historical member changed: " + name)
    historical = json.loads((historical_dir / "report.json").read_text())
    require(historical["failed"] and not historical["solved"] and not historical["timedOut"] and not historical["executionError"] and not historical["outputSha256"] and historical["error"] == reference["nativeFailure"], "Historical published failure mismatch")
    require(historical["inputSha256"] == case["files"]["phase-4-input.srj.json.gz"]["payloadSha256"], "Historical native input differs")
    calibration = json.loads((inputs.parent / "assessment-baseline/physical-assessment.json").read_text())
    recorded = json.loads((inputs / "assessment.json").read_text())
    require(calibration["baselineQualified"] and calibration["nativeAssessment"]["connectedNets"] == 53 and calibration["nativeAssessment"]["requestedNets"] == 404, "Baseline materialization qualification missing")
    require(sorted(calibration["nativeAssessment"]["unconnectedNets"]) == sorted(recorded["unconnectedNets"]), "Baseline connected native identities differ")
    require(calibration["canonicalPhysicalFindings"] == [] and calibration["newPhysicalFindings"] == [] and calibration["resolvedPhysicalFindings"] == [] and calibration["nativeAssessment"]["geometryErrors"] == [], "Baseline zero-physical-findings qualification failed")
    lane = output / "candidate"
    exit_code = int((lane / "process-exit-code.txt").read_text())
    report_path = lane / "report.json"
    row = {"outcome": "external_interruption_without_final_report", "acceptedOutput": False, "validatedPhaseCompletion": False, "physicalAssessment": None}
    report = None
    source_screen_qualified = False
    if report_path.exists():
        report = json.loads(report_path.read_text())
        require(report["variant"] == "candidate" and report["planSha256"] == sha((C / "cramped-port-screen-plan.json").read_bytes()), "Runner plan/variant mismatch")
        require(report["inputSha256"] == historical["inputSha256"] and report["inputCompressedSha256"] == historical["inputCompressedSha256"], "Historical and candidate native input differs")
        require(report["initialInputCanonicalSha256"] == report["finalInputCanonicalSha256"] == historical["initialInputCanonicalSha256"] == historical["finalInputCanonicalSha256"], "Native routing geometry changed")
        require(report["inputFileUnchanged"] and report["autorouterEntryUnchanged"] and report["publishedAutorouterEntryUnchanged"], "Native file or published runtime changed")
        require(report["autorouterEntrySha256"] == candidate["candidateAutorouterSha256"] and report["mappingSha256"] == candidate["mappingSha256"] and report["sourceCandidate"] == candidate["source"], "Runner source mapping differs")
        require(report["suppliedOptions"] == historical["suppliedOptions"] == {"cacheProvider": None} and report["undefinedOptionKeys"] == historical["undefinedOptionKeys"] == plan["undefinedOptionKeys"], "Native caller options differ")
        require(report["effectiveOptions"] == historical["effectiveOptions"] and report["effectiveEffort"] == historical["effectiveEffort"], "Effective solver settings differ")
        require(report["captureDeadlineMs"] == historical["captureDeadlineMs"] == 900000 and report["hardDeadlineSeconds"] == historical["hardDeadlineSeconds"] == 960, "Diagnostic budget differs")
        require(report.get("intervention") is None and not report.get("pointMapSha256"), "Point intervention is forbidden")
        require(not report["thrownError"] and not report["wasmAttempts"] and exit_code == 0, "Runner execution error")
        boundary = report.get("uniformBoundary")
        if boundary is not None:
            require(boundary.get("pointInterventionApplied") is False, "Original Uniform geometry was altered")
        observation = {"captured": False, "observationErrors": report.get("regionalObservationErrors", [])}
        if report.get("regionalContextSha256"):
            data = (lane / "regional-context.json").read_bytes()
            require(len(data) <= 540672 and sha(data) == report["regionalContextSha256"], "Regional context identity or bound changed")
            context = json.loads(data)
            observation.update({"path": "candidate/regional-context.json", "sha256": sha(data), "bytes": len(data), "captured": context.get("captured", False), "nodeId": context.get("nodeId"), "scope": context.get("scope")})
        accepted = bool(report["solved"] and not report["failed"] and not report["timedOut"] and report["outputSha256"])
        assessed = None
        assessment_failure = None
        if accepted:
            require(boundary is not None, "Solved output lacks original Uniform boundary evidence")
            require(sha(gzip.decompress((lane / "phase-output.srj.json.gz").read_bytes())) == report["outputSha256"], "Accepted output changed")
            assessment_exit = int((lane / "assessment-exit-code.txt").read_text())
            assessment_path = lane / "physical-assessment.json"
            if assessment_exit != 0 or not assessment_path.exists():
                assessment_failure = {"exitCode": assessment_exit, "reportPresent": assessment_path.exists(), "status": "solved-output-not-physically-qualified"}
            else:
                assessed = json.loads(assessment_path.read_text())
                require(assessed["performed"] and assessed["phaseSolved"] and assessed["acceptedOutputSha256"] == report["outputSha256"], "Assessment output binding failed")
                require(assessed["originalGeometryPreserved"] and assessed["immutableDdrTraces"] == 17 and assessed["immutableDdrVias"] == 30, "Immutable native geometry changed")
                require(assessed["originalPhaseObstacles"] == 2922 and assessed["allNativeDemands"] == 380 and assessed["activeRequested"] == 327 and assessed["priorRequested"] == 53, "Native demand scope changed")
        else:
            require(not (lane / "phase-output.srj.json.gz").exists(), "Unaccepted output present")
        row = {"outcome": "solved_output_failed_validation" if accepted else "diagnostic_deadline" if report["timedOut"] else "pipeline_failed", "acceptedOutput": accepted, "validatedPhaseCompletion": False, "activePhase": report["activePhase"], "error": report["error"], "elapsedMs": report["elapsedMs"], "highDensity": report.get("highDensity"), "regionalObservation": observation, "candidateOriginalUniformBoundary": boundary, "physicalAssessment": assessed, "assessmentFailure": assessment_failure}
        if assessed:
            old_unconnected = set(recorded["unconnectedNets"])
            current_unconnected = set(assessed["nativeAssessment"]["unconnectedNets"])
            row["connectedComparedToPriorCopper"] = {"gainedNativeNames": sorted(old_unconnected - current_unconnected), "lostNativeNames": sorted(current_unconnected - old_unconnected)}
            row["validatedPhaseCompletion"] = bool(assessed["allDemandedConnectionsConnected"] is True and assessed["activeConnected"] == 327 and assessed["priorConnected"] == 53 and assessed["lostOrUnfinished"] == [] and row["connectedComparedToPriorCopper"]["lostNativeNames"] == [] and assessed["nativeAssessment"]["requestedNets"] == 404 and assessed["nativeAssessment"]["geometryErrors"] == [] and assessed["canonicalPhysicalFindings"] == [] and assessed["newPhysicalFindings"] == [])
            if row["validatedPhaseCompletion"]:
                row["outcome"] = "validated_phase_completion"
        source_screen_qualified = True
    else:
        require(exit_code in [124, 137, 143], "Missing report without external interruption")
        require(not (lane / "phase-output.srj.json.gz").exists(), "Missing final report with unqualified output")
    benefit = bool(source_screen_qualified and row["validatedPhaseCompletion"] and row.get("connectedComparedToPriorCopper", {}).get("gainedNativeNames"))
    result = {"scope": plan["purpose"], "diagnosticOnly": True, "wholeBoardGainClaim": False, "fullBoardRunRequired": True, "freshPairedTimingComparison": False, "baselineRoutingRepeated": False, "historicalPublishedQualified": True, "sourceScreenInterpretable": source_screen_qualified, "benefitQualified": benefit, "benefitScope": "Isolated full native phase completion only, compared with the authenticated published failure. Actual full-board900s qualification remains required.", "baselineMaterializationQualified": True, "planSha256": sha((C / "cramped-port-screen-plan.json").read_bytes()), "sourceCandidate": candidate, "runtimeVerifiedAfterCandidate": True, "historicalPublished": {"runId": reference["artifact"]["workflow_run"]["id"], "artifactId": reference["artifact"]["id"], "elapsedMs": historical["elapsedMs"], "error": historical["error"], "highDensity": historical["highDensity"], "geometryCaptureComplete": False}, "candidate": row, "timeWindow": {"historicalFullBoardRemainingMs": plan["historicalFullBoardRemainingMs"], "candidateElapsedMs": report["elapsedMs"] if report else None, "candidateCompletionWithinHistoricalRemainingWindow": bool(benefit and report["elapsedMs"] <= plan["historicalFullBoardRemainingMs"]), "wholeBoardBudgetQualified": False, "scope": "Diagnostic comparison only; prior full-board prefix time cannot substitute for an actual full-board rerun."}, "sourceOverrideScope": "Direct sibling AR entry only; published package aliases/Core/assessment stay unchanged."}
    (output / "comparison.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"outcome": row["outcome"], "benefitQualified": benefit, "wholeBoardGainClaim": False}))


if __name__ == "__main__":
    main()
