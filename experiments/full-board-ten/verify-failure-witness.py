#!/usr/bin/env python3
"""Accept a diagnostic capture only when native inputs and actual output match."""
import gzip
import hashlib
import json
import subprocess
from pathlib import Path
import sys

root, board = Path(sys.argv[1]), sys.argv[2]
expected = json.loads(Path(__file__).with_name("failure-witness-baseline.json").read_text())
baseline = expected["cases"][board]
output = root / "results" / board / "spaced"
result = json.loads((output / "result.json").read_text())
progress = json.loads((output / "progress.json").read_text())
witness = json.loads(gzip.decompress((output / "failure-witness.json.gz").read_bytes()))
checks = {}
context_observations = None

def check(name, condition):
    checks[name] = bool(condition)

check("unchanged_limits", result["captureDeadlineMs"] == expected["captureDeadlineMs"] and result["hardDeadlineMs"] == expected["hardDeadlineMs"])
check("completed_assessment", result["auditExitCode"] == 0 and not result["auditTimedOut"] and result["assessmentReady"])
check("native_policy", result["routingPolicyObserved"] and result["completeSourceCounts"] and not result["dependencyOverrides"] and result["wasmUsage"]["routingOrUnknownAttempts"] == 0)
check("same_completion", result["connectedNets"] == baseline["connectedNets"] and result["requestedRoutableNets"] == baseline["requestedRoutableNets"])
check("same_emitted_counts", result["emittedCounts"] == baseline["emittedCounts"])
check("same_final_error", result["lastError"] == baseline["lastError"])
phase_files = {path.name: hashlib.sha256(gzip.decompress(path.read_bytes())).hexdigest() for path in sorted(output.glob("phase-*.srj.json.gz"))}
check("same_all_native_phase_inputs_and_outputs", phase_files == baseline["phaseFiles"])
phase_status = [{key: phase[key] for key in ["name", "index", "status", "inputSha256"]} for phase in progress["phases"]]
check("same_phase_lifecycle", phase_status == baseline["phaseStatus"])
circuit = gzip.decompress((output / "circuit.json.gz").read_bytes())
check("same_full_actual_circuit", hashlib.sha256(circuit).hexdigest() == baseline["circuitSha256"])
copper = [item for item in json.loads(circuit) if item["type"] in ["pcb_trace", "pcb_via", "pcb_copper_pour"]]
copper_hash = hashlib.sha256(json.dumps(copper, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
check("same_actual_copper", copper_hash == baseline["copperSha256"])

if board in ["h616", "icepi"]:
    node, pair = ("topology_merge_7204", "source_net_116") if board == "h616" else ("topology_merge_17108", "source_net_34_mst6")
    check("complete_native_capture", witness.get("captureValid") is True and witness.get("captureErrors") == [])
    check("native_target_identity", witness["targetNode"] == node and witness["targetConnection"] == pair and witness["connections"]["pointPair"]["name"] == pair)
    check("same_native_hd_failure", witness.get("highDensityFinal", {}).get("failed") is True and isinstance(witness.get("highDensityFinal", {}).get("error"), str) and witness["highDensityFinal"]["error"] in result["lastError"])
    b01 = [attempt for attempt in witness["attempts"] if attempt["kind"] == "b01"]
    regional = [attempt for attempt in witness["attempts"] if attempt["kind"] == "regional"]
    check("b01_failure_retained", bool(b01) and any(attempt["final"]["failed"] and pair in attempt["final"]["error"] and "lastBeforeStep" in attempt for attempt in b01))
    check("regional_failure_retained", bool(regional) and any(attempt["final"]["failed"] and attempt.get("candidates") for attempt in regional))
    check("each_regional_instance_captured_before_stepping", all(attempt["initial"]["iterations"] == 0 and all(key in attempt for key in ["parameters", "fixedRouteSections", "fixedObstacleRoutes", "promotedConnectionNames", "reason"]) for attempt in regional))
    check("native_connectivity_maps", bool(regional) and all("netMap" in attempt["parameters"]["connMap"] and "idToNetMap" in attempt["parameters"]["connMap"] for attempt in regional))
    check("native_inputs_bounded", witness["serializedInputBytes"] <= 24 * 1024 * 1024)
    if board == "h616":
        # Match the observer's JSON.stringify hashes exactly, including floats.
        blob_proof = json.loads(subprocess.check_output(["bun", "-e", """
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { createHash } from "node:crypto"
const witness = JSON.parse(gunzipSync(readFileSync(process.argv[1])))
const entries = Object.entries(witness.blobs)
const invalid = entries.filter(([hash, value]) => createHash("sha256").update(JSON.stringify(value)).digest("hex") !== hash)
console.log(JSON.stringify({ count: entries.length, valid: invalid.length === 0 }))
""", str(output / "failure-witness.json.gz")]))
        check("all_native_blob_digests", blob_proof["count"] > 0 and blob_proof["valid"])
        blobs = witness["blobs"]
        context = witness.get("pendingNodeAbsorptionContext")
        check("pending_node_context_present", isinstance(context, dict))
        if isinstance(context, dict):
            def resolve_blob(reference):
                if not isinstance(reference, dict) or set(reference) != {"$blob"} or reference["$blob"] not in blobs:
                    raise RuntimeError("Missing complete context blob")
                return blobs[reference["$blob"]]

            parameters = context["parentParameters"]
            nodes = resolve_blob(parameters["nodePortPoints"])
            fixed_routes = resolve_blob(parameters["fixedHdRoutes"])
            initial_nodes = resolve_blob(context["pipelineHighDensityNodePortPoints"])
            pending_ids = resolve_blob(context["pendingNodeIds"])
            active_node = resolve_blob(context["activeNode"])
            prior_routes = resolve_blob(context["priorSamePhaseRoutes"])
            required_context = ["fixedRouteReplacements", "removedFixedRouteConnectionNames", "preloadedTraceMutationMasks"]
            for field in required_context:
                resolve_blob(context[field])
            node_ids = [item["capacityMeshNodeId"] for item in nodes]
            node_set, pending_set = set(node_ids), set(pending_ids)
            active_id = active_node["capacityMeshNodeId"]
            stats = context["parentState"]["stats"]
            check("context_is_first_regional_constructor", context["captureMoment"] == "first-regional-constructor-after-b01-failure" and bool(regional) and context["regionalAttemptId"] == regional[0]["id"] and context["regionalInitial"] == regional[0]["initial"] and context["regionalInitial"]["iterations"] == 0)
            check("context_retains_first_b01_failure", bool(b01) and context["retainedB01AttemptId"] == b01[0]["id"] and b01[0]["final"]["failed"] is True)
            check("context_has_complete_node_partition", len(node_ids) == len(node_set) == stats["nodeCount"] and len(pending_ids) == len(pending_set) and pending_set <= node_set and active_id == node and active_id in node_set and active_id not in pending_set and len(node_set - pending_set - {active_id}) == stats["solvedNodeCount"])
            check("context_active_node_is_native_regional_input", context["activeNode"] == regional[0]["node"])
            initial_node_ids = [item["capacityMeshNodeId"] for item in initial_nodes]
            check("context_preserves_pipeline_input_snapshot", len(initial_node_ids) == len(set(initial_node_ids)) == len(node_ids) and set(initial_node_ids) == node_set)
            context_observations = {"initialAndCurrentNodeInputsEqual": initial_nodes == nodes, "queueOrder": "native array order; parent consumes from the end", "inputNodeCount": len(nodes), "pendingNodeCount": len(pending_ids), "acceptedNodeCount": len(node_set - pending_set - {active_id}), "priorSamePhaseRouteCount": len(prior_routes), "originalFixedRouteCount": len(fixed_routes)}
            check("context_preserves_node_pairs", all(isinstance(item.get("portPoints"), list) and (item.get("portPointsInPairs", {"$undefined": True}) == {"$undefined": True} or isinstance(item["portPointsInPairs"], list) and all(isinstance(pair, list) and len(pair) == 2 for pair in item["portPointsInPairs"])) for item in nodes))
            check("context_preserves_prior_and_fixed_copper", isinstance(prior_routes, list) and isinstance(fixed_routes, list) and len(fixed_routes) == stats["fixedObstacleCount"])
            check("context_has_native_connectivity_maps", "netMap" in parameters["connMap"] and "idToNetMap" in parameters["connMap"])
            resolve_blob(parameters["connMap"]["netMap"])
            resolve_blob(parameters["connMap"]["idToNetMap"])
else:
    check("same_existing_coarse_diagnostics", hashlib.sha256((output / "coarse-diagnostics.json").read_bytes()).hexdigest() == baseline["coarseDiagnosticsSha256"])
    check("coarse_hook_from_start", witness.get("innerHookInstalled") is True and witness["configured"]["hookInstalledAtIteration"] == 0)
    check("coarse_queue_bound_after_setup", witness["configured"].get("queueHookInstalledAtIteration") == 1 and witness["configured"].get("queueHookInstalledAfterSetup") is True and witness["configured"].get("queueHookInstalledBeforeDequeueCount") == 0)
    counts = witness["counts"]
    check("coarse_step_accounting", counts["mainStepCalls"] == witness["final"]["iterations"] and counts["stepsWithMultipleQueuePops"] == 0 and counts["stepsWithReplacedQueue"] == 0)
    check("coarse_pop_accounting", counts["queueDequeueCalls"] > 0 and counts["queueDequeueCalls"] == sum(counts[key] for key in ["emptyQueuePops", "staleQueuePops", "foreignRegionPops", "eligibleExpansions"]))
    attempts = witness["attempts"]
    check("selected_native_route_attempts", all(any(row["routeId"] == route_id and "committedAtIteration" in row and "commitCandidate" in row for row in attempts) for route_id in [18, 19, 22, 23]))
    check("selected_pop_accounting", all(row["pops"] == row["stalePops"] + row["foreignRegionPops"] + row["eligibleExpansions"] for row in attempts))
    check("path_capture_bounds", witness.get("captureBoundsViolations") == [])
    selected_routes = {route["routeId"]: route for route in witness["configured"]["selectedRoutes"]}
    paths_complete = True
    neighborhoods_complete = True
    for row in attempts:
        path = row.get("committedPath") or {}
        nodes = path.get("nodes", [])
        paths_complete = paths_complete and path.get("complete") is True and path.get("capturedBeforeCommit") is True and 0 < len(nodes) <= 4096 and path.get("nodeCount") == len(nodes)
        if nodes:
            paths_complete = paths_complete and nodes[0]["portId"] == selected_routes[row["routeId"]]["start"]["portId"] and nodes[-1]["portId"] == row["goal"]["portId"] and nodes[-1]["g"] == row["commitCandidate"]["g"]
        neighborhood = row.get("goalNeighborhood") or {}
        regions = neighborhood.get("regions", [])
        ports = sum(len(region["ports"]) for region in regions)
        neighborhoods_complete = neighborhoods_complete and neighborhood.get("complete") is True and neighborhood.get("goalPortId") == row["goal"]["portId"] and 0 < len(regions) <= 8 and 0 < ports <= 4096 and neighborhood.get("portCount") == ports
    check("selected_committed_paths_complete", bool(attempts) and paths_complete)
    check("selected_goal_neighborhoods_complete", bool(attempts) and neighborhoods_complete)

report = {"board": board, "baselineRun": expected["baselineRun"], "checks": checks, "valid": all(checks.values()), "nativeContextObservations": context_observations, "notice": "Diagnostic acceptance only; the authentic board remains incomplete. Wall times include observation overhead."}
(output / "failure-witness-validation.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
if not report["valid"]:
    raise SystemExit(1)
