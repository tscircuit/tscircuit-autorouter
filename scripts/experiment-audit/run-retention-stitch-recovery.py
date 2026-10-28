#!/usr/bin/env python3
"""Two-arm refinement qualification; reuse the exact original per-sample runner."""
import argparse
import hashlib
import importlib.util
import inspect
import json
import os
import pathlib
import platform
import re
import statistics
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pinned_runner", ROOT / "run-pinned-experiment.py")
pinned = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pinned)
MAIN = "637b6c581128238f6c61227a1c15be423d24baca"
COUNTS = {"srj18": 16}
ORIGINAL_PASSING = {"srj18": list(range(1, 17))}
ORIGINAL_FAILING = {dataset: [n for n in range(1, COUNTS[dataset] + 1) if n not in ORIGINAL_PASSING[dataset]] for dataset in COUNTS}
REGRESSION_SCREEN = {"srj18": [14, 15]}
TARGETS = {dataset: sorted(set(REGRESSION_SCREEN[dataset] + ORIGINAL_FAILING[dataset])) for dataset in COUNTS}
MODULE = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts"
SOLVER = "AutoroutingPipelineSolver9_PreloadedTraceGraph"
# Filled only after the geometry agent reports its reviewed selector API.
GEOMETRY_MODULE = "lib/testing/CertifiedDirectAutoroutingPipelineSolver.ts"
GEOMETRY_SOLVER = "CertifiedDirectAutoroutingPipelineSolver"
COMMON_OPTIONS = {"cacheProvider": None, "effort": 1}
FIXES_OPTIONS = {**COMMON_OPTIONS, "usePhysicalNetForest": False, "retainBestPartialRouting": False, "usePhysicalNetForestInteriorCosts": False}
RETENTION_OPTIONS = {**FIXES_OPTIONS, "retainBestPartialRouting": True}
FOREST_OPTIONS = {**RETENTION_OPTIONS, "usePhysicalNetForest": True, "usePhysicalNetForestInteriorCosts": True}
PRIOR_SOURCE = "da7e7416de7e18a5598e37e5af12a3416fbcd9c3"
PRIOR_TREE = "3ed382dbaadda2733a894c2663fa107c00129e59"
CAMPAIGNS = {
    "fixed-source-retention-off-vs-on": {"pr": 3338, "family": "retention", "baselineKind": "candidate", "aOptions": {**COMMON_OPTIONS, "retainBestPartialRouting": False}, "bOptions": {**COMMON_OPTIONS, "retainBestPartialRouting": True}},
    "retention-stitch-recovery": {"pr": 3338, "family": "retention", "baselineKind": "pinned-prior", "aOptions": {**COMMON_OPTIONS, "retainBestPartialRouting": True}, "bOptions": {**COMMON_OPTIONS, "retainBestPartialRouting": True}},
}

