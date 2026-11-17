#!/usr/bin/env python3
"""Accept a diagnostic capture only when native inputs and actual output match."""
import gzip
import hashlib
import json
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
    check("same_native_hd_failure", witness["highDensityFinal"]["failed"] and witness["highDensityFinal"]["error"] in result["lastError"])
    b01 = [attempt for attempt in witness["attempts"] if attempt["kind"] == "b01"]
    regional = [attempt for attempt in witness["attempts"] if attempt["kind"] == "regional"]
    check("b01_failure_retained", bool(b01) and any(attempt["final"]["failed"] and pair in attempt["final"]["error"] and "lastBeforeStep" in attempt for attempt in b01))
    check("regional_failure_retained", bool(regional) and any(attempt["final"]["failed"] and attempt["candidates"] for attempt in regional))
    check("each_regional_instance_captured_before_stepping", all(attempt["initial"]["iterations"] == 0 and all(key in attempt for key in ["parameters", "fixedRouteSections", "fixedObstacleRoutes", "promotedConnectionNames", "reason"]) for attempt in regional))
    check("native_inputs_bounded", witness["serializedInputBytes"] <= 24 * 1024 * 1024)
else:
    check("same_existing_coarse_diagnostics", hashlib.sha256((output / "coarse-diagnostics.json").read_bytes()).hexdigest() == baseline["coarseDiagnosticsSha256"])
    check("coarse_hook_from_start", witness.get("innerHookInstalled") is True and witness["configured"]["hookInstalledAtIteration"] == 0)
    counts = witness["counts"]
    check("coarse_step_accounting", counts["mainStepCalls"] == witness["final"]["iterations"] and counts["stepsWithMultipleQueuePops"] == 0 and counts["stepsWithReplacedQueue"] == 0)
    check("coarse_pop_accounting", counts["queueDequeueCalls"] == sum(counts[key] for key in ["emptyQueuePops", "staleQueuePops", "foreignRegionPops", "eligibleExpansions"]))
    attempts = witness["attempts"]
    check("selected_native_route_attempts", all(any(row["routeId"] == route_id and "committedAtIteration" in row and "commitCandidate" in row for row in attempts) for route_id in [18, 19, 22, 23]))
    check("selected_pop_accounting", all(row["pops"] == row["stalePops"] + row["foreignRegionPops"] + row["eligibleExpansions"] for row in attempts))

report = {"board": board, "baselineRun": expected["baselineRun"], "checks": checks, "valid": all(checks.values()), "notice": "Diagnostic acceptance only; the authentic board remains incomplete. Wall times include observation overhead."}
(output / "failure-witness-validation.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
if not report["valid"]:
    raise SystemExit(1)
