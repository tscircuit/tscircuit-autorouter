#!/usr/bin/env python3
"""Print ordinary matched benchmark observations, never circuit/fixture payloads."""

import json
import os
from pathlib import Path
import sys

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
        timing = row.get("stageTiming")
        if timing is not None:
            for stage in timing["stages"]:
                stage_totals[lane][stage["stageName"]] = stage_totals[lane].get(stage["stageName"], 0) + stage["elapsedTimeMs"]
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
           "newSolveFailures": new_solve_failures, "newDrcFailures": new_drc_failures,
           "gainedSolves": gained_solves, "stageTotalsMs": stage_totals,
           "nativePublicationQualificationSeparate": True}
(output / "pair-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print("DATASET18_PAIRED_SUMMARY " + json.dumps(summary))
for name in sorted(set(new_solve_failures + new_drc_failures)):
    print("DATASET18_NEW_FAILURE " + json.dumps({"sample": name, "base": {key: tests["base"][name].get(key) for key in fields + ["drcErrorTypes", "drcErrorMessages"]}, "pr": {key: tests["pr"][name].get(key) for key in fields + ["drcErrorTypes", "drcErrorMessages"]}}))

ordinary = output / "comparison.md"
parts = ["# Dataset18: published AR1107 versus one-byte budget diagnostic\n",
         "Both lanes use the same AR1107 evaluation source and fixtures. Routing entries differ only at the frozen budget byte. This is diagnostic evidence, not a production-fix recommendation.\n",
         "Base entry: `" + summary["entryHashes"]["base"] + "`; diagnostic entry: `" + summary["entryHashes"]["pr"] + "`.\n"]
if ordinary.exists():
    parts.append(ordinary.read_text())
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
