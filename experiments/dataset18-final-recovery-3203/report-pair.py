#!/usr/bin/env python3
"""Print ordinary matched benchmark observations, never circuit/fixture payloads."""

import json
import math
import os
from pathlib import Path
import sys


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = (len(ordered) - 1) * fraction
    lower = math.floor(index)
    upper = math.ceil(index)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)


workspace = Path(sys.argv[1]).resolve()
output = workspace / "same-machine-results"
proof = json.loads((workspace / "dataset18-pair-proof/provenance.json").read_text())
reports = {}
for lane in ["base", "pr"]:
    path = output / lane / "benchmark-result.json"
    if path.exists():
        reports[lane] = json.loads(path.read_text())
    else:
        print("DATASET18_REPORT_UNAVAILABLE " + json.dumps({"lane": lane, "path": str(path)}))
if len(reports) != 2:
    raise SystemExit("An interrupted/missing lane is not a completed paired benchmark")

tests = {}
stage_totals = {}
runtime = {}
timing = {}
clean_cases = {}
fields = ["sampleNumber", "scenarioName", "didSolve", "relaxedDrcPassed", "drcErrorCount",
          "didTimeout", "sampleTimeoutMs", "elapsedTimeMs", "peakRssBytes", "viaCount",
          "traceLintIssueCounts", "errorPhaseName", "errorSolverName", "error", "stageTiming"]
for lane, report in reports.items():
    if report["datasetName"] != "srj18" or report["scenarioCount"] != 16 or len(report["tests"]) != 16:
        raise RuntimeError("Dataset18 denominator changed")
    if report["memoryMeasurementMode"] != "isolated_process_per_sample":
        raise RuntimeError("Per-sample memory measurement changed")
    runtime[lane] = report["runtime"]
    if runtime[lane]["requestedConcurrency"] != 4 or runtime[lane]["threadsPerSample"] != 1:
        raise RuntimeError("Requested benchmark CPU allocation changed")
    tests[lane] = {}
    stage_totals[lane] = {}
    for row in report["tests"]:
        name = row["scenarioName"]
        if name in tests[lane] or row["solverName"] != "AutoroutingPipelineSolver9_PreloadedTraceGraph":
            raise RuntimeError("Duplicate case or unexpected routing solver")
        if row["sampleTimeoutMs"] != 360000:
            raise RuntimeError("Per-case wall timeout changed")
        tests[lane][name] = row
        observation = {field: row.get(field) for field in fields}
        print("DATASET18_CASE " + json.dumps({"lane": lane, **observation}))
        stage_timing = row.get("stageTiming")
        if stage_timing is not None:
            for stage in stage_timing["stages"]:
                stage_totals[lane][stage["stageName"]] = stage_totals[lane].get(stage["stageName"], 0) + stage["elapsedTimeMs"]
    observed = [row["elapsedTimeMs"] for row in report["tests"]]
    if any(not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 for value in observed):
        raise RuntimeError("Observed elapsed timing is missing or invalid")
    penalized = [row["elapsedTimeMs"] if row["didSolve"] else row["sampleTimeoutMs"] for row in report["tests"]]
    timing[lane] = {
        "caseCount": len(observed),
        "observedTotalMs": sum(observed),
        "observedMedianMs": percentile(observed, 0.5),
        "observedP95Ms": percentile(observed, 0.95),
        "failedPenaltyMedianMs": percentile(penalized, 0.5),
        "failedPenaltyP95Ms": percentile(penalized, 0.95),
        "failedPenaltyCaseCount": sum(not row["didSolve"] for row in report["tests"]),
        "failedPenaltyMs": 360000,
    }
    clean_cases[lane] = sum(row["didSolve"] and row["relaxedDrcPassed"] for row in report["tests"])
    print("DATASET18_STAGE_TOTALS " + json.dumps({"lane": lane, "milliseconds": stage_totals[lane], "completeCases": sum(row.get("stageTiming") is not None and row["stageTiming"]["status"] == "complete" for row in report["tests"])}))

expected_names = {item["name"] for item in proof["lanes"]["base"]["identity"]["fixtures"]}
if set(tests["base"]) != expected_names or set(tests["pr"]) != expected_names:
    raise RuntimeError("The completed report cases differ from the original fixture identities")
