"""Compare one reviewed A03 source change without inferring whole-board gain."""
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
    spec = importlib.util.spec_from_file_location("prepare", C / "prepare-a03-via-gate-screen.py")
    prep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prep)
    plan = prep.verified_plan()
    inputs, output = map(lambda path: Path(path).resolve(), sys.argv[1:])
    runtime_proof = prep.verify_runtime(plan, inputs)
    overlay = json.loads((inputs / "overlay-proof.json").read_text())
    candidate = plan["sourceCandidate"]
    require(overlay["mappingSha256"] == candidate["mappingSha256"] and overlay["candidateAutorouterSha256"] == candidate["candidateAutorouterSha256"] and overlay["source"] == candidate["source"], "Candidate mapping identity mismatch")
    require(overlay["runtimeProof"] == runtime_proof and overlay["publishedRuntimeUnchanged"] and overlay["packageAliasesUnchanged"] and overlay["candidateNotUsedByAssessment"], "Candidate changed published graph or assessment")
    require(sha(Path(overlay["candidateEntry"]).read_bytes()) == candidate["candidateAutorouterSha256"], "Candidate sibling entry changed")
    proof = json.loads((inputs / "input-proof.json").read_text())
    case = plan["cases"]["h616"]
    require(proof["files"] == case["files"] and proof["noInputTransformations"] is True, "Input proof mismatch")
    for name, expected in case["files"].items():
        data = (inputs / name).read_bytes()
        require(len(data) == expected["bytes"] and sha(data) == expected["sha256"], "Retained input changed: " + name)
    baseline = json.loads((output / "baseline/physical-assessment.json").read_text())
    recorded = json.loads((inputs / "assessment.json").read_text())
    require(baseline["baselineQualified"] and baseline["nativeAssessment"]["connectedNets"] == 53, "Materialization qualification missing")
    require(sorted(baseline["nativeAssessment"]["unconnectedNets"]) == sorted(recorded["unconnectedNets"]), "Baseline native net identities differ")
    require(not baseline["newPhysicalFindings"] and not baseline["resolvedPhysicalFindings"], "Baseline physical identities differ")
    rows = {}
    reports = {}
    for variant in ["base", "candidate"]:
        lane = output / variant
        exit_code = int((lane / "process-exit-code.txt").read_text())
        report_path = lane / "report.json"
        if not report_path.exists():
            require(exit_code in [124, 137, 143], "Missing report without external timeout")
            rows[variant] = {"outcome": "external_interruption_without_final_report", "acceptedOutput": False, "physicalAssessment": None, "validatedPhaseCompletion": False}
            continue
        report = json.loads(report_path.read_text())
        reports[variant] = report
        require(report["variant"] == variant and report["planSha256"] == sha((C / "a03-via-gate-screen-plan.json").read_bytes()), "Runner plan or lane mismatch")
        require(report["inputSha256"] == case["files"]["phase-4-input.srj.json.gz"]["payloadSha256"], "Runner native input mismatch")
        require(report["inputCompressedSha256"] == case["files"]["phase-4-input.srj.json.gz"]["sha256"], "Compressed input mismatch")
        require(report["initialInputCanonicalSha256"] == report["finalInputCanonicalSha256"], "Native SRJ mutated")
        require(report["inputFileUnchanged"] and report["autorouterEntryUnchanged"], "Native file/runtime mutated")
        expected_entry = candidate["candidateAutorouterSha256"] if variant == "candidate" else overlay["originalAutorouterSha256"]
        require(report["autorouterEntrySha256"] == expected_entry and report["publishedAutorouterEntryUnchanged"], "Incorrect selected entry or published autorouter changed")
        require(report["mappingSha256"] == candidate["mappingSha256"] and report["sourceCandidate"] == candidate["source"], "Runner source binding mismatch")
        require(report["captureDeadlineMs"] == 900000 and report["hardDeadlineSeconds"] == 960, "Diagnostic deadline changed")
        require(report.get("intervention") is None and not report.get("pointMapSha256"), "Point intervention is forbidden in this source comparison")
        require(report["suppliedOptions"] == {"cacheProvider": None} and report["undefinedOptionKeys"] == plan["undefinedOptionKeys"], "Native options changed")
        require(not report["thrownError"] and not report["wasmAttempts"] and exit_code == 0, "Runner/observer error")
        if report.get("uniformBoundary") is not None:
            require(report["uniformBoundary"].get("pointInterventionApplied") is False, "Uniform coordinates were altered")
        tree_bytes = b""
        tree = {"captured": False, "observationError": "Optional observation was not saved"}
        if report.get("regionalTreeSha256"):
            tree_bytes = (lane / "regional-tree.json").read_bytes()
            require(sha(tree_bytes) == report["regionalTreeSha256"], "Regional tree bytes differ from report")
            tree = json.loads(tree_bytes)
        regional_state = {"observationError": "Optional observation was not saved"}
        if report.get("regionalStateSha256"):
            state_bytes = (lane / "regional-state.json").read_bytes()
            require(sha(state_bytes) == report["regionalStateSha256"], "Regional state bytes differ from report")
            require(len(state_bytes) <= 270337, "Regional state exceeds observation bound")
            regional_state = json.loads(state_bytes)
        accepted = report["solved"] and not report["failed"] and not report["timedOut"] and bool(report["outputSha256"])
        assessment_failure = None
        assessed = None
        if accepted:
            require(sha(gzip.decompress((lane / "phase-output.srj.json.gz").read_bytes())) == report["outputSha256"], "Accepted output changed")
            assessment_exit = int((lane / "assessment-exit-code.txt").read_text())
            assessment_path = lane / "physical-assessment.json"
            if assessment_exit != 0 or not assessment_path.exists():
                assessment_failure = {"exitCode": assessment_exit, "reportPresent": assessment_path.exists(), "status": "solved-output-not-physically-qualified"}
            else:
                assessed = json.loads(assessment_path.read_text())
                require(assessed["performed"] and assessed["phaseSolved"] and assessed["acceptedOutputSha256"] == report["outputSha256"], "Assessment output binding failed")
                require(assessed["originalGeometryPreserved"] and assessed["immutableDdrTraces"] == 16 and assessed["immutableDdrVias"] == 32, "Assessment geometry changed")
                require(assessed["originalPhaseObstacles"] == 1695 and assessed["allNativeDemands"] == 109 and assessed["activeRequested"] == 56 and assessed["priorRequested"] == 53, "Native demand scope changed")
        else:
            require(not (lane / "phase-output.srj.json.gz").exists(), "Provisional output masquerades as accepted")
        rows[variant] = {"outcome": "solved_output_pending_qualification" if accepted else "diagnostic_deadline" if report["timedOut"] else "pipeline_failed", "acceptedOutput": bool(accepted), "validatedPhaseCompletion": False, "activePhase": report["activePhase"], "error": report["error"], "regionalTree": {"path": variant + "/regional-tree.json", "sha256": report["regionalTreeSha256"], "bytes": len(tree_bytes), "truncated": tree.get("truncated"), "observationError": tree.get("observationError"), "observationQualified": bool(tree.get("captured")) and not tree.get("observationError") and not tree.get("truncated")}, "regionalState": {"path": variant + "/regional-state.json", "sha256": report.get("regionalStateSha256"), "observationError": regional_state.get("observationError")}, "regionalObservationErrors": report.get("regionalObservationErrors", []), "physicalAssessment": assessed, "assessmentFailure": assessment_failure}
    both_reports = all(name in reports for name in ["base", "candidate"])
    if both_reports:
        require(reports["base"]["initialInputCanonicalSha256"] == reports["candidate"]["initialInputCanonicalSha256"], "Lane inputs differ")
        require(reports["base"]["effectiveOptions"] == reports["candidate"]["effectiveOptions"] and reports["base"]["effectiveEffort"] == reports["candidate"]["effectiveEffort"], "Effective solver settings differ")
    both_boundaries = bool(both_reports and all(reports[name].get("uniformBoundary") and reports[name]["uniformBoundary"].get("pointInterventionApplied") is False for name in ["base", "candidate"]))
    if both_boundaries:
        require(reports["base"]["uniformBoundary"]["nodesSha256"] == reports["candidate"]["uniformBoundary"]["nodesSha256"] and reports["base"]["uniformBoundary"]["nodeCount"] == reports["candidate"]["uniformBoundary"]["nodeCount"], "Original Uniform boundaries differ")
    base_report = reports.get("base")
    known_base_failure = bool(base_report and base_report["failed"] and not base_report["solved"] and not base_report["timedOut"] and base_report["error"] == plan["expectedPublishedFailure"]["pipelineError"])
    for row in rows.values():
        assessed = row["physicalAssessment"]
        if assessed:
            current_unconnected = set(assessed["nativeAssessment"]["unconnectedNets"])
            old_unconnected = set(recorded["unconnectedNets"])
            row["connectedComparedToPriorCopper"] = {"gainedNativeNames": sorted(old_unconnected - current_unconnected), "lostNativeNames": sorted(current_unconnected - old_unconnected)}
            row["validatedPhaseCompletion"] = bool(
                assessed["allDemandedConnectionsConnected"] is True
                and assessed["activeConnected"] == 56 and assessed["priorConnected"] == 53
                and assessed["lostOrUnfinished"] == []
                and row["connectedComparedToPriorCopper"]["lostNativeNames"] == []
                and assessed["nativeAssessment"]["requestedNets"] == 121
                and assessed["nativeAssessment"]["geometryErrors"] == []
                and assessed["newPhysicalFindings"] == []
            )
        if row["acceptedOutput"]:
            row["outcome"] = "validated_phase_completion" if row["validatedPhaseCompletion"] else "solved_output_failed_validation"
    comparison = None
    if all(row["physicalAssessment"] is not None for row in rows.values()):
        before, after = (rows[name]["physicalAssessment"] for name in ["base", "candidate"])
        before_disconnected = set(before["nativeAssessment"]["unconnectedNets"])
        after_disconnected = set(after["nativeAssessment"]["unconnectedNets"])
        comparison = {"gainedNativeNames": sorted(before_disconnected - after_disconnected), "lostNativeNames": sorted(after_disconnected - before_disconnected), "newPhysicalFindings": sorted(set(after["canonicalPhysicalFindings"]) - set(before["canonicalPhysicalFindings"])), "resolvedPhysicalFindings": sorted(set(before["canonicalPhysicalFindings"]) - set(after["canonicalPhysicalFindings"]))}
    causal_pair = bool(both_reports and both_boundaries and known_base_failure)
    benefit_qualified = bool(causal_pair and rows["candidate"]["validatedPhaseCompletion"] and rows["candidate"].get("connectedComparedToPriorCopper", {}).get("gainedNativeNames"))
    result = {"scope": plan["purpose"], "diagnosticOnly": True, "wholeBoardGainClaim": False, "planSha256": sha((C / "a03-via-gate-screen-plan.json").read_bytes()), "runtimeVerifiedAfterBothLanes": True, "bothSourceBoundReportsQualified": both_reports, "bothOriginalUniformBoundariesQualified": both_boundaries, "knownBaselineFailureReproduced": known_base_failure, "causalPairInterpretable": causal_pair, "benefitQualified": benefit_qualified, "benefitScope": "Isolated native phase completion only; full-board qualification is still required", "baselineQualified": True, "rows": rows, "acceptedOutputComparison": comparison, "sourceCandidate": candidate, "sourceOverrideScope": "Direct sibling AR entry only; no package or Core integration is claimed"}
    (output / "comparison.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"outcomes": {name: row["outcome"] for name, row in rows.items()}, "benefitQualified": benefit_qualified, "wholeBoardGainClaim": False}))


if __name__ == "__main__":
    main()
