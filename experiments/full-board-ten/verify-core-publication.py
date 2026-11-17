#!/usr/bin/env python3
"""Require added legal native completion against the authenticated published run."""

import argparse
from collections import Counter
import gzip
import hashlib
import json
import importlib.util
from pathlib import Path
import re
import sys


CONTROLLER = Path(__file__).resolve().parent
PHASE_FILES = tuple(
    name for index in range(1, 5)
    for name in ([f"phase-{index}-input.srj.json.gz", f"phase-{index}-output.srj.json.gz"]
                 if index < 4 else ["phase-4-input.srj.json.gz", "phase-4-error.srj.json.gz"])
)
COPPER = {"pcb_trace", "pcb_via", "pcb_copper_pour"}
SHARED = {
    "overlap": "trace_overlap", "padTrace": "pad_trace",
    "viaTrace": "via_trace", "viaPad": "via_pad",
    "viaSpacing": "via_spacing", "contiguous": "contiguous",
    "viaInPad": "via_in_pad", "holeTrace": "hole_trace",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_bytes(path):
    data = Path(path).read_bytes()
    return gzip.decompress(data) if str(path).endswith(".gz") else data


def read_json(path):
    return json.loads(read_bytes(path))


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def rows(value):
    return Counter(canonical(row) for row in value)


def without(value, keys):
    return {key: item for key, item in value.items() if key not in keys}


def fingerprint_files(items):
    """Only relocatable path prefixes differ between the two Actions runs."""
    return Counter((Path(item["path"]).name, item["sha256"]) for item in items)


def load_run(path):
    return {
        name: read_json(path / filename) for name, filename in {
            "result": "result.json", "progress": "progress.json",
            "process": "process.json", "assessment": "assessment.json",
            "findings": "findings.json.gz", "circuit": "circuit.json.gz",
            "unrouted": "unrouted.circuit.json.gz",
        }.items()
    }


def verify_provenance(root, plan, lane):
    path = root / "core-source-pair/provenance.json"
    proof = read_json(path)
    require(proof["passed"] is True, "Source build qualification did not pass")
    require(proof["sourceCommit"] == plan["corePrepublishBuildCommit"], "Wrong Core source commit")
    require(re.fullmatch(r"[0-9a-f]{64}", proof["productionPatchSha256"]), "Missing patch hash")
    require(proof["productionPatchSha256"] == plan["productionPatchSha256"], "Reviewed production patch changed")
    require(re.fullmatch(r"[0-9a-f]{64}", proof["sharedLockSha256"]), "Missing shared lock hash")
    require(digest(root / "core-source-pair/bun.lock") == proof["sharedLockSha256"], "Shared source lock changed")
    require(proof["unchangedDependencyGraph"] is True, "Source pair dependency drift")
    require(proof["publishedModuleAudit"]["passed"] is True, "Published module audit failed")
    require(proof["publishedModuleAudit"]["entirePublishedSourceClosureKnown"] is False,
            "Do not claim reconstruction of the unknown published build closure")
    for key in ("baselineExpectedFailure", "candidatePassed", "existingTestsPassed", "fullTypeScriptPassed"):
        require(proof["sourceTestGate"][key] is True, f"Source test gate failed: {key}")
    require(set(proof["productionFiles"]) == set(plan["productionFiles"]), "Production file scope changed")
    for name, expected in plan["productionFiles"].items():
        actual = proof["productionFiles"][name]
        require(actual["beforeSha256"] == expected["beforeSha256"], f"Wrong source base: {name}")
        require(re.fullmatch(r"[0-9a-f]{64}", actual["afterSha256"])
                and actual["afterSha256"] != actual["beforeSha256"], f"Missing source delta: {name}")
        require(actual["afterSha256"] == expected["afterSha256"], f"Reviewed source delta changed: {name}")
    for item in read_json(CONTROLLER / "harness-provenance.json")["files"]:
        require(proof["frozenHarnessFiles"].get(item["name"]) == item["sha256"],
                f"Original harness hash not retained: {item['name']}")
    for relative, expected in proof["frozenHarnessFiles"].items():
        require(digest(CONTROLLER / relative) == expected, f"Harness changed: {relative}")
    for name, expected in proof["frozenAssessorFiles"].items():
        require(digest(name) == expected, f"Neutral assessor changed: {name}")
    for item in proof["entries"].values():
        require(digest(item["path"]) == item["sha256"], "Compiled Core entry changed")
        require(item["jsFiles"], "Missing compiled JS graph")
        for chunk in item["jsFiles"]:
            require(digest(Path(item["path"]).parent / chunk["path"]) == chunk["sha256"],
                    "Compiled Core chunk changed")
    overlay = read_json(root / f"core-source-pair/{lane}-overlay.json")
    for key in ("originalPackagesVerified", "onlyCoreOverridden", "assessmentFilesUnchanged"):
        require(overlay[key] is True, f"Overlay gate failed: {key}")
    require(overlay["sourceProofSha256"] == digest(path), "Overlay source proof changed")
    return proof


def verify_run(run, baseline, task, proof, plan, lane):
    result, progress, process = (run[key] for key in ("result", "progress", "process"))
    expected = baseline["progress"]
    for key in ("id", "cohort", "mode", "fanout", "planes", "executionMode",
                "expectedComponents", "expectedPads", "expectedNativeNets", "expectedNets",
                "expectedRoutableNets", "expectedGroups", "sourceSha256", "initialCopperCounts",
                "planeIntent", "coarseRoutingInstrumentation"):
        require(progress[key] == expected[key], f"Source/policy changed: {key}")
    for key in ("implementationFiles", "assessmentSourceFiles"):
        require(fingerprint_files(progress[key]) == fingerprint_files(expected[key]), f"Changed {key}")
        require(progress[key] == task[key], f"Case/progress mismatch: {key}")
        for item in task[key]:
            require(digest(item["path"]) == item["sha256"], f"Input source changed: {item['path']}")
            if key == "assessmentSourceFiles":
                require(proof["frozenAssessorFiles"].get(item["path"]) == item["sha256"],
                        "Assessor absent from build proof")
    require(digest(task["sourcePath"]) == plan["case"]["sourceSha256"], "Authoritative board source changed")
    for key, limit in (("captureDeadlineMs", "capture"), ("hardDeadlineMs", "hard"),
                       ("assessmentDeadlineMs", "assessment")):
        require(task[key] == progress[key] == plan["limitsMs"][limit], f"Budget changed: {key}")
    for key in ("captureDeadlineMs", "hardDeadlineMs"):
        require(result[key] == process[key] == progress[key], f"Process budget mismatch: {key}")
    for key in ("renderExitCode", "hardTimedOut", "executionMode", "memoryCap"):
        require(result[key] == process[key] == baseline["process"][key], f"Process policy/outcome changed: {key}")
    require(result["auditExitCode"] == 0 and result["auditTimedOut"] is False
            and result["assessmentReady"] is True, "Neutral assessment incomplete")
    require(result["routingPolicyObserved"] is True, "Routing policy check failed")
    require(progress["forbiddenRoutingSolverSelections"] == [], "Forbidden routing solver selected")
    require(progress["wasmUsage"]["routingOrUnknownAttempts"] == 0, "Routing used WASM")
    require(progress["wasmUsage"]["geometryCalls"] == 0, "Unexpected geometry WASM call")
    require(result["wasmUsage"] == progress["wasmUsage"], "WASM evidence disagrees")
    require(progress["dependencyOverrides"] == result["dependencyOverrides"] == task["dependencyOverrides"],
            "Case dependency override metadata disagrees")
    require(all(item["name"] == "@tscircuit/core" for item in task["dependencyOverrides"]),
            "Only Core may be overridden")
    require(result["completeAndClean"] is False, "Failed phase must not claim whole-board completion")
    require(progress["errors"] == expected["errors"], "Original failure changed or a new error occurred")
    require(progress["status"] == "failed" and progress["renderCompleted"] is True,
            "Successful continuation must settle while retaining the earlier failure")
    require(len(progress["phases"]) == len(expected["phases"]) + 1, "Expected exactly one additional power phase")
    timing = {"startedMs", "elapsedMs", "progress", "iterationsPerSecond"}
    for actual, previous in zip(progress["phases"], expected["phases"]):
        require(without(actual, timing) == without(previous, timing), "Native prefix phase state changed")
    power = progress["phases"][-1]
    require(power["name"] == "power" and power["index"] == 5 and power["status"] == "completed"
            and power["connections"] == 12 and power["terminals"] == 341,
            "Starting power is not sufficient: the unchanged full phase must complete")
    require([without(item, {"startedMs", "elapsedMs"}) for item in progress["solvers"][:-1]] ==
            [without(item, {"startedMs", "elapsedMs"}) for item in expected["solvers"]],
            "Native solver prefix changed")
    require(progress["solvers"][-1]["name"] == power["solver"], "Unexpected additional solver")
    packages = {item["name"]: item for item in progress["runtime"]["packages"]}
    prior_packages = {item["name"]: item for item in expected["runtime"]["packages"]}
    require(packages.keys() == prior_packages.keys(), "Runtime package set changed")
    for name, previous in prior_packages.items():
        require(packages[name]["version"] == previous["version"], f"Runtime version changed: {name}")
        wanted = proof["entries"][lane]["sha256"] if name == "@tscircuit/core" else previous["entrySha256"]
        require(packages[name]["entrySha256"] == wanted, f"Wrong runtime entry: {name}")
        require(digest(packages[name]["entry"]) == wanted, f"Runtime file changed: {name}")
    for key in ("routingSourceOverride", "cacheEngine"):
        require(progress["runtime"][key] is False, f"Runtime policy changed: {key}")


def verify_assessment(run, requested):
    assessment, result, circuit = (run[key] for key in ("assessment", "result", "circuit"))
    unconnected = assessment["unconnectedNets"]
    require(len(unconnected) == len(set(unconnected)) and set(unconnected) <= requested,
            "Invalid named connectivity assessment")
    connected = requested - set(unconnected)
    require(assessment["requestedNets"] == result["requestedRoutableNets"] == len(requested)
            and assessment["connectedNets"] == result["connectedNets"] == len(connected),
            "Named connectivity disagrees with reported counts")
    require(assessment["geometryErrors"] == [] and result["geometryErrorCount"] == 0,
            "Physical source geometry errors")
    counts = Counter(row["type"] for row in circuit)
    for kind, count in result["emittedCounts"].items():
        require(counts[kind] == count, f"Emitted count mismatch: {kind}")
    require(assessment["pcbTraces"] == counts["pcb_trace"] and assessment["vias"] == counts["pcb_via"],
            "Assessor copper counts disagree with saved CircuitJSON")
    require(result["completeSourceCounts"] is True and result["assessmentProfile"] == "spaced_eleven_groups",
            "Source membership/assessment profile changed")
    require(set(run["findings"]) == set(assessment["findings"]), "Finding groups disagree")
    for group, values in run["findings"].items():
        count = sum(item["type"].endswith("_error") for item in values)
        require(count == assessment["findings"][group], f"Finding count disagrees: {group}")
    require(result["listedFindingCount"] == sum(assessment["findings"].values()), "Finding total disagrees")
    require(result["sharedDrcByGroup"] == {key: assessment["findings"][value] for key, value in SHARED.items()},
            "Shared physical assessment disagrees")
    require(result["sharedDrcErrorCount"] == sum(result["sharedDrcByGroup"].values()), "Shared DRC total disagrees")
    for kind in COPPER:
        ids = [row[f"{kind}_id"] for row in circuit if row["type"] == kind]
        require(len(ids) == len(set(ids)), f"Duplicate {kind} IDs")
    return connected


def physical_route(route):
    """Exact physical points, permitting Core's documented route reversal."""
    points = []
    for point in route:
        kind = point["route_type"]
        require(kind in {"wire", "via"}, "Unexpected route primitive; review its materialization")
        keys = ("x", "y", "layer", "width") if kind == "wire" else (
            "x", "y", "via_diameter", "via_hole_diameter", "outer_diameter", "hole_diameter")
        item = {key: point[key] for key in keys if key in point}
        item["route_type"] = kind
        if kind == "via":
            item["transition"] = sorted((point["from_layer"], point["to_layer"]))
        points.append(item)
    return min(canonical(points), canonical(list(reversed(points))))


def verify_materialization(run, accepted, power_ids, physical):
    """Every added copper row must come from the accepted native power result."""
    traces = {row["pcb_trace_id"]: row for row in run["circuit"] if row["type"] == "pcb_trace"}
    added = set(physical["addedTraceIds"])
    expected_rows = [row for row in accepted["traces"] if row["connection_name"] in power_ids]
    expected = {row["pcb_trace_id"]: row for row in expected_rows}
    require(len(expected) == len(expected_rows) and expected.keys() == added and added,
            "Added trace IDs differ from accepted power output")
    source_traces = {row["source_trace_id"]: row for row in run["circuit"] if row["type"] == "source_trace"}
    expected_vias = set()
    trace_transitions = {}
    physical_layers = ("top", "inner1", "inner2", "bottom")
    for trace_id, previous in expected.items():
        trace, owner = traces[trace_id], previous["connection_name"]
        source_id = trace["source_trace_id"]
        owners = {source_id} if source_id in power_ids else set(source_traces[source_id]["connected_source_net_ids"])
        require(owners == {owner}, f"Added trace has a different net owner: {trace_id}")
        require(physical_route(trace["route"]) == physical_route(previous["route"]), f"Accepted power route changed: {trace_id}")
        trace_transitions[trace_id] = set()
        for point in previous["route"]:
            if point["route_type"] == "via":
                geometry = (point["x"], point["y"], point["via_hole_diameter"], point["via_diameter"])
                # Core emits one physical same-net hole shared by multiple branches.
                expected_vias.add((owner, *geometry, physical_layers))
                trace_transitions[trace_id].add((*geometry, tuple(sorted((point["from_layer"], point["to_layer"])))))
    actual_vias = []
    for via in (row for row in run["circuit"] if row["type"] == "pcb_via" and row["pcb_via_id"] in physical["addedViaIds"]):
        require(via["pcb_trace_id"] in added, "Added via has no accepted power trace owner")
        require(tuple(via["layers"]) == physical_layers, "Unexpected physical via span")
        trace_id = via["pcb_trace_id"]
        geometry = (via["x"], via["y"], via["hole_diameter"], via["outer_diameter"])
        transition = (*geometry, tuple(sorted((via["from_layer"], via["to_layer"]))))
        require(transition in trace_transitions[trace_id], "Via owner does not contain its exact transition")
        actual_vias.append((expected[trace_id]["connection_name"], *geometry, physical_layers))
    require(len(actual_vias) == len(set(actual_vias)) and set(actual_vias) == expected_vias,
            "Added physical vias differ from accepted power routes")
    return {"acceptedPowerTraces": len(added), "acceptedPowerVias": len(actual_vias)}


def qualify(root, plan, baseline):
    lane = "candidate"
    proof = verify_provenance(root, plan, lane)
    path = root / "results/candidate/h616/spaced"
    run = load_run(path)
    task = read_json(root / "cases/candidate-h616-spaced.json")
    verify_run(run, baseline, task, proof, plan, lane)
    native_source = read_json(task["sourcePath"])
    requested_traces = [trace for trace in native_source["traces"] if len(trace["path"]) > 1]
    requested = {trace["nativeNet"] for trace in requested_traces}
    require(len(requested_traces) == len(requested) == plan["case"]["requestedNets"], "Requested native nets changed")
    source_nets = {row["name"]: row["source_net_id"] for row in run["circuit"] if row["type"] == "source_net"}
    require(set(source_nets) == {trace["name"] for trace in requested_traces}, "Requested source net membership changed")
    for filename in ("unrouted.circuit.json.gz", *PHASE_FILES):
        require(read_bytes(path / filename) == read_bytes(root / "published-baseline" / filename),
                f"Native pre-failure bytes changed: {filename}")
    require({item.name for item in path.glob("phase-*.gz")} ==
            set(PHASE_FILES) | {"phase-5-input.srj.json.gz", "phase-5-output.srj.json.gz"},
            "Unexpected phase output; failed other_signals must not emit partial routes")
    for index, expected_hash in plan["expectedNativePrefix"]["phaseInputs"].items():
        require(hashlib.sha256(read_bytes(path / f"phase-{index}-input.srj.json.gz")).hexdigest()
                == expected_hash, "Native input hash changed")
    connected = verify_assessment(run, requested)
    previous_connected = verify_assessment(baseline, requested)
    require(len(previous_connected) == 53 and previous_connected < connected, "No additional native net completion or a prior net was lost")
    power = [trace for trace in requested_traces if trace["group"] == "power"]
    power_ids = {source_nets[trace["name"]] for trace in power}
    power_names = {trace["nativeNet"] for trace in power}
    require(len(power) == len(power_ids) == 12 and sum(len(trace["path"]) for trace in power) == 341,
            "Authored power membership changed")
    require(connected - previous_connected <= power_names, "New connected nets are outside the accepted power phase")
    accepted = read_json(path / "phase-5-output.srj.json.gz")
    power_input = read_json(path / "phase-5-input.srj.json.gz")
    for srj in (power_input, accepted):
        require({connection["name"] for connection in srj["connections"]} == power_ids,
                "Power SRJ does not contain exactly the authored twelve nets")
    spec = importlib.util.spec_from_file_location("physical", CONTROLLER / "compare-core-publication-physical.py")
    comparator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(comparator)
    physical = comparator.compare_physical(baseline, run, accepted_gain=True)
    materialization = verify_materialization(run, accepted, power_ids, physical)
    return {"lane": lane, "valid": True, "passed": True, "connectedNets": len(connected),
            "gainedNets": sorted(connected - previous_connected), "requestedNets": len(requested),
            "physicalComparison": physical, "materialization": materialization,
            "retainedFailedPhase": "other_signals", "completedAdditionalPhase": "power",
            "renderWallMs": run["process"]["renderWallMs"], "timingIsDiagnosticOnly": True,
            "comparisonPolicy": plan["comparisonPolicy"],
            "sourceProofSha256": digest(root / "core-source-pair/provenance.json")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("lane", choices=("candidate",))
    args = parser.parse_args()
    destination = args.root / "core-source-pair/candidate-validation.json"
    destination.unlink(missing_ok=True)
    plan = read_json(CONTROLLER / "core-publication-plan.json")
    require(plan["frozen"] is True, "Source patch and harness are not frozen for qualification")
    for item in plan["frozenArtifactFiles"]:
        path = args.root / "published-baseline" / item["name"]
        require(path.stat().st_size == item["bytes"] and digest(path) == item["sha256"],
                f"Authenticated published artifact changed: {item['name']}")
    baseline = load_run(args.root / "published-baseline")
    result = qualify(args.root, plan, baseline)
    destination.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(json.dumps({"passed": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