runtime_keys = ["bunVersion", "architecture", "availableParallelism", "memoryLimitBytes", "requestedConcurrency", "workerCount", "threadsPerSample", "effectiveThreadsPerSample"]
comparable = all(runtime["base"].get(key) == runtime["pr"].get(key) for key in runtime_keys)
new_solve_failures = [name for name in sorted(expected_names) if tests["base"][name]["didSolve"] and not tests["pr"][name]["didSolve"]]
new_drc_failures = [name for name in sorted(expected_names) if tests["base"][name]["relaxedDrcPassed"] and not tests["pr"][name]["relaxedDrcPassed"]]
gained_solves = [name for name in sorted(expected_names) if not tests["base"][name]["didSolve"] and tests["pr"][name]["didSolve"]]
summary = {"diagnosticOnly": True, "productionFixProposed": False, "entryHashes": {lane: proof["routingEntries"][lane]["sha256"] for lane in ["base", "pr"]},
           "sameVmSequentialPair": True, "runtimeComparable": comparable, "runtime": runtime,
           "summary": {lane: report["summary"] for lane, report in reports.items()},
           "cleanSolvedAndDrcPassed": clean_cases, "timingMs": timing,
           "timingPolicy": "All 16 observed elapsed values are retained. Standard percentiles substitute each unsolved case's 360000ms timeout, including early failures; both use linear interpolation at (n-1)*p.",
           "newSolveFailures": new_solve_failures, "newDrcFailures": new_drc_failures,
           "gainedSolves": gained_solves, "stageTotalsMs": stage_totals,
           "nativePublicationQualificationSeparate": True}
(output / "pair-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print("DATASET18_PAIRED_SUMMARY " + json.dumps(summary))
for name in sorted(set(new_solve_failures + new_drc_failures)):
    print("DATASET18_NEW_FAILURE " + json.dumps({"sample": name, "base": {key: tests["base"][name].get(key) for key in fields + ["drcErrorTypes", "drcErrorMessages"]}, "pr": {key: tests["pr"][name].get(key) for key in fields + ["drcErrorTypes", "drcErrorMessages"]}}))

ordinary = output / "comparison.md"
parts = ["# Dataset18: published AR1109 versus final-recovery-only diagnostic\n",
         "Both lanes use the same AR1109 evaluation source and fixtures. Only the Prepared conditional final recovery multiplier changes from 2 to 4; the main 2M allowance remains unchanged. This is diagnostic evidence, not a production-fix recommendation.\n",
         "Base entry: `" + summary["entryHashes"]["base"] + "`; diagnostic entry: `" + summary["entryHashes"]["pr"] + "`.\n"]
if ordinary.exists():
    parts.append(ordinary.read_text())
parts.extend(["\nAll-case observed timing and standard failed-case penalties:\n",
              "| Lane | Solved and DRC passed | Observed total s | Observed median s | Observed P95 s | Failed-penalty median s | Failed-penalty P95 s |\n|---|---|---|---|---|---|---|\n"])
for lane in ["base", "pr"]:
    values = timing[lane]
    parts.append(f"| {lane} | {clean_cases[lane]} / 16 | {values['observedTotalMs'] / 1000:.2f} | {values['observedMedianMs'] / 1000:.2f} | {values['observedP95Ms'] / 1000:.2f} | {values['failedPenaltyMedianMs'] / 1000:.2f} | {values['failedPenaltyP95Ms'] / 1000:.2f} |\n")
parts.append("\nObserved times include every case's recorded elapsed time. Standard failed-penalty percentiles substitute 360 seconds for every unsolved case, including early failures and timeouts. Both percentile series use linear interpolation at `(n - 1) * p`; the observed total is summed case time, not paired-job wall time.\n")
parts.extend(["\nPer-case observations:\n", "| Case | Solved base/head | DRC issues base/head | Timeout base/head | Vias base/head | Time s base/head | RSS MiB base/head |\n|---|---|---|---|---|---|---|\n"])
for name in sorted(expected_names):
    a, b = tests["base"][name], tests["pr"][name]
    seconds = [f"{row['elapsedTimeMs'] / 1000:.2f}" for row in [a, b]]
    rss = [f"{row['peakRssBytes'] / 1024 ** 2:.1f}" if row.get("peakRssBytes") is not None else "unavailable" for row in [a, b]]
    parts.append(f"| {name} | {a['didSolve']} / {b['didSolve']} | {a.get('drcErrorCount')} / {b.get('drcErrorCount')} | {a['didTimeout']} / {b['didTimeout']} | {a.get('viaCount')} / {b.get('viaCount')} | {' / '.join(seconds)} | {' / '.join(rss)} |\n")
parts.append("\nFull per-case stage timing and RSS observations are printed in the ordinary job log; partial timing retains its status. Worker allocation is memory-guarded and reported, not forced. A single base-first pair has order/noise limits.\n")
text = "\n".join(parts)
(output / "review.md").write_text(text)
print(text)
if os.environ.get("GITHUB_STEP_SUMMARY"):
    with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as stream:
        stream.write(text)
if not comparable:
    raise SystemExit("Runtime allocation differs; no fair paired timing claim")
