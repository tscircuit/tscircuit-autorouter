#!/usr/bin/env python3
"""Compare saved candidate circuits with the authenticated published3216 cases."""

import argparse
from collections import Counter
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path


CONTROLLER = Path(__file__).resolve().parent
SHARED = {"overlap": "trace_overlap", "padTrace": "pad_trace", "viaTrace": "via_trace",
          "viaPad": "via_pad", "viaSpacing": "via_spacing", "contiguous": "contiguous",
          "viaInPad": "via_in_pad", "holeTrace": "hole_trace"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def raw(path):
    value = Path(path).read_bytes()
    return gzip.decompress(value) if str(path).endswith(".gz") else value


def read(path):
    return json.loads(raw(path))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, CONTROLLER / filename)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def load_run(folder):
    return {key: read(folder / filename) for key, filename in {
        "circuit": "circuit.json.gz", "findings": "findings.json.gz",
        "assessment": "assessment.json", "result": "result.json",
        "progress": "progress.json", "process": "process.json"}.items()}


def connected(run, requested, cohort):
    result, assessment = run["result"], run["assessment"]
    absent = [row["name"] for row in assessment["missingCopper"]] if cohort == "original" else assessment["unconnectedNets"]
    require(len(absent) == len(set(absent)) and set(absent) <= requested, "Invalid missing-net names")
    names = requested - set(absent)
    denominator = assessment["routableNets"] if cohort == "original" else assessment["requestedNets"]
    require(denominator == result["requestedRoutableNets"] == len(requested), "Requested-net denominator changed")
    require(assessment["connectedNets"] == result["connectedNets"] == len(names), "Physical name/count mismatch")
    require(assessment["geometryErrors"] == [] and result["geometryErrorCount"] == 0, "Source geometry errors")
    if cohort == "original":
        require(assessment["membershipErrors"] == [] and result["membershipErrorCount"] == 0,
                "Native source membership changed")
    counts = Counter(row["type"] for row in run["circuit"])
    require(all(counts[key] == count for key, count in result["emittedCounts"].items()), "Saved copper counts disagree")
    require(assessment["pcbTraces"] == counts["pcb_trace"] and assessment["vias"] == counts["pcb_via"],
            "Assessor copper counts disagree")
    require(set(run["findings"]) == set(assessment["findings"]), "Finding groups changed")
    for key, values in run["findings"].items():
        require(sum(row["type"].endswith("_error") for row in values) == assessment["findings"][key],
                f"Finding count mismatch: {key}")
    groups = {key: assessment["findings"][key if cohort == "original" else alternate]
              for key, alternate in SHARED.items()}
    require(result["sharedDrcByGroup"] == groups and result["sharedDrcErrorCount"] == sum(groups.values()),
            "Physical finding totals disagree")
    return names


