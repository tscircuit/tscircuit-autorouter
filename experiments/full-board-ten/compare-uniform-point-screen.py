"""Compare a bounded causal intervention without inferring whole-board gain."""
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
    spec = importlib.util.spec_from_file_location("prepare", C / "prepare-uniform-point-screen.py")
    prep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prep)
    plan = prep.verified_plan()
    inputs, output = map(lambda path: Path(path).resolve(), sys.argv[1:])
    prep.verify_runtime(plan, inputs)
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
            rows[variant] = {"outcome": "external_interruption_without_final_report", "acceptedOutput": False, "physicalAssessment": None}
            continue
        report = json.loads(report_path.read_text())
        reports[variant] = report
        require(report["variant"] == variant and report["planSha256"] == sha((C / "uniform-point-screen-plan.json").read_bytes()), "Runner plan or lane mismatch")
        require(report["inputSha256"] == case["files"]["phase-4-input.srj.json.gz"]["payloadSha256"], "Runner native input mismatch")
        require(report["inputCompressedSha256"] == case["files"]["phase-4-input.srj.json.gz"]["sha256"], "Compressed input mismatch")
        require(report["initialInputCanonicalSha256"] == report["finalInputCanonicalSha256"], "Native SRJ mutated")
        require(report["inputFileUnchanged"] and report["autorouterEntryUnchanged"], "Native file/runtime mutated")
        require(report["autorouterEntrySha256"] == next(p["entrySha256"] for p in plan["packages"] if p["name"] == "@tscircuit/capacity-autorouter"), "Not the published autorouter")
        require(report["pointMapSha256"] == plan["pointMapSha256"] and report["captureDeadlineMs"] == 900000 and report["hardDeadlineSeconds"] == 960, "Intervention/deadline changed")
        require(report["suppliedOptions"] == {"cacheProvider": None} and report["undefinedOptionKeys"] == plan["undefinedOptionKeys"], "Native options changed")
        require(not report["thrownError"] and not report["wasmAttempts"] and exit_code == 0, "Runner/observer error")
        intervention = report["intervention"]
        if intervention is not None:
            require(intervention == json.loads((lane / "intervention.json").read_text()), "Intervention report mismatch")
            require(intervention["applied"] == (variant == "candidate"), "Wrong lane intervention")
            require(intervention["changedUniquePortIds"] == (2 if variant == "candidate" else 0) and intervention["changedOwnerPortRecords"] == (4 if variant == "candidate" else 0), "Unexpected point changes")
            for flag in ["exactCoordinateDiffVerified", "nativeInputsUnchanged", "ownerFamilyMapUnchanged", "originalCoarsePointsUnchanged", "allOtherNodeAndPairDataUnchanged", "appliedBeforeHdConstruction"]:
                require(intervention[flag] is True, "Intervention failed invariant " + flag)
            require(intervention["beforeFamiliesSha256"] == intervention["afterFamiliesSha256"], "Owner-family data changed")
            require((intervention["beforeNodesSha256"] != intervention["afterNodesSha256"]) == (variant == "candidate"), "Wrong node diff")
        accepted = report["solved"] and not report["failed"] and not report["timedOut"] and bool(report["outputSha256"])
        if accepted:
            require(intervention is not None, "Accepted output without boundary capture")
            require(sha(gzip.decompress((lane / "phase-output.srj.json.gz").read_bytes())) == report["outputSha256"], "Accepted output changed")
            require(int((lane / "assessment-exit-code.txt").read_text()) == 0, "Accepted-output assessment failed")
            assessed = json.loads((lane / "physical-assessment.json").read_text())
            require(assessed["performed"] and assessed["phaseSolved"] and assessed["acceptedOutputSha256"] == report["outputSha256"], "Assessment output binding failed")
            require(assessed["originalGeometryPreserved"] and assessed["immutableDdrTraces"] == 16 and assessed["immutableDdrVias"] == 32, "Assessment geometry changed")
            require(assessed["allNativeDemands"] == 109 and assessed["activeRequested"] == 56 and assessed["priorRequested"] == 53, "Native demand scope changed")
        else:
            require(not (lane / "phase-output.srj.json.gz").exists(), "Provisional output masquerades as accepted")
            assessed = None
        rows[variant] = {"outcome": "accepted_phase_output" if accepted else "diagnostic_deadline" if report["timedOut"] else "pipeline_failed", "acceptedOutput": bool(accepted), "activePhase": report["activePhase"], "error": report["error"], "interventionCaptured": intervention is not None, "physicalAssessment": assessed}
    both_boundaries = all(name in reports and reports[name]["intervention"] for name in ["base", "candidate"])
    if both_boundaries:
        for field in ["beforeNodesSha256", "beforeFamiliesSha256", "pointMapSha256"]:
            require(reports["base"]["intervention"][field] == reports["candidate"]["intervention"][field], "Lanes did not start from the same Uniform boundary")
        require(reports["base"]["effectiveOptions"] == reports["candidate"]["effectiveOptions"] and reports["base"]["effectiveEffort"] == reports["candidate"]["effectiveEffort"], "Effective solver settings differ")
    base_report = reports.get("base")
    known_base_failure = bool(base_report and base_report["failed"] and not base_report["solved"] and not base_report["timedOut"] and base_report["error"] == plan["expectedPublishedFailure"]["pipelineError"])
    for row in rows.values():
        assessed = row["physicalAssessment"]
        if assessed:
            current_unconnected = set(assessed["nativeAssessment"]["unconnectedNets"])
            old_unconnected = set(recorded["unconnectedNets"])
            row["connectedComparedToPriorCopper"] = {"gainedNativeNames": sorted(old_unconnected - current_unconnected), "lostNativeNames": sorted(current_unconnected - old_unconnected)}
    comparison = None
    if all(row["physicalAssessment"] is not None for row in rows.values()):
        before, after = (rows[name]["physicalAssessment"] for name in ["base", "candidate"])
        before_disconnected = set(before["nativeAssessment"]["unconnectedNets"])
        after_disconnected = set(after["nativeAssessment"]["unconnectedNets"])
        comparison = {"gainedNativeNames": sorted(before_disconnected - after_disconnected), "lostNativeNames": sorted(after_disconnected - before_disconnected), "newPhysicalFindings": sorted(set(after["canonicalPhysicalFindings"]) - set(before["canonicalPhysicalFindings"])), "resolvedPhysicalFindings": sorted(set(before["canonicalPhysicalFindings"]) - set(after["canonicalPhysicalFindings"]))}
    result = {"scope": plan["purpose"], "diagnosticOnly": True, "wholeBoardGainClaim": False, "planSha256": sha((C / "uniform-point-screen-plan.json").read_bytes()), "runtimeVerifiedAfterBothLanes": True, "bothBoundaryProofsQualified": bool(both_boundaries), "knownBaselineFailureReproduced": known_base_failure, "causalPairInterpretable": bool(both_boundaries and known_base_failure), "baselineQualified": True, "rows": rows, "acceptedOutputComparison": comparison, "runtimeCaveat": plan["assessment"]["source116Caveat"]}
    (output / "comparison.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"outcomes": {name: row["outcome"] for name, row in rows.items()}, "wholeBoardGainClaim": False}))


if __name__ == "__main__":
    main()
