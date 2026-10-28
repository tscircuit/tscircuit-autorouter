#!/usr/bin/env python3
"""Run only five original affected cases through the unchanged pinned sample runner."""
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
spec = importlib.util.spec_from_file_location("unchanged_pinned_runner", ROOT / "run-pinned-experiment.py")
pinned = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pinned)
SCOPE = "FOREST_SCOPE_TARGETED_AFFECTED_CASES_ONLY"
TARGETS = {"srj18": [4], "srj24": [5, 9, 10, 16]}
COUNTS = {"srj18": 16, "srj24": 26}
BASELINE = "637b6c581128238f6c61227a1c15be423d24baca"
ASSETS = {"run-pinned-experiment.py", "select-pinned-experiment.py", "prepare-pinned-harness.py", "install-pinned-dependencies.py", "experiment-audit-adapter.ts", "qualify-pinned-output.ts", "experiment-dataset-identity.ts"}
MODULE = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts"
SOLVER = "AutoroutingPipelineSolver9_PreloadedTraceGraph"


def validate_manifest(path):
    manifest = json.loads(pathlib.Path(path).read_text())
    if manifest.get("qualificationScope") != SCOPE or manifest.get("targetedSampleNumbers") != TARGETS or manifest.get("datasets") != COUNTS:
        raise ValueError("Only the explicit original five affected cases are authorized")
    if manifest.get("baselineSha") != BASELINE or manifest.get("runPrNumbers") != [3198] or len(manifest.get("experiments", [])) != 1:
        raise ValueError("Targeted qualification must contain only PR3198 and the pinned baseline")
    if manifest.get("sampleTimeoutSeconds") != 360 or manifest.get("firstRound") != ["A", "B"] or manifest.get("optionalRepeatBeforeSeconds") != 0 or manifest.get("jobBudgetSeconds") != 19800:
        raise ValueError("Targeted qualification preserves the360s AB-only protocol and controller budget")
    publication = manifest.get("candidatePublication", {})
    if publication.get("status") != "PUBLISHED_EXACT_TREE_REVIEWED" or not re.fullmatch(r"[0-9a-f]{40}", str(publication.get("expectedTree"))):
        raise ValueError("Published, reviewed exact scope-tree pin is still pending")
    for dataset in COUNTS:
        _, experiment = pinned.selector.select(path, 3198, dataset)
        hashes = manifest.get("expectedInputHashesByDataset", {}).get(dataset, {})
        if set(hashes) != {str(n) for n in range(1, COUNTS[dataset] + 1)} or any(not re.fullmatch(r"[0-9a-f]{64}", str(value)) for value in hashes.values()):
            raise ValueError("All original full-population preflight input hashes must remain pinned")
    if publication.get("publishedCommit") != experiment["candidateSha"]:
        raise ValueError("Candidate SHA does not match the explicitly published scope commit")
    for config, options in [(manifest["baseline"], {"cacheProvider": None, "effort": 1}), (experiment, {"cacheProvider": None, "effort": 1, "usePhysicalNetForest": True})]:
        if config.get("solverName") != SOLVER or config.get("solverModule") != MODULE or config.get("options") != options:
            raise ValueError("Exact pinned constructor/module/options changed")
    hashes = manifest.get("runtimeSourceHashes", {})
    if set(hashes) != ASSETS:
        raise ValueError("Every unchanged runtime source must be explicitly pinned")
    for name, wanted in hashes.items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != wanted:
            raise ValueError("Unchanged measurement/runtime source differs: " + name)
    if hashlib.sha256(inspect.getsource(pinned.run_sample).encode()).hexdigest() != manifest.get("runSampleSourceSha256"):
        raise ValueError("The original run_sample function differs from its reviewed source")
    return manifest, experiment


def preflight_selection(manifest, dataset, identities):
    if identities["A"] != identities["B"] or len(identities["A"]) != COUNTS[dataset]:
        raise ValueError("Both arms must expose the same complete original input population")
    population = identities["A"]
    if [row["sampleNumber"] for row in population] != list(range(1, COUNTS[dataset] + 1)):
        raise ValueError("Original sample numbers/order are required; no renumbering is allowed")
    if {str(row["sampleNumber"]): row["inputHash"] for row in population} != manifest["expectedInputHashesByDataset"][dataset]:
        raise ValueError("The full preflight population differs from the pinned original hashes")
    return [row for row in population if row["sampleNumber"] in TARGETS[dataset]]


