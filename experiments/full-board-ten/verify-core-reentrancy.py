#!/usr/bin/env python3
"""Compare actual published and candidate H616 copper and phase artifacts."""
import collections
import gzip
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
controller = Path(__file__).resolve().parent
plan = json.loads((controller / "core-reentrancy-plan.json").read_text())
before = root / "published-baseline"
after = root / "results/candidate/h616/original"
proof = root / "core-reentrancy"


def read(path):
    data = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
    return json.loads(data)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def geometry(circuit, kind):
    traces = {row["pcb_trace_id"]: row for row in circuit if row["type"] == "pcb_trace"}
    output = []
    for row in circuit:
        if row["type"] != kind:
            continue
        if kind == "pcb_trace":
            point_fields = ["route_type", "x", "y", "layer", "width", "from_layer", "to_layer", "via_diameter", "via_hole_diameter", "layers"]
            output.append({"net": row.get("connection_name"), "sourceTrace": row.get("source_trace_id"), "route": [{key: point[key] for key in point_fields if key in point} for point in row["route"]], "curvedSegments": row.get("curvedSegments")})
        else:
            owner = traces.get(row.get("pcb_trace_id"), {})
            fields = ["x", "y", "layers", "from_layer", "to_layer", "outer_diameter", "hole_diameter"]
            output.append({"net": owner.get("connection_name"), "sourceTrace": owner.get("source_trace_id"), **{key: row[key] for key in fields if key in row}})
    return collections.Counter(canonical(row) for row in output)


base_circuit = read(before / "circuit.json.gz")
candidate_circuit = read(after / "circuit.json.gz")
base_result, result = read(before / "result.json"), read(after / "result.json")
base_assessment, assessment = read(before / "assessment.json"), read(after / "assessment.json")
base_findings, findings = read(before / "findings.json.gz"), read(after / "findings.json.gz")
task = read(root / "cases/h616-original.json")
source = read(Path(task["sourcePath"]))
requested = {row["nativeName"] for row in source["nets"] if row["routable"]}
assert len(requested) == plan["case"]["requestedNets"]
base_connected = requested - {row["name"] for row in base_assessment["missingCopper"]}
connected = requested - {row["name"] for row in assessment["missingCopper"]}
phase_files = sorted(path.name for path in before.glob("phase-*.srj.json.gz"))
phase_equal = {name: gzip.decompress((before / name).read_bytes()) == gzip.decompress((after / name).read_bytes()) if (after / name).exists() else False for name in phase_files}
copper = {}
for kind in ["pcb_trace", "pcb_via"]:
    base_geometry, candidate_geometry = geometry(base_circuit, kind), geometry(candidate_circuit, kind)
    copper[kind] = {"baseline": sum(base_geometry.values()), "candidate": sum(candidate_geometry.values()), "removed": sum((base_geometry - candidate_geometry).values()), "added": sum((candidate_geometry - base_geometry).values()), "baselineGeometrySha256": hashlib.sha256(canonical(sorted(base_geometry.items())).encode()).hexdigest(), "candidateGeometrySha256": hashlib.sha256(canonical(sorted(candidate_geometry.items())).encode()).hexdigest()}
