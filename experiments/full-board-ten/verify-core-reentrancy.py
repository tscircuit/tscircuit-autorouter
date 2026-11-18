#!/usr/bin/env python3
"""Keep accepted routing, actual copper, native connectivity and pours distinct."""
import collections
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sys


def read(path):
    data = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
    return json.loads(data)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def geometry(circuit, kind, normalize_trace_route):
    traces = {row["pcb_trace_id"]: row for row in circuit if row["type"] == "pcb_trace"}
    output = []
    for row in circuit:
        if row["type"] != kind:
            continue
        if kind == "pcb_trace":
            # Retain all route fields, including through-pad coordinates/layers.
            output.append({"net": row.get("connection_name"), "sourceTrace": row.get("source_trace_id"), "route": normalize_trace_route(row, circuit), "routeThicknessMode": row.get("route_thickness_mode"), "curvedSegments": row.get("curvedSegments"), "connectsTo": row.get("connectsTo")})
        else:
            owner = traces.get(row.get("pcb_trace_id"), {})
            output.append({"net": owner.get("connection_name"), "sourceTrace": owner.get("source_trace_id"), **{key: value for key, value in row.items() if key not in ["pcb_via_id", "pcb_trace_id"]}})
    return collections.Counter(canonical(row) for row in output)


def process_state(result, progress):
    finished = result["renderExitCode"] == 0 and not result["hardTimedOut"] and progress["renderCompleted"] is True
    captured = result["renderExitCode"] == 124 and not result["hardTimedOut"] and progress["renderCompleted"] is False and progress["status"] == "capture_deadline"
    return {"renderCompleted": progress["renderCompleted"], "renderExitCode": result["renderExitCode"], "hardTimedOut": result["hardTimedOut"], "progressStatus": progress["status"], "renderSettled": result["renderSettled"], "finishedIncludingFailedRouting": finished, "softDeadlineCapture": captured, "validCaptureOrFinish": finished or captured}


