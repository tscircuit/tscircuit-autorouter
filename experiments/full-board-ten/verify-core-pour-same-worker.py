#!/usr/bin/env python3
"""Report all three comparisons, keeping the first failed capture explicit."""
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


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def host_counter_deltas(before, after):
    deltas = {}
    for path in ["/sys/fs/cgroup/cpu.stat", "/sys/fs/cgroup/memory.events"]:
        old, new = before["files"][path], after["files"][path]
        if old is None or new is None:
            deltas[path] = {"available": False}
            continue
        old_values = {key: int(value) for key, value in map(str.split, old.splitlines())}
        new_values = {key: int(value) for key, value in map(str.split, new.splitlines())}
        deltas[path] = {key: new_values[key] - value for key, value in old_values.items()}
    for path in ["/proc/pressure/cpu", "/proc/pressure/memory", "/sys/fs/cgroup/cpu.pressure"]:
        old, new = before["files"][path], after["files"][path]
        if old is None or new is None:
            deltas[path] = {"available": False}
            continue
        totals = lambda text: {line.split()[0]: int(dict(field.split("=") for field in line.split()[1:])["total"]) for line in text.splitlines()}
        old_values, new_values = totals(old), totals(new)
        deltas[path] = {f"{key}StallMicroseconds": new_values[key] - value for key, value in old_values.items()}
    names = ["user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal", "guest", "guest_nice"]
    old_cpu = list(map(int, before["files"]["/proc/stat"].splitlines()[0].split()[1:]))
    new_cpu = list(map(int, after["files"]["/proc/stat"].splitlines()[0].split()[1:]))
    deltas["systemCpuTicks"] = {name: new - old for name, old, new in zip(names, old_cpu, new_cpu)}
    return {"elapsedSecondsIncludingAssessment": after["monotonicSeconds"] - before["monotonicSeconds"], "deltas": deltas, "scope": "Worker-wide counters include the lane and its unchanged neutral assessment; phase CPU measurements come from the circuit worker itself."}


