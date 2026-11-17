#!/usr/bin/env python3
"""Qualify the source control before permitting an accepted-phase candidate."""

import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys


CONTROLLER = Path(__file__).resolve().parent
PHASE_FILES = (
    "phase-1-input.srj.json.gz",
    "phase-1-output.srj.json.gz",
    "phase-2-input.srj.json.gz",
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
    require(progress["status"] == "capture_deadline" and progress["renderCompleted"] is False,
            "Observation frontier changed; preserve and review separately")
    require(result["renderSettled"] is False and result["completeAndClean"] is False,
            "Partial publication must not claim full-board completion")
    require(progress["errors"] == expected["errors"], "Render error changed")
    require(len(progress["phases"]) == 2, "Native phase advancement changed; review separately")
    for actual, previous in zip(progress["phases"], expected["phases"]):
        timing = {"startedMs", "elapsedMs", "progress", "iterationsPerSecond"}
        require(without(actual, timing) == without(previous, timing), "Native phase state changed")
    require([without(item, {"startedMs", "elapsedMs"}) for item in progress["solvers"]] ==
            [without(item, {"startedMs", "elapsedMs"}) for item in expected["solvers"]],
            "Native solver lifecycle changed")
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


def verify_materialization(run, accepted, dq_ids):
    traces = {row["pcb_trace_id"]: row for row in run["circuit"] if row["type"] == "pcb_trace"}
    expected = {row["pcb_trace_id"]: row for row in accepted["traces"]}
    require(len(expected) == 16 and traces.keys() == expected.keys(), "Accepted trace IDs were lost, duplicated or added")
    source_traces = {row["source_trace_id"]: row for row in run["circuit"] if row["type"] == "source_trace"}
    expected_vias = set()
    for trace_id, previous in expected.items():
        trace, owner = traces[trace_id], previous["connection_name"]
        require(owner in dq_ids, "Accepted trace has unexpected net ownership")
        source_id = trace["source_trace_id"]
        owners = {source_id} if source_id in dq_ids else set(source_traces[source_id]["connected_source_net_ids"])
        require(owners == {owner}, f"Emitted net ownership changed: {trace_id}")
        require(physical_route(trace["route"]) == physical_route(previous["route"]), f"Accepted route changed: {trace_id}")
        for point in previous["route"]:
            if point["route_type"] == "via":
                expected_vias.add((owner, point["x"], point["y"], point["via_hole_diameter"],
                                   point["via_diameter"], tuple(sorted(point["layers"]))))
    actual_vias = []
    for via in (row for row in run["circuit"] if row["type"] == "pcb_via"):
        require(via["pcb_trace_id"] in expected, "Via has no accepted trace owner")
        actual_vias.append((expected[via["pcb_trace_id"]]["connection_name"], via["x"], via["y"],
                            via["hole_diameter"], via["outer_diameter"], tuple(sorted(via["layers"]))))
    require(len(actual_vias) == len(set(actual_vias)), "Duplicate owned physical via rows")
    require(set(actual_vias) == expected_vias, "Physical via geometry/ownership differs from accepted routes")
    require(not any(row["type"] == "pcb_copper_pour" for row in run["circuit"]), "Unexpected copper pour")
    return len(actual_vias)


def qualify(root, plan, lane, baseline):
    proof = verify_provenance(root, plan, lane)
    path = root / "results" / lane / "butterstick/spaced"
    run = load_run(path)
    task = read_json(root / f"cases/{lane}-butterstick-spaced.json")
    verify_run(run, baseline, task, proof, plan, lane)
    native_source = read_json(task["sourcePath"])
    requested_traces = [trace for trace in native_source["traces"] if len(trace["path"]) > 1]
    requested = {trace["nativeNet"] for trace in requested_traces}
    require(len(requested_traces) == len(requested) == plan["case"]["requestedNets"], "Requested native nets changed")
    source_nets = {row["name"]: row["source_net_id"] for row in run["circuit"] if row["type"] == "source_net"}
    require(set(source_nets) == {trace["name"] for trace in requested_traces}, "Requested source net membership changed")
    for filename in ("unrouted.circuit.json.gz", *PHASE_FILES):
        require(read_bytes(path / filename) == read_bytes(root / "published-baseline" / filename),
                f"Native bytes changed: {filename}")
    require({item.name for item in path.glob("phase-*.gz")} == set(PHASE_FILES),
            "Additional native phase output; preserve and review separately")
    for index, expected_hash in ((1, "byte0InputSha256"), (2, "byte1InputSha256")):
        require(hashlib.sha256(read_bytes(path / f"phase-{index}-input.srj.json.gz")).hexdigest()
                == plan["expectedNativePrefix"][expected_hash], "Native input hash changed")
    noncopper = lambda circuit: [row for row in circuit if row["type"] not in COPPER and row["type"] != "pcb_debug_object"]
    require(rows(noncopper(run["circuit"])) == rows(noncopper(baseline["circuit"])),
            "Component, pad, source or other non-copper geometry/membership changed")
    connected = verify_assessment(run, requested)
    previous_connected = verify_assessment(baseline, requested)
    require(previous_connected <= connected, "Previously connected net was lost")
    if lane == "base":
        require(rows(run["circuit"]) == rows(baseline["circuit"]), "Source-control emitted CircuitJSON differs from published")
        require(without(run["assessment"], {"validationMs"}) == without(baseline["assessment"], {"validationMs"}),
                "Source-control physical assessment differs from published")
        require(all(rows(run["findings"][group]) == rows(values) for group, values in baseline["findings"].items()),
                "Source-control physical findings differ from published")
        require(connected == set(), "Published control must establish 0/317 physical completion")
        vias = 0
    else:
        dq = set(plan["expectedNativePrefix"]["byte0Nets"])
        require(dq <= connected and dq.isdisjoint(previous_connected), "All eight DQ nets must physically gain completion")
        for group in SHARED.values():
            require(not (rows(run["findings"][group]) - rows(baseline["findings"][group])),
                    f"New shared physical conflict: {group}")
        accepted = read_json(path / "phase-1-output.srj.json.gz")
        dq_ids = {source_nets[trace["name"]] for trace in requested_traces if trace["nativeNet"] in dq}
        require({connection["name"] for connection in accepted["connections"]} == dq_ids,
                "Accepted native phase does not contain exactly the eight DQ nets")
        vias = verify_materialization(run, accepted, dq_ids)
    return {"lane": lane, "valid": True, "passed": True, "connectedNets": len(connected),
            "gainedNets": sorted(connected - previous_connected), "requestedNets": len(requested),
            "physicalVias": vias, "renderSettled": False, "currentPhase": "byte1",
            "renderWallMs": run["process"]["renderWallMs"],
            "timingIsDiagnosticOnly": True, "sourceProofSha256": digest(root / "core-source-pair/provenance.json")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("lane", choices=("base", "candidate"))
    args = parser.parse_args()
    destination = args.root / f"core-source-pair/{args.lane}-validation.json"
    # A failed recheck must never leave an earlier success usable by the next lane.
    destination.unlink(missing_ok=True)
    plan = read_json(CONTROLLER / "core-publication-plan.json")
    require(plan["frozen"] is True, "Source patch and harness are not frozen for qualification")
    for item in plan["frozenArtifactFiles"]:
        path = args.root / "published-baseline" / item["name"]
        require(path.stat().st_size == item["bytes"] and digest(path) == item["sha256"],
                f"Authenticated published artifact changed: {item['name']}")
    baseline = load_run(args.root / "published-baseline")
    # Recheck actual base artifacts, not a stale success flag, before candidate acceptance.
    base = qualify(args.root, plan, "base", baseline)
    result = base if args.lane == "base" else qualify(args.root, plan, "candidate", baseline)
    destination.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(json.dumps({"passed": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
