#!/usr/bin/env python3
"""Run cold matched sample pairs on one runner, retaining the official reports."""
import argparse
import importlib.util
import json
import os
import pathlib
import platform
import signal
import statistics
import subprocess
import time

MODULE_ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("select_experiment", MODULE_ROOT / "select-pinned-experiment.py")
selector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selector)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def compact_checks(supplemental):
    if not supplemental:
        return None
    names = ["referenceFullCopperChecks", "inputOnlyPhysicalChecks", "inputOnlyConnectivityFindings", "libraryRoutingChecks", "boardCopperChecks", "viaBoardChecks"]
    return {**{name: {key: supplemental[name][key] for key in ["count", "byType"]} for name in names},
            "physicalCopper": supplemental["physicalCopper"], "validationTimeMs": supplemental["supplementalValidationTimeMs"]}


def read_identity(checkout, dataset):
    result = subprocess.run(["bun", "scripts/benchmark/experiment-dataset-identity.ts", dataset], cwd=checkout, capture_output=True, text=True, check=True)
    return json.loads(result.stdout.strip().splitlines()[-1])


def compare_dependency_resolutions(harnesses):
    left = harnesses["A"]["dependencyResolution"].get("directDependencies", {})
    right = harnesses["B"]["dependencyResolution"].get("directDependencies", {})
    mismatches = []
    changed = []
    for name in sorted(set(left) | set(right)):
        if name not in left or name not in right or left[name]["declaration"] != right[name]["declaration"]:
            changed.append(name)
        elif any(left[name].get(key) != right[name].get(key) for key in ["resolvedName", "resolvedVersion", "packageJsonSha256", "missingPackageJson"]):
            mismatches.append(name)
    if mismatches:
        raise ValueError("Identical direct dependency declarations resolved differently: " + ", ".join(mismatches))
    inventories = {}
    for arm in ["A", "B"]:
        inventory = {}
        for package in harnesses[arm]["dependencyResolution"].get("installedPackages", []):
            inventory.setdefault(package["name"], set()).add((package["version"], package["packageJsonSha256"]))
        inventories[arm] = inventory
    transitive_differences = [name for name in sorted(set(inventories["A"]) | set(inventories["B"])) if inventories["A"].get(name) != inventories["B"].get(name)]
    critical = {"@tscircuit/checks", "circuit-json", "circuit-json-to-connectivity-map", "@tscircuit/math-utils", "graphics-debug", "@tscircuit/pcb-trace-linter"}
    critical_mismatches = [name for name in transitive_differences if name in critical and name not in changed]
    if critical_mismatches:
        raise ValueError("Shared validation/geometry dependency inventories differ: " + ", ".join(critical_mismatches))
    return {"changedDirectDependencyDeclarations": changed,
            "sameDeclarationResolutionMismatchCount": len(mismatches),
            "transitivePackageInventoryDifferences": transitive_differences,
            "limitation": "Transitive package inventories are retained; source has no lockfile. Equal direct declarations are required to resolve to equal package manifests, not asserted to prove complete dependency graph equivalence."}