shared = ["overlap", "padTrace", "viaTrace", "viaPad", "viaSpacing", "contiguous", "viaInPad", "holeTrace"]
new_findings = {group: list((collections.Counter(map(canonical, findings[group])) - collections.Counter(map(canonical, base_findings[group]))).elements()) for group in shared}
base_groups = {(row["source_net_id"], row["layer"]) for row in base_circuit if row["type"] == "pcb_copper_pour"}
groups = {(row["source_net_id"], row["layer"]) for row in candidate_circuit if row["type"] == "pcb_copper_pour"}
worker_log = (after / "worker.log").read_text()
authored_types = {"pcb_board", "pcb_component", "pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_port", "source_component", "source_net", "source_trace", "source_port"}
authored_identical = collections.Counter(canonical(row) for row in base_circuit if row["type"] in authored_types) == collections.Counter(canonical(row) for row in candidate_circuit if row["type"] in authored_types)
report = {"phasePayloadsIdentical": phase_equal, "phaseFileSetIdentical": phase_files == sorted(path.name for path in after.glob("phase-*.srj.json.gz")), "unroutedCircuitIdentical": read(before / "unrouted.circuit.json.gz") == read(after / "unrouted.circuit.json.gz"), "acceptedCopper": copper, "baselineConnectedNames": sorted(base_connected), "connectedNames": sorted(connected), "lostConnectedNames": sorted(base_connected - connected), "newSharedFindings": new_findings, "baselinePourNetLayers": sorted(base_groups), "candidatePourNetLayers": sorted(groups), "correctRoutingErrorPhase": 'Async effect error in PcbTraceRender' in worker_log and 'Async effect error in SimulationSpiceEngineRender' not in worker_log, "limitsMs": {"capture": result["captureDeadlineMs"], "hard": result["hardDeadlineMs"], "assessment": task["assessmentDeadlineMs"]}, "viaPourAudit": str(proof / "native-via-pour-audit.json"), "scope": "One finished original H616 case. Timed-out cases may legitimately lose premature unsafe pour connectivity; all ten cases remain required before a global claim."}
report["finalAuthoredGeometryIdentical"] = authored_identical
audit = read(proof / "native-via-pour-audit.json")
report["nativeViaPourAudit"] = {"baselinePhysicalContacts": audit["baseline"]["physicalContactCount"], "candidatePhysicalContacts": audit["candidate"]["physicalContactCount"], "candidateNearContacts": audit["candidate"]["nearContactCount"], "baselineWholeDiskContacts": audit["baseline"]["wholeOuterDiskInsideForeignRegionCount"], "candidateClearanceDeficits": audit["candidate"]["clearanceDeficitCount"], "candidateMinimumCopperGapMm": audit["candidate"]["minimumCopperGapMm"], "passed": audit["comparison"]["candidatePhysicallyClear"]}
(proof / "native-comparison.json").write_text(json.dumps(report, indent=2) + "\n")
assert read(proof / "assessment-runtime-restored.json")["allPublishedFilesVerified"]
assert result["assessmentReady"] and result["completeSourceCounts"] and result["routingPolicyObserved"]
assert result["renderExitCode"] == 0 and result["auditExitCode"] == 0
assert result["wasmUsage"]["routingOrUnknownAttempts"] == 0
assert not result["hardTimedOut"] and not result["auditTimedOut"]
assert read(after / "progress.json")["renderCompleted"]
binding = read(after / "progress.json")["runtime"]["coreChunkBinding"]
assert binding["sha256"] == plan["runtimeChange"]["afterSha256"] and binding["mainAndCoreClassIdentical"] and binding["nativeBoardMethodIdentical"]
assert binding["viaStitchingEnabled"] is False
assert base_result["connectedNets"] == len(base_connected) == plan["expectedBaseline"]["connectedNets"]
assert result["connectedNets"] == len(connected) and base_connected <= connected
assert report["phaseFileSetIdentical"] and all(phase_equal.values())
assert report["unroutedCircuitIdentical"]
assert all(not row["removed"] and not row["added"] for row in copper.values()), "Accepted route geometry changed without enabled native stitching"
assert authored_identical
assert all(not rows for rows in new_findings.values()), "New shared physical findings"
assert base_groups == groups, "A native plane net/layer disappeared or changed"
assert report["correctRoutingErrorPhase"], "Native routing still registered under the wrong phase"
assert report["limitsMs"] == plan["limitsMs"]
assert audit["authoredSourceSha256"] == plan["case"]["sourceSha256"]
assert audit["baseline"]["valid"] and audit["candidate"]["valid"]
assert audit["baseline"]["wholeOuterDiskInsideForeignRegionCount"] == plan["expectedBaseline"]["wholeDiskForeignContacts"]
assert audit["baseline"]["physicalContactCount"] == plan["audit"]["expectedBaselinePhysicalContactCount"]
assert audit["baseline"]["uniqueContactViaGeometryCount"] == plan["audit"]["expectedBaselineAffectedViaGeometryCount"]
assert audit["comparison"]["candidatePhysicallyClear"] and audit["candidate"]["physicalContactCount"] == 0
assert audit["candidate"]["blockingContactCount"] == 0
assert audit["comparison"]["sameViaGeometryMultiset"] and not audit["comparison"]["missingForeignPourGroups"]
assert not audit["comparison"]["newPhysicalContactKeys"] and not audit["comparison"]["retainedPhysicalContactKeys"]
assert len(audit["comparison"]["resolvedPhysicalContactKeys"]) == audit["baseline"]["physicalContactCount"]
assert audit["baseline"]["circuitRawSha256"] == hashlib.sha256(gzip.decompress((before / "circuit.json.gz").read_bytes())).hexdigest()
assert audit["candidate"]["circuitRawSha256"] == hashlib.sha256(gzip.decompress((after / "circuit.json.gz").read_bytes())).hexdigest()
report["passed"] = True
(proof / "native-comparison.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
