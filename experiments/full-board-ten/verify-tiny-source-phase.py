#!/usr/bin/env python3
"""Require native source parity before evaluating whole-phase completion."""

import copy
import gzip
import hashlib
import json
from pathlib import Path
import sys


def normalize_class_name(report: dict) -> tuple[dict, list]:
    normalized = copy.deepcopy(report)
    name = report["configured"]["className"]
    if not isinstance(name, str) or not name:
        raise RuntimeError("Missing observed constructor name")
    edits = [{"path": "configured.className", "from": name, "to": "<constructor>"}]
    normalized["configured"]["className"] = "<constructor>"

    def visit(value: object, path: str) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                child_path = f"{path}.{key}" if path else key
                if key == "error" and child == f"{name} ran out of iterations":
                    value[key] = "<constructor> ran out of iterations"
                    edits.append({"path": child_path, "from": child, "to": value[key]})
                else:
                    visit(child, child_path)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, f"{path}[{index}]")

    visit(normalized, "")
    return normalized, edits


def main() -> None:
    root, lane = Path(sys.argv[1]), sys.argv[2]
    if lane not in ["base", "candidate"]:
        raise RuntimeError("Expected base or candidate")
    plan = json.loads(Path(__file__).with_name("tiny-source-plan.json").read_text())
    folder = root / "native-phase" / lane
    result = json.loads((folder / "result.json").read_text())
    coarse_packet = json.loads((folder / "coarse-diagnostics.json").read_text())
    witness = json.loads((folder / "path-witness.json").read_text())
    if len(coarse_packet["reports"]) != 1:
        raise RuntimeError("Expected exactly one actual other_signals phase")
    coarse = coarse_packet["reports"][0]
    checks = {
        "same_native_input": result["inputSha256"] == plan["inputSha256"],
        "same_limits": result["captureDeadlineMs"] == 900000 and result["hardDeadlineMs"] == 960000,
        "finished_native_execution": not result["timedOut"] and result["thrownError"] is None,
        "no_routing_wasm": result["wasmUsage"]["routingOrUnknownAttempts"] == 0,
        "coarse_hook_from_start": coarse["innerHookInstalled"] is True and coarse["configured"]["hookInstalledAtIteration"] == 0,
        "same_coarse_iteration_limit": coarse["configured"]["MAX_ITERATIONS"] == 2000000,
        "path_hook_from_start": witness["innerHookInstalled"] is True and witness["configured"]["hookInstalledAtIteration"] == 0,
        "queue_bound_after_setup": witness["configured"]["queueHookInstalledAtIteration"] == 1 and witness["configured"]["queueHookInstalledAfterSetup"] is True and witness["configured"]["queueHookInstalledBeforeDequeueCount"] == 0,
        "bounded_path_capture": witness["captureBoundsViolations"] == [],
    }
    counts = witness["counts"]
    checks["step_accounting"] = counts["mainStepCalls"] == witness["final"]["iterations"] and counts["stepsWithMultipleQueuePops"] == 0 and counts["stepsWithReplacedQueue"] == 0
    checks["pop_accounting"] = counts["queueDequeueCalls"] > 0 and counts["queueDequeueCalls"] == sum(counts[key] for key in ["emptyQueuePops", "staleQueuePops", "foreignRegionPops", "eligibleExpansions"])
    attempts = witness["attempts"]
    selected = {row["routeId"]: row for row in witness["configured"]["selectedRoutes"]}
    checks["selected_route_attempts"] = all(any(row["routeId"] == route and "committedAtIteration" in row for row in attempts) for route in [18, 19, 22, 23])
    checks["selected_pop_accounting"] = all(row["pops"] == row["stalePops"] + row["foreignRegionPops"] + row["eligibleExpansions"] for row in attempts)
    complete_paths, complete_neighbors = bool(attempts), bool(attempts)
    for row in attempts:
        path = row.get("committedPath") or {}
        nodes = path.get("nodes", [])
        complete_paths = complete_paths and path.get("complete") is True and path.get("capturedBeforeCommit") is True and 0 < len(nodes) <= 4096 and path.get("nodeCount") == len(nodes)
        if nodes:
            complete_paths = complete_paths and nodes[0]["portId"] == selected[row["routeId"]]["start"]["portId"] and nodes[-1]["portId"] == row["goal"]["portId"] and nodes[-1]["g"] == row["commitCandidate"]["g"]
        neighborhood = row.get("goalNeighborhood") or {}
        regions = neighborhood.get("regions", [])
        ports = sum(len(region["ports"]) for region in regions)
        complete_neighbors = complete_neighbors and neighborhood.get("complete") is True and neighborhood.get("goalPortId") == row["goal"]["portId"] and 0 < len(regions) <= 8 and 0 < ports <= 4096 and neighborhood.get("portCount") == ports
    checks["selected_paths_complete"] = complete_paths
    checks["selected_goal_neighborhoods_complete"] = complete_neighbors
    normalization = None
    if lane == "base":
        published_packet = json.loads((root / "native-input/coarse-diagnostics.json").read_text())
        published = published_packet["reports"][0]
        expected, expected_edits = normalize_class_name(published)
        actual, actual_edits = normalize_class_name(coarse)
        checks["same_complete_coarse_report"] = actual == expected
        checks["same_limit_failure"] = result["failed"] is True and result["solved"] is False and result["outputSummary"] is None and coarse["final"]["failed"] is True and coarse["final"]["iterations"] == 2000000 and result["error"] == f"{coarse['configured']['className']} ran out of iterations" and coarse["final"]["error"] == result["error"]
        normalization = {"published": expected_edits, "source": actual_edits, "onlyConstructorNamesChanged": True}
    else:
        base_validation = json.loads((root / "native-phase/base/validation.json").read_text())
        checks["source_control_qualified"] = base_validation["valid"] is True
        checks["entire_native_phase_solved"] = coarse["final"]["solved"] is True and coarse["final"]["failed"] is False and result["solved"] is True and result["failed"] is False and result["error"] is None and result["outputSummary"] is not None
        output_path = folder / "phase-output.srj.json.gz"
        checks["actual_phase_output_retained"] = output_path.is_file() and hashlib.sha256(gzip.decompress(output_path.read_bytes())).hexdigest() == result["outputSummary"]["sha256"]
    validation = {"lane": lane, "valid": all(checks.values()), "checks": checks, "constructorNormalization": normalization, "interpretation": "Native phase qualification only. Physical full-board completion is measured separately."}
    (folder / "validation.json").write_text(json.dumps(validation, indent=2) + "\n")
    print(json.dumps(validation, indent=2))
    if not validation["valid"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