def summarize_targeted(records, dataset):
    selected = TARGETS[dataset]
    first = {}
    for record in records:
        key = (record["sampleNumber"], record["arm"])
        if record.get("round") != 1 or key[0] not in selected or key[1] not in ["A", "B"] or key in first:
            raise ValueError("Unexpected or duplicate targeted result key")
        first[key] = record
    wanted = {(sample, arm) for sample in selected for arm in ["A", "B"]}
    observed = set(first)
    mutual = [sample for sample in selected if all(pinned.is_clean(first.get((sample, arm))) for arm in ["A", "B"])]
    attempted = [sample for sample in selected if all((sample, arm) in first for arm in ["A", "B"])]
    totals = {arm: sum(first[sample, arm]["official"]["elapsedTimeMs"] for sample in mutual) for arm in ["A", "B"]}
    ratios = [first[sample, "B"]["official"]["elapsedTimeMs"] / first[sample, "A"]["official"]["elapsedTimeMs"] for sample in mutual if first[sample, "A"]["official"]["elapsedTimeMs"] > 0]
    return {"qualificationScope": SCOPE, "targetedSampleNumbers": selected, "targetedSampleCount": len(selected),
        "fullDatasetSampleCount": COUNTS[dataset], "fullPopulationComplete": False, "isFullCorpusSweep": False,
        "firstRoundAttemptCount": len(first), "targetedFirstRoundComplete": observed == wanted and not any(row.get("controllerError") for row in first.values()),
        "missingTargetedAttempts": [{"sample": sample, "arm": arm} for sample, arm in sorted(wanted - observed)],
        "officialCleanCount": {arm: sum(pinned.is_clean(first.get((sample, arm))) for sample in selected) for arm in ["A", "B"]},
        "cleanRegressions": [sample for sample in attempted if pinned.is_clean(first[sample, "A"]) and not pinned.is_clean(first[sample, "B"])],
        "cleanGains": [sample for sample in attempted if pinned.is_clean(first[sample, "B"]) and not pinned.is_clean(first[sample, "A"])],
        "mutuallyOfficialCleanSamples": mutual, "targetedMutuallyCleanRoutingTimeTotalsMs": totals,
        "targetedMutuallyCleanMedianCandidateBaselineTimeRatio": statistics.median(ratios) if ratios else None,
        "targetedMutuallyCleanLegacyViaTotals": {arm: sum(first[sample, arm]["official"].get("viaCount", 0) for sample in mutual) for arm in ["A", "B"]},
        "timingQualification": "Own matched first AB pairs for these explicitly selected cases only. No BA replication, cross-dataset sum or pooled full-corpus runtime; failed/missing routes never become timing or via wins.",
        "other37Qualification": "The other37 cases were not rerouted here. Their unchanged-path evidence remains conditional and separate."}


def verify_harnesses(manifest, experiment, harnesses):
    for arm in ["A", "B"]:
        value = harnesses[arm]
        if value.get("checkoutSha") != (manifest["baselineSha"] if arm == "A" else experiment["candidateSha"]):
            raise ValueError("Harness checkout SHA differs from the selected exact ref")
        for field, wanted in manifest["expectedHarnessSourceHashes"].items():
            if value.get(field) != wanted:
                raise ValueError("Pinned official harness source changed: " + field)
        if value.get("validators") != manifest["expectedValidatorHashes"]:
            raise ValueError("Pinned official validator source changed")
    for field in ["officialHarnessHash", "adaptedHarnessHash", "adapterHash", "benchmarkShellHash", "validators"]:
        if harnesses["A"].get(field) != harnesses["B"].get(field):
            raise ValueError("The arms do not use the same adapted official harness")