controller = Path(__file__).resolve().parent
root = Path(sys.argv[1]).resolve()
proof = root / "same-worker"
plan = read(controller / "core-pour-same-worker-plan.json")
runtime_plan = read(controller / "core-reentrancy-plan.json")
materialization = load_module("paired_materialization", controller / "core-reentrancy-materialization.py")
verification = load_module("paired_geometry", controller / "verify-core-reentrancy.py")
report = {"qualified": False, "causalConclusion": "not_established_by_one_pair", "firstFailure": plan["firstFailure"], "firstFailureSuperseded": False, "laneOrder": plan["laneOrder"], "acceptance": plan["acceptance"], "extendedTail": False}
try:
    task = read(root / "cases/imx6-spaced.json")
    source = read(Path(task["sourcePath"]))
    requested = {row["nativeNet"] for row in source["traces"] if len(row["path"]) > 1}
    assert len(requested) == task["expectedRoutableNets"] == 404
    assert hashlib.sha256(Path(task["sourcePath"]).read_bytes()).hexdigest() == task["sourceSha256"]
    initial_worker = read(proof / "initial-worker.json")
    results = {}
    for lane, folder in [("historical", root / "published-baseline"), ("published", root / "results/published/imx6/spaced"), ("candidate", root / "results/candidate/imx6/spaced")]:
        circuit = read(folder / "circuit.json.gz")
        result, progress, assessment = [read(folder / name) for name in ["result.json", "progress.json", "assessment.json"]]
        connected = requested - set(assessment["unconnectedNets"])
        assert len(connected) == result["connectedNets"] == assessment["connectedNets"]
        assert set(assessment["unconnectedNets"]) <= requested
        assert result["assessmentReady"] and result["completeSourceCounts"] and result["routingPolicyObserved"]
        assert [result["captureDeadlineMs"], result["hardDeadlineMs"]] == [900000, 960000]
        assert result["auditExitCode"] == 0 and not result["auditTimedOut"]
        assert not any(row["type"] == "pcb_copper_pour" for row in circuit)
        physical = {kind: verification.geometry(circuit, kind, materialization.normalize_emitted_trace_route) for kind in ["pcb_trace", "pcb_via"]}
        results[lane] = {"folder": folder, "circuit": circuit, "result": result, "progress": progress, "assessment": assessment, "connected": connected, "physical": physical, "findings": read(folder / "findings.json.gz")}
        if lane != "historical":
            before, after = [read(proof / lane / name) for name in ["host-before.json", "host-after.json"]]
            for host in [before, after]:
                assert host["hostname"] == initial_worker["hostname"]
                assert host["cpuAffinity"] == initial_worker["cpuAffinity"]
                assert host["files"]["/proc/sys/kernel/random/boot_id"] == initial_worker["files"]["/proc/sys/kernel/random/boot_id"]
            active = read(proof / lane / "active-runtime-manifest.json")
            restored = read(proof / lane / "assessment-runtime-restored.json")
            assert active["sourceOverrides"] is (lane == "candidate")
            assert restored["allPublishedFilesVerified"] and restored["publishedAliasesRestored"]
            assert restored["activeRuntimeWasCandidate"] is (lane == "candidate")
            binding = progress["runtime"]["coreChunkBinding"]
            for key in ["mainAndCoreClassIdentical", "nativeBoardMethodIdentical", "nativeGroupMethodIdentical", "nativePourMethodsIdentical"]:
                assert binding[key] is True
            expected_hashes = {row["path"]: row["beforeSha256"] if lane == "published" else row["afterSha256"] for row in runtime_plan["runtimeChanges"]}
            assert {row["path"]: row["sha256"] for row in binding["reviewedFiles"]} == expected_hashes
            observation = read(folder / "render-observations.json")
            assert observation["calls"] > 0 and observation["renderLifecycleListenersAdded"] is False and observation["forcedGc"] is False
            results[lane]["observation"] = observation
            results[lane]["hostCounters"] = host_counter_deltas(before, after)
    assert len(results["historical"]["connected"]) == 53
    authored_types = {"pcb_board", "pcb_component", "pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_port", "source_component", "source_net", "source_trace", "source_port"}
    comparisons = {}
    for old_lane, new_lane in [("historical", "published"), ("historical", "candidate"), ("published", "candidate")]:
        old, new = results[old_lane], results[new_lane]
        old_files = {path.name for path in old["folder"].glob("phase-*.srj.json.gz")}
        new_files = {path.name for path in new["folder"].glob("phase-*.srj.json.gz")}
        common_payloads = {name: gzip.decompress((old["folder"] / name).read_bytes()) == gzip.decompress((new["folder"] / name).read_bytes()) for name in sorted(old_files & new_files)}
        missing_outputs = sorted(name for name in old_files - new_files if "-output." in name)
        physical = {kind: {"before": old["physical"][kind].total(), "after": new["physical"][kind].total(), "removed": (old["physical"][kind] - new["physical"][kind]).total(), "added": (new["physical"][kind] - old["physical"][kind]).total()} for kind in old["physical"]}
        authored = lambda circuit: collections.Counter(canonical(row) for row in circuit if row["type"] in authored_types)
        findings = {key: list((collections.Counter(map(canonical, new["findings"][key])) - collections.Counter(map(canonical, old["findings"][key]))).elements()) for key in old["findings"]}
        coarse = {}
        coarse_hashes = {}
        for lane, row in [(old_lane, old), (new_lane, new)]:
            coarse_path = row["folder"] / "coarse-diagnostics.json"
            coarse[lane] = read(coarse_path) if coarse_path.is_file() else None
            coarse_hashes[lane] = hashlib.sha256(coarse_path.read_bytes()).hexdigest() if coarse_path.is_file() else None
        coarse_equal = coarse[old_lane] is not None and coarse[old_lane] == coarse[new_lane]
        comparisons[f"{old_lane}_to_{new_lane}"] = {
            "beforeConnectedNames": sorted(old["connected"]), "afterConnectedNames": sorted(new["connected"]), "lostConnectedNames": sorted(old["connected"] - new["connected"]), "addedConnectedNames": sorted(new["connected"] - old["connected"]),
            "commonPhasePayloadsByteIdentical": common_payloads, "missingAcceptedPhaseOutputs": missing_outputs,
            "physicalCopper": physical, "authoredGeometryIdentical": authored(old["circuit"]) == authored(new["circuit"]),
            "unroutedCircuitRecordMultisetIdentical": collections.Counter(map(canonical, read(old["folder"] / "unrouted.circuit.json.gz"))) == collections.Counter(map(canonical, read(new["folder"] / "unrouted.circuit.json.gz"))),
            "newNeutralFindings": findings,
            "coarseWork": {"entireUnmodifiedReportsIdentical": coarse_equal, "fileSha256": coarse_hashes, "reports": {lane: [{"phase": row["phase"], "iterations": row.get("final", {}).get("iterations"), "iterationLimit": row.get("final", {}).get("MAX_ITERATIONS"), "canonicalSha256": hashlib.sha256(canonical(row).encode()).hexdigest()} for row in (data or {}).get("reports", [])] for lane, data in coarse.items()}, "scope": "Compare complete unchanged coarse diagnostic records; no timing or semantic fields are removed. Different terminal iterations are reported as different progress, not normalized away."},
        }
    report["comparisons"] = comparisons
    report["lanes"] = {lane: {
        "connectedNets": len(row["connected"]), "process": verification.process_state(row["result"], row["progress"]), "renderWallMs": row["result"]["renderWallMs"],
        "phases": row["progress"]["phases"], "emittedCounts": row["result"]["emittedCounts"],
        "observations": row.get("observation"),
        "hostCounters": row.get("hostCounters"),
    } for lane, row in results.items()}
    phase_costs = []
    for control_phase in results["published"]["progress"]["phases"]:
        candidate_phase = next((row for row in results["candidate"]["progress"]["phases"] if row["index"] == control_phase["index"] and row["name"] == control_phase["name"]), None)
        if not candidate_phase or "resourcesAtEnd" not in control_phase or "resourcesAtEnd" not in candidate_phase:
            continue
        costs = {}
        for lane, phase in [("published", control_phase), ("candidate", candidate_phase)]:
            start, end = phase["resourcesAtStart"], phase["resourcesAtEnd"]
            costs[lane] = {"wallMs": end["elapsedMs"] - start["elapsedMs"], "routerEventElapsedMs": phase["elapsedMs"], "cpuUs": end["userCpuUs"] + end["systemCpuUs"] - start["userCpuUs"] - start["systemCpuUs"], "renderCalls": end["renderCalls"] - start["renderCalls"], "synchronousRenderCallWallMs": end["outerRenderWallMs"] - start["outerRenderWallMs"], "synchronousRenderCallCpuUs": end["outerRenderUserCpuUs"] + end["outerRenderSystemCpuUs"] - start["outerRenderUserCpuUs"] - start["outerRenderSystemCpuUs"]}
        phase_costs.append({"name": control_phase["name"], **costs, "candidateToControlWallRatio": costs["candidate"]["wallMs"] / costs["published"]["wallMs"], "candidateToControlCpuRatio": costs["candidate"]["cpuUs"] / costs["published"]["cpuUs"]})
    report["matchedCompletedPhaseCosts"] = phase_costs
    primary = [comparisons["historical_to_candidate"], comparisons["published_to_candidate"]]
    report["gates"] = {
        "sameWorkerAndReviewedRuntimeHashes": True,
        "bothValidPrimaryCapturesOrFinishes": all(verification.process_state(results[lane]["result"], results[lane]["progress"])["validCaptureOrFinish"] for lane in ["published", "candidate"]),
        "historicalAndControlFinishedOutcomesPreserved": all(not verification.process_state(results[lane]["result"], results[lane]["progress"])["finishedIncludingFailedRouting"] or verification.process_state(results["candidate"]["result"], results["candidate"]["progress"])["finishedIncludingFailedRouting"] for lane in ["historical", "published"]),
        "historicalAndControlConnectedNamesPreserved": all(not row["lostConnectedNames"] for row in primary),
        "commonRoutePayloadsIdentical": all(all(row["commonPhasePayloadsByteIdentical"].values()) for row in primary),
        "historicalAndControlAcceptedOutputsPreserved": all(not row["missingAcceptedPhaseOutputs"] for row in primary),
        "historicalAndControlPhysicalCopperPreserved": all(all(kind["removed"] == 0 for kind in row["physicalCopper"].values()) for row in primary),
        "authoredCircuitPreserved": all(row["authoredGeometryIdentical"] and row["unroutedCircuitRecordMultisetIdentical"] for row in comparisons.values()),
        "noNewNeutralFindings": all(not any(row["newNeutralFindings"].values()) for row in primary),
    }
    report["qualified"] = all(report["gates"].values())
    report["interpretation"] = "This predetermined pair reports completion at the same 900-second primary deadline. CPU/render and host counters inform code-versus-worker hypotheses; one fixed-order pair does not prove causality. The original 53-to-16 result remains recorded and is never replaced by this result. Heap changes are not GC pause measurements."
except Exception as error:
    report["verificationError"] = f"{type(error).__name__}: {error}"
    (proof / "comparison.json").write_text(json.dumps(report, indent=2) + "\n")
    raise
(proof / "comparison.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"qualified": report["qualified"], "gates": report["gates"], "connectedNets": {lane: row["connectedNets"] for lane, row in report["lanes"].items()}, "firstFailureSuperseded": False}))
raise SystemExit(0 if report["qualified"] else 1)