def verify(root, board, cohort, plan, comparison_folder=None):
    case = next(row for row in plan["cases"] if (row["board"], row["cohort"]) == (board, cohort))
    before_folder = comparison_folder or root / "baselines" / board / cohort
    after_folder = root / "results" / board / cohort
    if comparison_folder is None:
        for row in case["requiredArtifactFiles"]:
            path = before_folder / row["name"]
            require(path.stat().st_size == row["bytes"] and digest(path) == row["sha256"], "Baseline evidence changed")
    before, after = load_run(before_folder), load_run(after_folder)
    reuse = read(root / "core-all-ten-reuse.json")
    require(reuse["passed"] and reuse["coreBuilds"] == 0 and reuse["coreSourceDependencyResolutions"] == 0,
            "Qualified compiled graph was not reused")
    for field in ("id", "name", "size_in_bytes", "digest", "workflow_run"):
        require(reuse["primaryArtifact"][field] == plan["primary"]["artifact"][field],
                f"Primary artifact binding changed: {field}")
    require(reuse["candidateEntry"]["sha256"] == plan["primary"]["candidateEntrySha256"], "Candidate entry changed")
    manifest = read(root / "runtime-manifest.json")
    require(digest(root / "runtime-manifest.json") == reuse["runtimeManifestSha256"], "Runtime manifest changed")
    task = read(root / "cases" / f"candidate-{board}-{cohort}.json")
    result, progress, process = (after[key] for key in ("result", "progress", "process"))
    for record in (task, result, progress, process):
        require(record["id"] == board and record["cohort"] == cohort, "Case identity disagrees")
        require(record["experiment"] == "core-publication-all-ten", "Wrong candidate experiment")
    require(progress["sourceSha256"] == task["sourceSha256"], "Worker source identity disagrees")
    for key in ("renderExitCode", "hardTimedOut", "executionMode", "memoryCap"):
        require(result[key] == process[key], f"Result/process outcome disagrees: {key}")
    for name, expected in plan["frozenHarnessFiles"].items():
        require(digest(CONTROLLER / name) == expected, f"Frozen harness changed: {name}")
    for folder, field in (("runtime", "runtimeDependencyFiles"), ("autorouter-dependencies", "autorouterDependencyFiles")):
        require(digest(root / folder / "package.json") == manifest[field]["packageSha256"] and
                digest(root / folder / "bun.lock") == manifest[field]["lockSha256"], "External dependency lock changed")
    helper = read(root / "cases/assessment-helper-proof.json")
    require(helper["assessmentOnly"] and helper["rendererNeverImportsThisAdapter"], "Assessment helper policy changed")
    published_core = next(row for row in read(root / "published-runtime-manifest.json")["packages"]
                          if row["name"] == "@tscircuit/core")
    require(helper["coreIdentity"]["entrySha256"] == published_core["entrySha256"],
            "Assessment helper does not use published Core")
    require({row["name"] for row in helper["files"]} == {path.name for path in (root / "npm/core/dist").glob("*.js")},
            "Published assessment JS graph changed")
    for row in helper["files"]:
        original = (root / "npm/core/dist" / row["name"]).read_bytes()
        actual = (root / "cases/assessment-core" / row["name"]).read_bytes()
        expected_tail = "\nexport { findFloatingCopper as benchmarkFindFloatingCopper };\n" if row["name"] == "index.js" else ""
        require(hashlib.sha256(original).hexdigest() == row["originalSha256"] and
                hashlib.sha256(actual).hexdigest() == row["outputSha256"] and
                row["appendedTail"] == expected_tail and
                actual == original + row["appendedTail"].encode(), "Published assessment helper bytes changed")
    if cohort == "original":
        require(Path(task["assessmentCopperModule"]).read_text() ==
                'export { benchmarkFindFloatingCopper as findFloatingCopper } from "./assessment-core/index.js"\n',
                "Assessment bridge changed")
    require(digest(task["sourcePath"]) == task["sourceSha256"] == case["sourceSha256"], "Authentic source changed")
    for key, value in case["immutablePolicy"].items():
        require(progress[key] == value, f"Source or policy changed: {key}")
    for kind in ("implementationFiles", "assessmentSourceFiles"):
        expected = {(row["path"], row["sha256"]) for row in case[kind]}
        actual = {(str(Path(row["path"]).relative_to(root)), row["sha256"]) for row in task[kind]}
        require(actual == expected and task[kind] == progress[kind], f"Authentic {kind} changed")
        require(all(digest(row["path"]) == row["sha256"] for row in task[kind]), f"Source bytes changed: {kind}")
    for key in ("captureDeadlineMs", "hardDeadlineMs"):
        require(result[key] == process[key] == progress[key] == case["immutablePolicy"][key], "Capture budget changed")
    require(result["memoryCap"] == process["memoryCap"] is None, "Artificial memory cap changed")
    require(result["auditExitCode"] == 0 and result["auditTimedOut"] is False and result["assessmentReady"],
            "Neutral assessment unavailable")
    require(result["completeSourceCounts"] and result["routingPolicyObserved"], "Incomplete source or routing policy")
    require(progress["forbiddenRoutingSolverSelections"] == [], "Forbidden solver selection")
    require(progress["wasmUsage"]["routingOrUnknownAttempts"] == 0, "Routing/unknown WASM attempted")
    require(progress["wasmUsage"]["geometryCalls"] == before["progress"]["wasmUsage"]["geometryCalls"],
            "Published geometry policy changed")
    require(result["wasmUsage"] == progress["wasmUsage"], "WASM records disagree")
    require(result["dependencyOverrides"] == progress["dependencyOverrides"] == task["dependencyOverrides"] == [reuse["override"]],
            "Dependency override disagrees")
    require(progress["runtime"]["routingSourceOverride"] is False and progress["runtime"]["cacheEngine"] is False,
            "Routing/cache policy changed")
    expected_packages = {row["name"]: row for row in manifest["packages"]}
    actual_packages = {row["name"]: row for row in progress["runtime"]["packages"]}
    require(actual_packages.keys() == expected_packages.keys(), "Package set changed")
    for name, package in expected_packages.items():
        require(actual_packages[name]["version"] == package["version"] and
                actual_packages[name]["entrySha256"] == package["entrySha256"], "Runtime entry identity changed")
        folder = Path(package["entry"]).parent
        for _ in Path(package["entryRelative"]).parts[:-1]:
            folder = folder.parent
        require(all(digest(folder / row["path"]) == row["sha256"] for row in package["publishedFiles"]),
                "Runtime package graph changed after rendering")
    require(raw(before_folder / "unrouted.circuit.json.gz") == raw(after_folder / "unrouted.circuit.json.gz"),
            "Native unrouted CircuitJSON changed")
    captures_before = {path.name for path in before_folder.glob("phase-*.json.gz")}
    captures_after = {path.name for path in after_folder.glob("phase-*.json.gz")}
    changed = sorted(name for name in captures_before & captures_after
                     if raw(before_folder / name) != raw(after_folder / name))
    require(not changed, f"Native common phase bytes changed: {changed}")
    phase_identity = lambda phases: [{key: value for key, value in row.items()
                                     if key not in {"startedMs", "elapsedMs", "progress", "iterationsPerSecond"}}
                                    for row in phases]
    frontier = lambda run: {"status": run["progress"]["status"],
                           "renderCompleted": run["progress"]["renderCompleted"],
                           "renderExitCode": run["process"]["renderExitCode"],
                           "hardTimedOut": run["process"]["hardTimedOut"],
                           "errors": run["progress"]["errors"],
                           "phases": phase_identity(run["progress"]["phases"]),
                           "solvers": [{key: value for key, value in row.items() if key not in {"startedMs", "elapsedMs"}}
                                       for row in run["progress"]["solvers"]]}
    frontier_before, frontier_after = frontier(before), frontier(after)
    frontier_changed = frontier_before != frontier_after or captures_before != captures_after
    native = read(task["sourcePath"])
    requested = ({net["nativeName"] for net in native["nets"] if net["routable"]}
                 if cohort == "original" else
                 {trace["nativeNet"] for trace in native["traces"] if len(trace["path"]) > 1})
    connected_before = connected(before, requested, cohort)
    connected_after = connected(after, requested, cohort)
    gained, lost = sorted(connected_after - connected_before), sorted(connected_before - connected_after)
    physical_report = None
    physical_error = None
    try:
        physical = module("physical", "compare-core-publication-physical.py")
        physical_report = physical.compare_physical(before, after, accepted_gain=(board, cohort) == ("butterstick", "spaced"))
        if (board, cohort) == ("butterstick", "spaced"):
            require(gained == sorted(plan["butterGainedNets"]), "Expected primary Butter gain differs")
            accepted = read(after_folder / "phase-1-output.srj.json.gz")
            source_nets = {row["name"]: row["source_net_id"] for row in after["circuit"] if row["type"] == "source_net"}
            dq_ids = {source_nets[trace["name"]] for trace in native["traces"] if trace["nativeNet"] in gained}
            primary = module("primary", "verify-core-publication.py")
            primary.verify_materialization(after, accepted, dq_ids)
        require(not lost, f"Previously connected names missing: {lost}")
    except ValueError as error:
        physical_error = str(error)
    passed = not frontier_changed and physical_error is None
    return {"board": board, "cohort": cohort, "passed": passed,
            "status": "qualified" if passed else "frontier_review_required" if frontier_changed else "physical_review_required",
            "requestedNets": len(requested), "connectedBefore": len(connected_before),
            "connectedAfter": len(connected_after), "gainedNames": gained, "lostNames": lost,
            "commonNativeCapturesExact": len(captures_before & captures_after),
            "missingBaselineCaptures": sorted(captures_before - captures_after),
            "additionalCaptures": sorted(captures_after - captures_before),
            "frontierChanged": frontier_changed, "frontierBefore": frontier_before, "frontierAfter": frontier_after,
            "physicalComparison": physical_report, "physicalDifference": physical_error,
            "baselineLastProgressElapsedMs": before["progress"]["elapsedMs"],
            "candidateLastProgressElapsedMs": progress["elapsedMs"],
            "actualCircuitSnapshotElapsedMs": None,
            "snapshotTimingLimitation": "The unchanged renderer records progress time, not an independent CircuitJSON save timestamp.",
            "completeAndClean": result["completeAndClean"], "timingIsDiagnosticOnly": True,
            "primaryArtifactId": reuse["primaryArtifact"]["id"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("board")
    parser.add_argument("cohort", choices=["original", "spaced"])
    args = parser.parse_args()
    output = args.root / "results" / args.board / args.cohort / "regression.json"
    try:
        report = verify(args.root.resolve(), args.board, args.cohort,
                        read(CONTROLLER / "core-publication-all-ten-plan.json"))
    except (ValueError, KeyError, OSError, TypeError, StopIteration) as error:
        report = {"board": args.board, "cohort": args.cohort, "passed": False,
                  "status": "qualification_error", "error": str(error)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items()
                      if key not in {"physicalComparison", "frontierBefore", "frontierAfter"}}, sort_keys=True))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