def run_targeted(args, manifest, experiment):
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError("Targeted output must be new; retained attempts cannot be silently overwritten")
    checkouts = {"A": args.baseline.resolve(), "B": args.candidate.resolve()}
    identities = {arm: pinned.read_identity(checkout, args.dataset) for arm, checkout in checkouts.items()}
    selected = preflight_selection(manifest, args.dataset, identities)
    configs = {"A": manifest["baseline"], "B": experiment}
    harnesses = {arm: json.loads((checkout / "experiment-harness-provenance.json").read_text()) for arm, checkout in checkouts.items()}
    verify_harnesses(manifest, experiment, harnesses)
    dependencies = pinned.compare_dependency_resolutions(harnesses)
    for arm, config in configs.items():
        pinned.write_json(output / f"config-{arm}.json", config)
    provenance = {"manifest": manifest, "experiment": experiment, "dataset": args.dataset, "inputPopulation": identities["A"],
        "targetedInputPopulation": selected, "qualificationScope": SCOPE, "targetedSampleNumbers": TARGETS[args.dataset],
        "targetedSampleCount": len(selected), "fullDatasetSampleCount": COUNTS[args.dataset], "fullPopulationComplete": False,
        "machine": {"platform": platform.platform(), "architecture": platform.machine(), "cpuCount": os.cpu_count()},
        "harnesses": harnesses, "dependencyComparison": dependencies, "githubRunId": os.environ.get("GITHUB_RUN_ID"),
        "githubRunAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"), "controllerSha": os.environ.get("GITHUB_SHA"),
        "runtimeVerification": {"runtimeSourceHashes": manifest["runtimeSourceHashes"], "runSampleSourceSha256": manifest["runSampleSourceSha256"], "targetedWrapperSha256": hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}}
    pinned.write_json(output / "provenance.json", provenance)
    records = []
    started = time.monotonic()
    pinned.write_json(output / "targeted-summary.json", summarize_targeted(records, args.dataset))
    for identity in selected:
        if time.monotonic() - started >= manifest["jobBudgetSeconds"]:
            raise TimeoutError("Targeted controller budget exhausted; remaining selected cases stay missing")
        sample = identity["sampleNumber"]
        for arm in ["A", "B"]:
            print("TARGETED_SCOPE_ACTIVE_JSON " + json.dumps({"qualificationScope": SCOPE, "pr": 3198, "dataset": args.dataset, "round": 1, "sampleNumber": sample, "arm": arm}), flush=True)
            target = output / "round-1" / f"sample-{sample:03d}" / arm
            record = pinned.run_sample(checkouts[arm], output / f"config-{arm}.json", target, args.dataset, sample, manifest["sampleTimeoutSeconds"])
            record.update({"qualificationScope": SCOPE, "pr": 3198, "dataset": args.dataset, "round": 1, "sampleNumber": sample,
                "scenarioName": identity["scenarioName"], "expectedInputHash": identity["inputHash"], "arm": arm,
                "sha": manifest["baselineSha"] if arm == "A" else experiment["candidateSha"], "solverName": configs[arm]["solverName"],
                "fullPopulationComplete": False, "targetedSampleNumbers": TARGETS[args.dataset]})
            evidence = (record.get("official") or {}).get("routingMetrics", {}).get("experimentAudit")
            if evidence and evidence.get("inputHash") != identity["inputHash"]:
                record["controllerError"] = "Solver input hash differs from the original preflight population"
            records.append(record)
            pinned.write_json(target / "audit-result.json", record)
            with (output / "targeted-results.jsonl").open("a") as stream:
                stream.write(json.dumps(record) + "\n")
            print("TARGETED_SCOPE_RESULT_JSON " + json.dumps(record, separators=(",", ":")), flush=True)
            pinned.write_json(output / "targeted-summary.json", summarize_targeted(records, args.dataset))
    summary = {**summarize_targeted(records, args.dataset), "pr": 3198, "dataset": args.dataset,
        "recordCount": len(records), "totalTargetedControllerWallSeconds": time.monotonic() - started}
    pinned.write_json(output / "targeted-summary.json", summary)
    print("TARGETED_SCOPE_SUMMARY_JSON " + json.dumps(summary, separators=(",", ":")), flush=True)
    if not summary["targetedFirstRoundComplete"]:
        raise RuntimeError("Targeted AB population is incomplete; inspect retained diagnostics")
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["plan", "select", "verify-candidate", "run"], required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--dataset", choices=list(COUNTS))
    parser.add_argument("--baseline", type=pathlib.Path)
    parser.add_argument("--candidate", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    manifest, experiment = validate_manifest(args.manifest)
    outputs = {}
    if args.mode == "plan":
        matrix = {"include": [{"pr": 3198, "dataset": ds, "targetedSampleCount": len(TARGETS[ds]), "originalSamples": ",".join(map(str, TARGETS[ds]))} for ds in COUNTS]}
        outputs = {"matrix": json.dumps(matrix, separators=(",", ":"))}
        print(outputs["matrix"])
    elif args.mode == "select":
        if not args.dataset:
            raise ValueError("select requires the original dataset")
        outputs = {"baseline_sha": manifest["baselineSha"], "candidate_sha": experiment["candidateSha"], "candidate_tree": manifest["candidatePublication"]["expectedTree"], "repository": manifest["repository"]}
        print(json.dumps({"qualificationScope": SCOPE, "originalSamples": TARGETS[args.dataset], **outputs}))
    elif args.mode == "verify-candidate":
        if not args.candidate:
            raise ValueError("verify-candidate requires its checkout")
        observed = [subprocess.check_output(["git", "rev-parse", ref], cwd=args.candidate, text=True).strip() for ref in ["HEAD", "HEAD^{tree}"]]
        if observed != [experiment["candidateSha"], manifest["candidatePublication"]["expectedTree"]]:
            raise ValueError("Candidate checkout differs from the published reviewed commit/tree")
        print(json.dumps({"qualificationScope": SCOPE, "candidateSha": observed[0], "candidateTree": observed[1]}))
    else:
        if any(value is None for value in [args.dataset, args.baseline, args.candidate, args.output]):
            raise ValueError("run requires dataset, baseline, candidate and output")
        run_targeted(args, manifest, experiment)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.writelines(f"{key}={value}\n" for key, value in outputs.items())


if __name__ == "__main__":
    main()