def execute_with_deadline(command, checkout, env, log, timeout):
    process = subprocess.Popen(command, cwd=checkout, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    timed_out = False
    try:
        code = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        code = None
    finally:
        # All work belongs to this sample. Kill any surviving descendants even
        # if their shell parent exited first; no process may leak into arm B.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
    return code, timed_out


def run_sample(checkout, config_path, output, dataset, sample, sample_timeout):
    output.mkdir(parents=True, exist_ok=True)
    report_path = checkout / "benchmark-result.json"
    for filename in ["benchmark-result.json", "benchmark-result.txt", "benchmark-snapshots.html", "benchmark-failure.json", "benchmark-interrupted.json"]:
        (checkout / filename).unlink(missing_ok=True)
    env = os.environ.copy()
    env["EXPERIMENT_AUDIT_CONFIG"] = str(config_path)
    env["EXPERIMENT_AUDIT_OUTPUT"] = str(output / "raw")
    command = ["bash", "benchmark.sh", "--pipeline", "9", "--dataset", dataset,
               "--sample", str(sample), "--concurrency", "1", "--threads", "1", "--effort", "1",
               "--sample-timeout", f"{sample_timeout}s"]
    started = time.monotonic()
    failure = None
    with (output / "benchmark.log").open("w") as log:
        code, timed_out = execute_with_deadline(command, checkout, env, log, sample_timeout + 120)
        if timed_out:
            failure = "External controller deadline exceeded; this is not an official routing result"
        elif code:
            failure = f"Benchmark command exited {code}"
    external_wall = (time.monotonic() - started) * 1000
    row = None
    for filename in ["benchmark-result.json", "benchmark-result.txt", "benchmark-snapshots.html", "benchmark-failure.json", "benchmark-interrupted.json"]:
        source = checkout / filename
        if source.exists():
            (output / filename).write_bytes(source.read_bytes())
    if report_path.exists():
        report = json.loads(report_path.read_text())
        rows = report.get("tests", [])
        if len(rows) != 1 or rows[0]["sampleNumber"] != sample:
            failure = "Official report has an unexpected sample population"
        else:
            row = rows[0]
    elif failure is None:
        failure = "Benchmark command did not produce its official report"
    supplemental = None
    validation_failure = None
    raw = output / "raw"
    if (raw / "raw-new-traces.json").exists():
        with (output / "supplemental-validation.log").open("w") as log:
            code, timed_out = execute_with_deadline(["bun", "scripts/benchmark/qualify-pinned-output.ts", str(raw)], checkout, env, log, sample_timeout)
            if timed_out:
                validation_failure = "Supplemental validator exceeded its independent deadline"
            elif code:
                validation_failure = f"Supplemental validator exited {code}"
        if (raw / "supplemental-validation.json").exists():
            supplemental = json.loads((raw / "supplemental-validation.json").read_text())
    progress_path = raw / "latest-progress-evidence.json"
    last_evidence = json.loads(progress_path.read_text()) if progress_path.exists() else None
    return {"official": row, "externalBenchmarkProcessWallMs": external_wall,
            "controllerError": failure, "supplementalValidationError": validation_failure,
            "lastObservedEvidence": last_evidence, "supplemental": compact_checks(supplemental)}


def is_clean(record):
    row = record and record.get("official")
    return bool(row and row["didSolve"] and not row["didTimeout"] and row["relaxedDrcPassed"] and not record["controllerError"])


def summarize(records, sample_count):
    first = {(record["sampleNumber"], record["arm"]): record for record in records if record["round"] == 1}
    clean = {arm: sum(is_clean(first.get((sample, arm))) for sample in range(1, sample_count + 1)) for arm in ["A", "B"]}
    mutual = [sample for sample in range(1, sample_count + 1) if all(is_clean(first.get((sample, arm))) for arm in ["A", "B"])]
    attempted_pairs = [sample for sample in range(1, sample_count + 1) if (sample, "A") in first and (sample, "B") in first]
    regressions = [sample for sample in attempted_pairs if is_clean(first.get((sample, "A"))) and not is_clean(first.get((sample, "B")))]
    gains = [sample for sample in attempted_pairs if is_clean(first.get((sample, "B"))) and not is_clean(first.get((sample, "A")))]
    times = {arm: sum(first[sample, arm]["official"]["elapsedTimeMs"] for sample in mutual) for arm in ["A", "B"]}
    ratios = [first[sample, "B"]["official"]["elapsedTimeMs"] / first[sample, "A"]["official"]["elapsedTimeMs"] for sample in mutual if first[sample, "A"]["official"]["elapsedTimeMs"] > 0]
    via_totals = {arm: sum(first[sample, arm]["official"].get("viaCount", 0) for sample in mutual) for arm in ["A", "B"]}
    return {"sampleCount": sample_count, "firstRoundAttemptCount": len(first),
            "firstRoundComplete": len(first) == sample_count * 2 and not any(item["controllerError"] for item in first.values()),
            "officialCleanCount": clean, "cleanRegressions": regressions, "cleanGains": gains,
            "mutuallyOfficialCleanSamples": mutual, "mutuallyCleanRoutingTimeTotalsMs": times,
            "mutuallyCleanMedianCandidateBaselineTimeRatio": statistics.median(ratios) if ratios else None,
            "mutuallyCleanLegacyRouteViaTotals": via_totals,
            "headlinePopulation": "Each sample counted once, using first matched AB pair. Optional BA repetitions are retained separately and never substitute for failures or missing samples."}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--dataset", choices=["srj18", "srj24"], required=True)
    parser.add_argument("--baseline", type=pathlib.Path, required=True)
    parser.add_argument("--candidate", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.output = args.output.resolve()
    manifest, experiment = selector.select(args.manifest, args.pr, args.dataset)
    checkouts = {"A": args.baseline.resolve(), "B": args.candidate.resolve()}
    identities = {arm: read_identity(checkout, args.dataset) for arm, checkout in checkouts.items()}
    if identities["A"] != identities["B"] or len(identities["A"]) != manifest["datasets"][args.dataset]:
        raise ValueError("Pinned revisions do not expose the exact same complete input population")
    configs = {"A": manifest["baseline"], "B": experiment}
    for arm, config in configs.items():
        write_json(args.output / f"config-{arm}.json", config)
    harnesses = {arm: json.loads((checkout / "experiment-harness-provenance.json").read_text()) for arm, checkout in checkouts.items()}
    dependency_comparison = compare_dependency_resolutions(harnesses)
    provenance = {"manifest": manifest, "experiment": experiment, "dataset": args.dataset, "inputPopulation": identities["A"],
                  "machine": {"platform": platform.platform(), "architecture": platform.machine(), "cpuCount": os.cpu_count()},
                  "harnesses": harnesses, "dependencyComparison": dependency_comparison,
                  "githubRunId": os.environ.get("GITHUB_RUN_ID"), "githubRunAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
                  "controllerSha": os.environ.get("GITHUB_SHA")}
    write_json(args.output / "provenance.json", provenance)
    started = time.monotonic()
    records = []
    first_duration = None
    for round_number, arm_order in [(1, manifest["firstRound"]), (2, manifest["optionalSecondRound"])]:
        elapsed = time.monotonic() - started
        if round_number == 2:
            if elapsed >= manifest["optionalRepeatBeforeSeconds"] or first_duration is None or elapsed + first_duration * 1.25 >= manifest["jobBudgetSeconds"]:
                print("EXPERIMENT_REPEAT_SKIPPED_JSON " + json.dumps({"pr": args.pr, "dataset": args.dataset, "elapsedSeconds": elapsed, "firstRoundSeconds": first_duration}), flush=True)
                break
        for identity in identities["A"]:
            if time.monotonic() - started >= manifest["jobBudgetSeconds"]:
                write_json(args.output / "summary.json", summarize(records, len(identities["A"])))
                raise TimeoutError("Controller exhausted job budget; unattempted samples remain missing")
            for arm in arm_order:
                sample = identity["sampleNumber"]
                print("EXPERIMENT_ACTIVE_JSON " + json.dumps({"pr": args.pr, "dataset": args.dataset, "round": round_number, "sampleNumber": sample, "arm": arm}), flush=True)
                output = args.output / f"round-{round_number}" / f"sample-{sample:03d}" / arm
                record = run_sample(checkouts[arm], args.output / f"config-{arm}.json", output, args.dataset, sample, manifest["sampleTimeoutSeconds"])
                record.update({"pr": args.pr, "dataset": args.dataset, "round": round_number, "sampleNumber": sample, "scenarioName": identity["scenarioName"], "expectedInputHash": identity["inputHash"], "arm": arm,
                               "sha": manifest["baselineSha"] if arm == "A" else experiment["candidateSha"], "solverName": configs[arm]["solverName"]})
                evidence = (record.get("official") or {}).get("routingMetrics", {}).get("experimentAudit")
                if evidence and evidence.get("inputHash") != identity["inputHash"]:
                    record["controllerError"] = "Solver input hash differs from preflight input population"
                records.append(record)
                write_json(output / "audit-result.json", record)
                with (args.output / "results.jsonl").open("a") as stream:
                    stream.write(json.dumps(record) + "\n")
                print("EXPERIMENT_RESULT_JSON " + json.dumps(record, separators=(",", ":")), flush=True)
                write_json(args.output / "summary.json", summarize(records, len(identities["A"])))
        if round_number == 1:
            first_duration = time.monotonic() - started
    summary = summarize(records, len(identities["A"]))
    summary.update({"pr": args.pr, "dataset": args.dataset, "totalControllerWallSeconds": time.monotonic() - started,
                    "recordCount": len(records), "completedSecondRound": len(records) == 4 * len(identities["A"])})
    write_json(args.output / "summary.json", summary)
    print("EXPERIMENT_SUMMARY_JSON " + json.dumps(summary, separators=(",", ":")), flush=True)
    if not summary["firstRoundComplete"]:
        raise RuntimeError("First-round population is incomplete; inspect retained diagnostics")


if __name__ == "__main__":
    main()