def compare(root, board, cohort, report):
    controller = Path(__file__).resolve().parent
    plan = read(controller / "core-reentrancy-plan.json")
    case = next(row for row in plan["cases"] if row["key"] == f"{board}-{cohort}")
    before, after, proof = root / "published-baseline", root / "results/candidate" / board / cohort, root / "core-reentrancy"
    base_circuit, circuit = read(before / "circuit.json.gz"), read(after / "circuit.json.gz")
    base_result, result = read(before / "result.json"), read(after / "result.json")
    base_progress, progress = read(before / "progress.json"), read(after / "progress.json")
    base_assessment, assessment = read(before / "assessment.json"), read(after / "assessment.json")
    base_findings, findings = read(before / "findings.json.gz"), read(after / "findings.json.gz")
    task = read(root / "cases" / f"{board}-{cohort}.json")
    source = read(Path(task["sourcePath"]))
    requested = {row["nativeName"] for row in source["nets"] if row["routable"]} if cohort == "original" else {row["nativeNet"] for row in source["traces"] if len(row["path"]) > 1}
    missing = lambda value: {row["name"] for row in value["missingCopper"]} if cohort == "original" else set(value["unconnectedNets"])
    base_connected, connected = requested - missing(base_assessment), requested - missing(assessment)
    assert len(requested) == case["requestedNets"]
    assert len(base_connected) == base_result["connectedNets"] == case["expectedBaseline"]["connectedNets"]
    assert len(connected) == result["connectedNets"] == assessment["connectedNets"]
    assert missing(base_assessment) <= requested and missing(assessment) <= requested
    report["nativeConnectivity"] = {"requestedNets": len(requested), "baselineConnectedNames": sorted(base_connected), "candidateConnectedNames": sorted(connected), "lostConnectedNames": sorted(base_connected - connected), "addedConnectedNames": sorted(connected - base_connected), "preserved": base_connected <= connected}
    phase_files = sorted(path.name for path in before.glob("phase-*.srj.json.gz"))
    candidate_phases = sorted(path.name for path in after.glob("phase-*.srj.json.gz"))
    phase_equal = {name: gzip.decompress((before / name).read_bytes()) == gzip.decompress((after / name).read_bytes()) if (after / name).exists() else False for name in phase_files}
    outputs = [name for name in phase_files if "-output." in name]
    report["acceptedPhaseSrj"] = {"baselineCompletedPhases": [{"index": row["index"], "name": row["name"]} for row in base_progress["phases"] if row["status"] == "completed"], "candidateCompletedPhases": [{"index": row["index"], "name": row["name"]} for row in progress["phases"] if row["status"] == "completed"], "baselineOutputFiles": outputs, "payloadsIdentical": {name: phase_equal[name] for name in outputs}, "allBaselineOutputsPreserved": all(phase_equal[name] for name in outputs)}
    report["allPhaseSrj"] = {"payloadsIdentical": phase_equal, "fileSetIdentical": phase_files == candidate_phases, "addedFiles": sorted(set(candidate_phases) - set(phase_files)), "missingFiles": sorted(set(phase_files) - set(candidate_phases))}
    materialization_path = controller / "core-reentrancy-materialization.py"
    spec = importlib.util.spec_from_file_location("materialization", materialization_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    copper = {}
    for kind in ["pcb_trace", "pcb_via"]:
        old, new = geometry(base_circuit, kind, module.normalize_emitted_trace_route), geometry(circuit, kind, module.normalize_emitted_trace_route)
        copper[kind] = {"baseline": old.total(), "candidate": new.total(), "removed": (old - new).total(), "added": (new - old).total(), "baselineGeometrySha256": digest(sorted(old.items())), "candidateGeometrySha256": digest(sorted(new.items()))}
    report["finalCopperGeometry"] = copper
    report["finalTraceRecordMultisetIdentical"] = collections.Counter(canonical(row) for row in base_circuit if row["type"] == "pcb_trace") == collections.Counter(canonical(row) for row in circuit if row["type"] == "pcb_trace")
    report["finalCopperComparisonScope"] = "Full physical route fields, through-pad geometry, thickness mode and curvedSegments; endpoint port and pour-membership annotations are separately validated and reported by materialization evidence. Raw trace records need not be identical."
    report["acceptedPhaseMaterialization"] = {"baseline": module.analyze_materialization(before, authored_pours=cohort == "original"), "candidate": module.analyze_materialization(after, authored_pours=cohort == "original")}
    shared = [("overlap", "trace_overlap"), ("padTrace", "pad_trace"), ("viaTrace", "via_trace"), ("viaPad", "via_pad"), ("viaSpacing", "via_spacing"), ("contiguous", "contiguous"), ("viaInPad", "via_in_pad"), ("holeTrace", "hole_trace")]
    report["newSharedFindings"] = {original: list((collections.Counter(map(canonical, findings[original if cohort == "original" else spaced])) - collections.Counter(map(canonical, base_findings[original if cohort == "original" else spaced]))).elements()) for original, spaced in shared}
    authored_types = {"pcb_board", "pcb_component", "pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_port", "source_component", "source_net", "source_trace", "source_port"}
    report["finalAuthoredGeometryIdentical"] = collections.Counter(canonical(row) for row in base_circuit if row["type"] in authored_types) == collections.Counter(canonical(row) for row in circuit if row["type"] in authored_types)
    base_initial, candidate_initial = read(before / "unrouted.circuit.json.gz"), read(after / "unrouted.circuit.json.gz")
    report["unroutedCircuitArrayIdentical"] = base_initial == candidate_initial
    report["unroutedCircuitRecordMultisetIdentical"] = collections.Counter(map(canonical, base_initial)) == collections.Counter(map(canonical, candidate_initial))
    report["process"] = {"baseline": process_state(base_result, base_progress), "candidate": process_state(result, progress), "note": "renderCompleted plus exit status distinguishes finished routing failures from timed captures; renderSettled alone does not."}
    binding = progress["runtime"]["coreChunkBinding"]
    restored = read(proof / "assessment-runtime-restored.json")
    report["runtimeGuards"] = {"publishedCoreRestoredBeforeAssessment": restored["allPublishedFilesVerified"] and restored["publishedAliasesRestored"], "mainAndCoreClassIdentical": binding["mainAndCoreClassIdentical"], "nativeRenderMethodIdentical": binding["nativeRenderMethodIdentical"], "nativeBoardMethodIdentical": binding["nativeBoardMethodIdentical"], "nativeGroupMethodIdentical": binding["nativeGroupMethodIdentical"], "nativePourMethodsIdentical": binding["nativePourMethodsIdentical"], "reviewedFiles": binding["reviewedFiles"], "chunkSha256": binding["sha256"], "noRoutingWasm": result["wasmUsage"]["routingOrUnknownAttempts"] == 0 and progress["forbiddenRoutingSolverSelections"] == [], "viaStitchingDisabled": binding["viaStitchingEnabled"] is False, "sourceSha256": progress["sourceSha256"]}
    assert progress["sourceSha256"] == case["sourceSha256"] == task["sourceSha256"]
    assert hashlib.sha256(Path(task["sourcePath"]).read_bytes()).hexdigest() == task["sourceSha256"]
    assert [result["captureDeadlineMs"], result["hardDeadlineMs"], task["assessmentDeadlineMs"]] == [plan["limitsMs"][key] for key in ["capture", "hard", "assessment"]]
    assert all(report["runtimeGuards"][key] for key in ["publishedCoreRestoredBeforeAssessment", "mainAndCoreClassIdentical", "nativeRenderMethodIdentical", "nativeBoardMethodIdentical", "nativeGroupMethodIdentical", "nativePourMethodsIdentical", "noRoutingWasm", "viaStitchingDisabled"])
    assert {row["path"]: row["sha256"] for row in binding["reviewedFiles"]} == {row["path"]: row["afterSha256"] for row in plan["runtimeChanges"]}
    assert result["assessmentReady"] and result["completeSourceCounts"] and result["routingPolicyObserved"]
    assert result["auditExitCode"] == 0 and not result["auditTimedOut"]
    for kind, key in [("pcb_trace", "traces"), ("pcb_via", "vias")]:
        assert copper[kind]["baseline"] == case["expectedBaseline"][key]
    worker_log = (after / "worker.log").read_text()
    report["routingErrorRegisteredUnderWrongPhase"] = 'Async effect error in SimulationSpiceEngineRender' in worker_log
    report["routingErrorRegisteredUnderTracePhase"] = 'Async effect error in PcbTraceRender' in worker_log
    final_copper_equal = all(not row["removed"] and not row["added"] for row in copper.values())
    phase_equal_all = report["allPhaseSrj"]["fileSetIdentical"] and all(phase_equal.values())
    report["acceptedRoutingAndFinalCopperPreserved"] = phase_equal_all and final_copper_equal
    base_pours = [row for row in base_circuit if row["type"] == "pcb_copper_pour"]
    pours = [row for row in circuit if row["type"] == "pcb_copper_pour"]
    base_groups = {(row["source_net_id"], row["layer"]) for row in base_pours}
    groups = {(row["source_net_id"], row["layer"]) for row in pours}
    assert len(base_pours) == case["expectedBaseline"]["pours"]
    pour_geometry = lambda rows: collections.Counter(canonical({key: value for key, value in row.items() if key != "pcb_copper_pour_id"}) for row in rows)
    pour_geometry_unchanged = pour_geometry(base_pours) == pour_geometry(pours)
    report["pours"] = {"authored": cohort == "original", "baselineCount": len(base_pours), "candidateCount": len(pours), "baselineNetLayers": sorted(base_groups), "candidateNetLayers": sorted(groups), "missingNetLayers": sorted(base_groups - groups), "addedNetLayers": sorted(groups - base_groups), "baselineGroupsPreserved": base_groups <= groups, "geometryMultisetIdentical": pour_geometry_unchanged, "removedPoursCountAsRepairedContacts": False, "classification": "missing_groups" if base_groups - groups else "preserved_with_added_groups" if groups - base_groups else "preserved_groups", "captureLifecycle": "preview_while_routing_pending" if report["process"]["candidate"]["softDeadlineCapture"] else "routing_finished"}
    physical_gate = True
    report["absolutePhysicalAuditCoverageComplete"] = True
    if cohort == "original":
        audit = read(proof / "native-via-pour-audit.json")
        if audit.get("fatalError"):
            exact_geometry_preserved = final_copper_equal and pour_geometry_unchanged and report["finalAuthoredGeometryIdentical"]
            known_mixed_zone_limit = board == "imx6" and audit["fatalError"] == "Ambiguous authored pour clearances for net/layer"
            physical_gate = known_mixed_zone_limit and exact_geometry_preserved
            report["absolutePhysicalAuditCoverageComplete"] = False
            report["viaPourAudit"] = {"coverageComplete": False, "limitation": audit["fatalError"], "exactRelevantCopperGeometryPreserved": exact_geometry_preserved, "noPhysicalRegressionByGeometryIdentity": physical_gate, "absoluteClearanceOrContactClaimPermitted": False, "note": "The unchanged native geometry can establish preservation despite the auditor's mixed-zone limitation; no absolute physical-clearance or repaired-contact claim is made."}
        else:
            assert audit["authoredSourceSha256"] == case["sourceSha256"]
            assert audit["baseline"]["valid"] and audit["candidate"]["valid"]
            for lane, folder in [("baseline", before), ("candidate", after)]:
                assert audit[lane]["circuitRawSha256"] == hashlib.sha256(gzip.decompress((folder / "circuit.json.gz").read_bytes())).hexdigest()
            report["viaPourAudit"] = {"coverageComplete": True, "baselinePhysicalContacts": audit["baseline"]["physicalContactCount"], "candidatePhysicalContacts": audit["candidate"]["physicalContactCount"], "candidateNearContacts": audit["candidate"]["nearContactCount"], "candidateClearanceDeficits": audit["candidate"]["clearanceDeficitCount"], "candidateMinimumCopperGapMm": audit["candidate"]["minimumCopperGapMm"], "requiredAuthoredPourClearanceMm": plan["audit"]["requiredAuthoredPourClearanceMm"], "newPhysicalContactKeys": audit["comparison"]["newPhysicalContactKeys"], "retainedPhysicalContactKeys": audit["comparison"]["retainedPhysicalContactKeys"], "disappearedContactKeys": audit["comparison"]["resolvedPhysicalContactKeys"], "missingForeignPourGroups": audit["comparison"]["missingForeignPourGroups"], "candidatePhysicallyClearWithPreservedGeometry": audit["comparison"]["candidatePhysicallyClear"], "note": "Disappeared contacts are not repairs when pours or vias are absent; positive-gap authored clearance deficits are reported separately."}
            physical_gate = not audit["comparison"]["newPhysicalContactKeys"] and not audit["comparison"]["newNearContactKeys"]
            if case.get("nativeContactGate"):
                target = case["nativeContactGate"]
                assert audit["baseline"]["physicalContactCount"] == target["baselinePhysicalContacts"]
                assert audit["baseline"]["uniqueContactViaGeometryCount"] == target["baselineAffectedViaGeometry"]
                assert audit["baseline"]["wholeOuterDiskInsideForeignRegionCount"] == target["baselineWholeDiskContacts"]
                physical_gate = physical_gate and audit["comparison"]["candidatePhysicallyClear"] and audit["candidate"]["physicalContactCount"] == target["candidatePhysicalContacts"]
                assert copper["pcb_trace"]["baseline"] == target["acceptedTraces"] and copper["pcb_via"]["baseline"] == target["acceptedVias"]
    else:
        assert not base_pours and not pours, "Spaced cohort unexpectedly contains authored pours"
        report["viaPourAudit"] = {"applicable": False, "reason": "Authentic spaced source has no authored copper pours."}
    registration_correct = not report["routingErrorRegisteredUnderWrongPhase"] and (not report["process"]["candidate"]["finishedIncludingFailedRouting"] or not any(row["status"] == "failed" for row in progress["phases"]) or report["routingErrorRegisteredUnderTracePhase"])
    report["gates"] = {"runtimeAndAssessment": True, "validProcessOutcome": report["process"]["candidate"]["validCaptureOrFinish"], "finishedBaselineRemainsFinished": not report["process"]["baseline"]["finishedIncludingFailedRouting"] or report["process"]["candidate"]["finishedIncludingFailedRouting"], "acceptedSrjAndFinalCopperPreserved": report["acceptedRoutingAndFinalCopperPreserved"], "authoredGeometryPreserved": report["finalAuthoredGeometryIdentical"] and report["unroutedCircuitRecordMultisetIdentical"], "noNewSharedFindings": all(not rows for rows in report["newSharedFindings"].values()), "nativeConnectedNamesPreserved": report["nativeConnectivity"]["preserved"], "physicalContactGate": physical_gate, "correctErrorRegistration": registration_correct, "baselinePourGroupsPreserved": base_groups <= groups}
    report["qualified"] = all(report["gates"].values())
    report["finalSourceBuildPreviewEquivalence"] = plan["finalSourceBuildPreviewEquivalence"]
    report["globalClaimPermitted"] = False
    report["scope"] = "One authentic H616 original case for the simplified render guard. No ten-case or interim-preview preservation claim. Exact accepted SRJ, emitted trace/via materialization, native connectivity and physical pour contacts remain separate claims."


def main():
    root, board, cohort = Path(sys.argv[1]).resolve(), sys.argv[2], sys.argv[3]
    output = root / "core-reentrancy/native-comparison.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    report = {"case": f"{board}-{cohort}", "qualified": False, "globalClaimPermitted": False}
    try:
        compare(root, board, cohort, report)
    except Exception as error:
        report["verificationError"] = f"{type(error).__name__}: {error}"
        output.write_text(json.dumps(report, indent=2) + "\n")
        raise
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"case": report["case"], "qualified": report["qualified"], "gates": report["gates"], "lostConnectedNames": report["nativeConnectivity"]["lostConnectedNames"], "pours": report["pours"]}))
    raise SystemExit(0 if report["qualified"] else 1)


if __name__ == "__main__":
    main()