ASSETS = {"run-pinned-experiment.py", "select-pinned-experiment.py", "prepare-pinned-harness.py", "install-pinned-dependencies.py", "experiment-audit-adapter.ts", "qualify-pinned-output.ts", "experiment-dataset-identity.ts", "phase-checkpoint-observer.ts", "capture-terminal-failure-geometry.ts", "run-retention-stitch-recovery.py"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evidence_paths(family):
    if family == "geometry":
        return ["selection", "stats"]
    if family == "retention":
        prefix = "portPointPathingSolver.tinyPipelineSolver.solveGraph."
        return [prefix + suffix for suffix in ["RETAIN_BEST_PARTIAL_ROUTING", "stats.retainedPartialRouteCount", "stats.retainedPartialLiveRipCount", "state.ripCount"]]
    return ["physicalNetForestSolver.diagnostics", "highDensityRouteSolver.benchmarkDiagnosticCounters"]


def validate_manifest(path):
    manifest = json.loads(pathlib.Path(path).read_text())
    campaign = CAMPAIGNS.get(manifest.get("campaign"))
    if campaign is None or manifest.get("datasets") != COUNTS or manifest.get("targetedSampleNumbers") != TARGETS:
        raise ValueError("Unexpected refinement campaign or original population")
    if manifest.get("originalPassingSampleNumbers") != ORIGINAL_PASSING or manifest.get("originalFailingSampleNumbers") != ORIGINAL_FAILING:
        raise ValueError("Original33 passing identities and nine failures must remain explicit")
    if manifest.get("harnessSha") != MAIN or manifest.get("runPrNumbers") != [campaign["pr"]] or len(manifest.get("experiments", [])) != 1:
        raise ValueError("Original harness and one exact two-arm experiment are required")
    expected_protocol = {"sampleTimeoutSeconds": 360, "firstRound": ["A", "B"], "optionalSecondRound": ["B", "A"], "optionalRepeatBeforeSeconds": 0, "jobBudgetSeconds": 19800, "allowedExecutionOrders": ["AB", "BA"]}
    if any(manifest.get(key) != value for key, value in expected_protocol.items()):
        raise ValueError("The effort1/thread1/360s protocol or separate-order policy changed")
    publication = manifest.get("candidatePublication", {})
    if publication.get("status") != "PUBLISHED_EXACT_TREE_REVIEWED" or not re.fullmatch(r"[0-9a-f]{40}", str(publication.get("expectedTree"))) or not re.fullmatch(r"[0-9a-f]{40}", str(publication.get("reviewedLocalCommit"))):
        raise ValueError("Refined source is not frozen/published/reviewed yet")
    for dataset in COUNTS:
        _, experiment = pinned.selector.select(path, campaign["pr"], dataset)
        hashes = manifest.get("expectedInputHashesByDataset", {}).get(dataset, {})
        if set(hashes) != {str(n) for n in range(1, COUNTS[dataset] + 1)} or any(not re.fullmatch(r"[0-9a-f]{64}", str(v)) for v in hashes.values()):
            raise ValueError("All42 original input hashes must remain pinned")
    if experiment["candidateSha"] != publication.get("publishedCommit"):
        raise ValueError("Candidate differs from the reviewed publication")
    expected_baseline = experiment["candidateSha"] if campaign["baselineKind"] == "candidate" else PRIOR_SOURCE
    expected_baseline_tree = publication["expectedTree"] if campaign["baselineKind"] == "candidate" else PRIOR_TREE
    if manifest.get("baselineTree") != expected_baseline_tree:
        raise ValueError("Exact original retention-enabled source tree required")
    if manifest["baselineSha"] != expected_baseline:
        raise ValueError("Same-source ablations require the same refined SHA; main comparison requires main637")
    expected_b_module = GEOMETRY_MODULE if campaign["family"] == "geometry" else MODULE
    expected_b_solver = GEOMETRY_SOLVER if campaign["family"] == "geometry" else SOLVER
    if expected_b_module is None or expected_b_solver is None:
        raise ValueError("Geometry selector API is not reviewed/frozen yet")
    for config, options, module, solver in [(manifest["baseline"], campaign["aOptions"], MODULE, SOLVER), (experiment, campaign["bOptions"], expected_b_module, expected_b_solver)]:
        if config.get("solverName") != solver or config.get("solverModule") != module or config.get("options") != options or config.get("evidencePaths") != evidence_paths(campaign["family"]):
            raise ValueError("Exact constructor/options changed")
    expected_target = "selected-pipeline9-child" if campaign["family"] == "geometry" else None
    if experiment.get("phaseCheckpointTarget") != expected_target or manifest["baseline"].get("phaseCheckpointTarget") is not None:
        raise ValueError("Unexpected measurement target policy")
    if set(manifest.get("runtimeSourceHashes", {})) != ASSETS:
        raise ValueError("Exact runtime source inventory is required")
    for name, wanted in manifest["runtimeSourceHashes"].items():
        if sha(ROOT / name) != wanted:
            raise ValueError("Runtime source differs: " + name)
    if hashlib.sha256(inspect.getsource(pinned.run_sample).encode()).hexdigest() != manifest.get("runSampleSourceSha256"):
        raise ValueError("Original run_sample function changed")
    return manifest, experiment


def selected_numbers(dataset, population):
    if population not in ["screen", "full"]:
        raise ValueError("Population must be screen19 or complete42")
    return TARGETS[dataset] if population == "screen" else list(range(1, COUNTS[dataset] + 1))


def preflight(manifest, dataset, identities, mode):
    if identities["A"] != identities["B"] or [r["sampleNumber"] for r in identities["A"]] != list(range(1, COUNTS[dataset] + 1)):
        raise ValueError("Both arms must expose the complete original population in original order")
    if {str(r["sampleNumber"]): r["inputHash"] for r in identities["A"]} != manifest["expectedInputHashesByDataset"][dataset]:
        raise ValueError("Original input identities differ")
    selected = selected_numbers(dataset, mode)
    return [r for r in identities["A"] if r["sampleNumber"] in selected]


def verify_harnesses(manifest, experiment, harnesses):
    for arm in ["A", "B"]:
        value = harnesses[arm]
        if value.get("checkoutSha") != (manifest["baselineSha"] if arm == "A" else experiment["candidateSha"]):
            raise ValueError("Algorithm checkout SHA differs")
        for key, expected in manifest["expectedHarnessSourceHashes"].items():
            if value.get(key) != expected:
                raise ValueError("Pinned/instrumented harness differs: " + key)
        if value.get("validators") != manifest["expectedValidatorHashes"]:
            raise ValueError("Pinned validator source differs")
    for field in ["officialHarnessHash", "adaptedHarnessHash", "adapterHash", "benchmarkShellHash", "phaseCheckpointObserverHash", "terminalFailureGeometryCaptureHash", "validators"]:
        if harnesses["A"].get(field) != harnesses["B"].get(field):
            raise ValueError("Both arms must receive the identical observer/harness")


def checkpoint_audit(raw, metadata):
    errors = []
    rows = []
    try:
        lines = (raw / "phase-checkpoints.jsonl").read_bytes().splitlines()
        if not lines or len(lines) > 256 or any(len(line) > 4095 for line in lines):
            errors.append("Checkpoint row count/size bounds violated")
        rows = [json.loads(line) for line in lines]
        for index, row in enumerate(rows):
            if row.get("sequence") != index or any(row.get(k) != v for k, v in metadata.items()):
                errors.append("Checkpoint sequence/provenance differs")
                break
        status = json.loads((raw / "phase-checkpoint-status.json").read_text())
        if status.get("observerSourceSha256") != metadata["observerSourceSha256"] or not any(row.get("event") == "solve_enter" for row in rows):
            errors.append("Observer source hash/solve entry not proven")
        if not status.get("installed") or not status.get("solveEntered") or status.get("errors") or status.get("truncated"):
            errors.append("Observer coverage/status incomplete")
    except Exception as error:
        errors.append(str(error))
        status = None
    return {"errors": errors, "rowCount": len(rows), "status": status, "lastDurableCheckpoint": rows[-1] if rows else None,
        "interpretation": "Last synchronous lifecycle boundary only; not proof of later inactivity or a pure constructor/HD runtime. Historical callback-derived phase labels remain separate."}


def summary(records, dataset, mode, order="AB"):
    selected = selected_numbers(dataset, mode)
    keys = [(r["sampleNumber"], r["arm"]) for r in records]
    if order not in ["AB", "BA"] or len(keys) != len(set(keys)) or any(s not in selected or a not in ["A", "B"] for s, a in keys):
        raise ValueError("Duplicate/foreign result key or execution order")
    first = dict(zip(keys, records))
    paired = [s for s in selected if all((s, a) in first for a in ["A", "B"])]
    mutual = [s for s in paired if all(pinned.is_clean(first[s, a]) for a in ["A", "B"])]
    ratios = [first[s, "B"]["official"]["elapsedTimeMs"] / first[s, "A"]["official"]["elapsedTimeMs"] for s in mutual if first[s, "A"]["official"]["elapsedTimeMs"] > 0]
    expected_preserved = [s for s in selected if s in ORIGINAL_PASSING[dataset]]
    counts = {a: sum(pinned.is_clean(first.get((s, a))) for s in selected) for a in ["A", "B"]}
    return {"sampleCount": len(selected), "selectedSampleNumbers": selected, "firstRoundAttemptCount": len(records),
        "firstRoundComplete": len(records) == 2 * len(selected) and not any(r["controllerError"] for r in records),
        "officialCleanCount": counts,
        "cleanRegressions": [s for s in paired if pinned.is_clean(first[s, "A"]) and not pinned.is_clean(first[s, "B"])],
        "cleanGains": [s for s in paired if pinned.is_clean(first[s, "B"]) and not pinned.is_clean(first[s, "A"])],
        "historicalPassingSamplesInPopulation": expected_preserved,
        "historicalPassingSamplesNotRetained": {a: [s for s in expected_preserved if (s, a) in first and not pinned.is_clean(first[s, a])] for a in ["A", "B"]},
        "historicalPassingSamplesMissingResults": {a: [s for s in expected_preserved if (s, a) not in first] for a in ["A", "B"]},
        "historicalFailingSamplesNowClean": {a: [s for s in ORIGINAL_FAILING[dataset] if s in selected and pinned.is_clean(first.get((s, a)))] for a in ["A", "B"]},
        "mutuallyOfficialCleanSamples": mutual,
        "mutuallyCleanRoutingTimeTotalsMs": {a: sum(first[s, a]["official"]["elapsedTimeMs"] for s in mutual) for a in ["A", "B"]},
        "mutuallyCleanMedianCandidateBaselineTimeRatio": statistics.median(ratios) if ratios else None,
        "qualificationMode": mode, "isFullCorpusSweep": mode == "full", "fullDatasetSampleCount": COUNTS[dataset],
        "diagnosticCoveragePass": all(not r["phaseCheckpointAudit"]["errors"] for r in records),
        "executionOrder": order,
        "timingQualification": "Own fresh matched " + order + " pairs only. Reversed order is a separate fresh run and evidence record; never replaces AB failures or missing samples. Do not pool across hosts, campaigns, versions or selected/full populations."}


def run(args, manifest, experiment):
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError("Output must be new; attempts cannot be overwritten")
    checkouts = {"A": args.baseline.resolve(), "B": args.candidate.resolve()}
    identities = {arm: pinned.read_identity(checkout, args.dataset) for arm, checkout in checkouts.items()}
    if args.population != "screen": raise ValueError("Recovery runs only original samples14/15")
    selected = preflight(manifest, args.dataset, identities, args.population)
    harnesses = {a: json.loads((c / "experiment-harness-provenance.json").read_text()) for a, c in checkouts.items()}
    verify_harnesses(manifest, experiment, harnesses)
    dependencies = pinned.compare_dependency_resolutions(harnesses)
    configs = {"A": dict(manifest["baseline"]), "B": dict(experiment)}
    for arm, config in configs.items():
        config["phaseCheckpoint"] = {"observerSourceSha256": manifest["runtimeSourceHashes"]["phase-checkpoint-observer.ts"], "campaign": manifest["campaign"],
            "algorithmSha": manifest["baselineSha"] if arm == "A" else experiment["candidateSha"], "arm": arm, "executionOrder": args.order,
            "githubRunId": os.environ.get("GITHUB_RUN_ID"), "controllerSha": os.environ.get("GITHUB_SHA")}
        pinned.write_json(output / f"config-{arm}.json", config)
    pinned.write_json(output / "provenance.json", {"manifest": manifest, "experiment": experiment, "dataset": args.dataset,
        "inputPopulation": identities["A"], "selectedInputPopulation": selected, "qualificationMode": args.population, "executionOrder": args.order,
        "harnesses": harnesses, "dependencyComparison": dependencies, "githubRunId": os.environ.get("GITHUB_RUN_ID"),
        "githubRunAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"), "controllerSha": os.environ.get("GITHUB_SHA"),
        "machine": {"platform": platform.platform(), "architecture": platform.machine(), "cpuCount": os.cpu_count()},
        "wrapperSha256": sha(pathlib.Path(__file__)), "runtimeSourceHashes": manifest["runtimeSourceHashes"]})
    records = []
    started = time.monotonic()
    prefix = "STRONGEST_REFINEMENT"
    for identity in selected:
        if time.monotonic() - started >= manifest["jobBudgetSeconds"]:
            raise TimeoutError("Controller budget exhausted; remaining cases stay missing")
        sample = identity["sampleNumber"]
        for arm in list(args.order):
            print(prefix + "_ACTIVE_JSON " + json.dumps({"campaign": manifest["campaign"], "pr": experiment["pr"], "dataset": args.dataset, "round": 1, "sampleNumber": sample, "arm": arm, "executionOrder": args.order}), flush=True)
            target = output / "round-1" / f"sample-{sample:03d}" / arm
            record = pinned.run_sample(checkouts[arm], output / f"config-{arm}.json", target, args.dataset, sample, manifest["sampleTimeoutSeconds"])
            record.update({"campaign": manifest["campaign"], "qualificationMode": args.population, "pr": experiment["pr"], "dataset": args.dataset,
                "round": 1, "sampleNumber": sample, "executionOrder": args.order, "scenarioName": identity["scenarioName"], "expectedInputHash": identity["inputHash"],
                "arm": arm, "sha": configs[arm]["phaseCheckpoint"]["algorithmSha"], "solverName": configs[arm]["solverName"]})
            evidence = (record.get("official") or {}).get("routingMetrics", {}).get("experimentAudit")
            if evidence and evidence.get("inputHash") != identity["inputHash"]:
                record["controllerError"] = "Input hash differs from original population"
            record["phaseCheckpointAudit"] = checkpoint_audit(target / "raw", {"campaign": manifest["campaign"], "arm": arm,
                "algorithmSha": record["sha"], "dataset": args.dataset, "originalSample": sample, "inputSha256": identity["inputHash"],
                "observerSourceSha256": manifest["runtimeSourceHashes"]["phase-checkpoint-observer.ts"], "executionOrder": args.order})
            records.append(record)
            pinned.write_json(target / "audit-result.json", record)
            with (output / "results.jsonl").open("a") as stream:
                stream.write(json.dumps(record) + "\n")
            print(prefix + "_RESULT_JSON " + json.dumps(record, separators=(",", ":")), flush=True)
            pinned.write_json(output / "summary.json", summary(records, args.dataset, args.population, args.order))
    result = {**summary(records, args.dataset, args.population, args.order), "campaign": manifest["campaign"], "pr": experiment["pr"], "dataset": args.dataset,
        "recordCount": len(records), "completedSecondRound": False, "totalControllerWallSeconds": time.monotonic() - started}
    pinned.write_json(output / "summary.json", result)
    print(prefix + "_SUMMARY_JSON " + json.dumps(result, separators=(",", ":")), flush=True)
    if not result["firstRoundComplete"] or not result["diagnosticCoveragePass"]:
        raise RuntimeError("Population or observational coverage incomplete; outcomes remain retained")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["plan", "select", "verify-checkouts", "run"], required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--population", choices=["screen"], default="screen")
    parser.add_argument("--order", choices=["AB", "BA"], default="AB")
    parser.add_argument("--dataset", choices=list(COUNTS))
    parser.add_argument("--baseline", type=pathlib.Path)
    parser.add_argument("--candidate", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    manifest, experiment = validate_manifest(args.manifest)
    outputs = {}
    if args.mode == "plan":
        outputs["matrix"] = json.dumps({"include": [{"dataset": ds, "population": args.population, "order": args.order, "count": len(selected_numbers(ds, args.population))} for ds in COUNTS]}, separators=(",", ":"))
    elif args.mode == "select":
        outputs = {"baseline_sha": manifest["baselineSha"], "candidate_sha": experiment["candidateSha"], "harness_sha": MAIN}
    elif args.mode == "verify-checkouts":
        for arm, checkout, expected in [("A", args.baseline, manifest["baselineSha"]), ("B", args.candidate, experiment["candidateSha"])]:
            if checkout is None:
                raise ValueError("Both checkouts required")
            head, tree = [subprocess.check_output(["git", "rev-parse", ref], cwd=checkout, text=True).strip() for ref in ["HEAD", "HEAD^{tree}"]]
            wanted_tree = manifest["candidatePublication"]["expectedTree"] if arm == "B" or CAMPAIGNS[manifest["campaign"]]["baselineKind"] == "candidate" else manifest["baselineTree"]
            if [head, tree] != [expected, wanted_tree]:
                raise ValueError("Exact checkout commit/tree differs: " + arm)
    else:
        if any(v is None for v in [args.dataset, args.baseline, args.candidate, args.output]):
            raise ValueError("run requires dataset/baseline/candidate/output")
        run(args, manifest, experiment)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.writelines(f"{key}={value}\n" for key, value in outputs.items())
    print(json.dumps(outputs, sort_keys=True))


if __name__ == "__main__":
    main()
