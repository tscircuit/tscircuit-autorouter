#!/usr/bin/env python3
"""Parse selected original cases without promoting them to a full-corpus result."""
import argparse
import collections
import hashlib
import json
import math
import pathlib
import re
import statistics

SCOPE = "FOREST_SCOPE_TARGETED_AFFECTED_CASES_ONLY"
TARGETS = {"srj18": [4], "srj24": [5, 9, 10, 16]}
COUNTS = {"srj18": 16, "srj24": 26}
BASELINE = "637b6c581128238f6c61227a1c15be423d24baca"
BRANCH = "codex/deep-experiment-forest-scope-targeted"
SOLVER = "AutoroutingPipelineSolver9_PreloadedTraceGraph"
MODULE = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts"
ASSETS = {"run-pinned-experiment.py", "select-pinned-experiment.py", "prepare-pinned-harness.py", "install-pinned-dependencies.py", "experiment-audit-adapter.ts", "qualify-pinned-output.ts", "experiment-dataset-identity.ts"}
VALIDATORS = {"lib/testing/evaluate-relaxed-drc.ts", "lib/testing/getDrcErrors.ts", "lib/testing/drcPresets.ts", "lib/testing/utils/convertToCircuitJson.ts", "lib/testing/utils/migrate-legacy-obstacle-circuit-json-metadata.ts"}
MANIFEST_DIGEST = "f03a89082fc21caa4e1f5f45bc92638032662a04b13c780e63e04e16774192a9"
WRAPPER_HASH = "3831fbd3dfdd18065195e43c91709cffaa0de2405fa27c7760b1a3c09d205b5b"


def validate_pins(pins):
    if pins.get("qualificationScope") != SCOPE or pins.get("fullPopulationComplete") is not False or pins.get("isFullCorpusSweep", False) is not False:
        raise ValueError("Pins must explicitly identify targeted-only incomplete full-population scope")
    if type(pins.get("runId")) is not int or pins["runId"] <= 0 or pins.get("pr") != 3198 or pins.get("controllerBranch") != BRANCH or pins.get("baselineSha") != BASELINE:
        raise ValueError("Invalid targeted run/PR/branch/baseline pins")
    for field in ["controllerSha", "controllerTree", "baselineSha", "candidateSha", "candidateTree"]:
        if not isinstance(pins.get(field), str) or re.fullmatch(r"[0-9a-f]{40}", pins[field]) is None:
            raise ValueError("Invalid immutable pin: " + field)
    manifest = pins.get("controllerManifest", {})
    if hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest() != MANIFEST_DIGEST or pins.get("targetedWrapperSha256") != WRAPPER_HASH:
        raise ValueError("Controller manifest or wrapper differs from the exact reviewed publication")
    if manifest.get("schemaVersion") != 1 or manifest.get("repository") != "tscircuit/tscircuit-autorouter" or manifest.get("qualificationScope") != SCOPE or manifest.get("targetedSampleNumbers") != TARGETS or manifest.get("datasets") != COUNTS or manifest.get("runPrNumbers") != [3198]:
        raise ValueError("Controller manifest does not identify the exact original targeted cases")
    if manifest.get("baselineSha") != pins["baselineSha"] or manifest.get("sampleTimeoutSeconds") != 360 or manifest.get("firstRound") != ["A", "B"] or manifest.get("optionalRepeatBeforeSeconds") != 0 or manifest.get("jobBudgetSeconds") != 19800:
        raise ValueError("Targeted protocol/baseline differs from its immutable pins")
    experiments = manifest.get("experiments", [])
    if len(experiments) != 1 or experiments[0].get("pr") != 3198 or experiments[0].get("candidateSha") != pins["candidateSha"]:
        raise ValueError("Candidate manifest differs from its immutable pin")
    publication = manifest.get("candidatePublication", {})
    if publication.get("status") != "PUBLISHED_EXACT_TREE_REVIEWED" or publication.get("publishedCommit") != pins["candidateSha"] or publication.get("expectedTree") != pins["candidateTree"]:
        raise ValueError("Published candidate/tree pin is missing or inconsistent")
    for config, options in [(manifest.get("baseline", {}), {"cacheProvider": None, "effort": 1}), (experiments[0], {"cacheProvider": None, "effort": 1, "usePhysicalNetForest": True})]:
        if config.get("solverName") != SOLVER or config.get("solverModule") != MODULE or json.dumps(config.get("options"), sort_keys=True) != json.dumps(options, sort_keys=True):
            raise ValueError("Pinned constructor/module/options changed")
    for dataset, count in COUNTS.items():
        hashes = manifest.get("expectedInputHashesByDataset", {}).get(dataset, {})
        if set(hashes) != {str(n) for n in range(1, count + 1)} or any(re.fullmatch(r"[0-9a-f]{64}", str(value)) is None for value in hashes.values()):
            raise ValueError("Full original preflight hashes are absent or malformed")
    hash_sets = [(manifest.get("runtimeSourceHashes", {}), ASSETS), (manifest.get("expectedHarnessSourceHashes", {}), {"officialHarnessHash", "benchmarkShellHash"}), (manifest.get("expectedValidatorHashes", {}), VALIDATORS)]
    for hashes, fields in hash_sets:
        if set(hashes) != fields or any(re.fullmatch(r"[0-9a-f]{64}", str(value)) is None for value in hashes.values()):
            raise ValueError("Required immutable runtime/harness/validator hashes are malformed")
    for value in [manifest.get("runSampleSourceSha256"), pins.get("targetedWrapperSha256")]:
        if re.fullmatch(r"[0-9a-f]{64}", str(value)) is None:
            raise ValueError("Original sample runner or targeted wrapper hash is missing")
    jobs = pins.get("jobs", {})
    if set(jobs) != set(COUNTS) or any(type(value) is not int or value <= 0 for value in jobs.values()) or len(set(jobs.values())) != 2:
        raise ValueError("Exact separate targeted job pins are required")
    if set(pins.get("artifacts", {})) != set(COUNTS):
        raise ValueError("Each targeted dataset needs an explicit artifact pin or pending null")
    return manifest


def is_clean(record):
    official = (record or {}).get("official") or {}
    return bool(official.get("didSolve") is True and official.get("didTimeout") is False and official.get("relaxedDrcPassed") is True and not record.get("controllerError"))


def summarize(records, dataset):
    selected = TARGETS[dataset]
    first = {(row["sampleNumber"], row["arm"]): row for row in records}
    wanted = {(sample, arm) for sample in selected for arm in ["A", "B"]}
    attempted = [sample for sample in selected if all((sample, arm) in first for arm in ["A", "B"])]
    mutual = [sample for sample in attempted if all(is_clean(first[sample, arm]) for arm in ["A", "B"])]
    ratios = [first[sample, "B"]["official"]["elapsedTimeMs"] / first[sample, "A"]["official"]["elapsedTimeMs"] for sample in mutual if first[sample, "A"]["official"]["elapsedTimeMs"] > 0]
    return {"qualificationScope": SCOPE, "targetedSampleNumbers": selected, "targetedSampleCount": len(selected), "fullDatasetSampleCount": COUNTS[dataset],
        "fullPopulationComplete": False, "isFullCorpusSweep": False, "firstRoundAttemptCount": len(first),
        "targetedFirstRoundComplete": set(first) == wanted and not any(row.get("controllerError") for row in first.values()),
        "officialCleanCount": {arm: sum(is_clean(first.get((sample, arm))) for sample in selected) for arm in ["A", "B"]},
        "cleanRegressions": [sample for sample in attempted if is_clean(first[sample, "A"]) and not is_clean(first[sample, "B"])],
        "cleanGains": [sample for sample in attempted if is_clean(first[sample, "B"]) and not is_clean(first[sample, "A"])],
        "mutuallyOfficialCleanSamples": mutual,
        "targetedMutuallyCleanRoutingTimeTotalsMs": {arm: sum(first[sample, arm]["official"]["elapsedTimeMs"] for sample in mutual) for arm in ["A", "B"]},
        "targetedMutuallyCleanMedianCandidateBaselineTimeRatio": statistics.median(ratios) if ratios else None,
        "targetedMutuallyCleanLegacyViaTotals": {arm: sum(first[sample, arm]["official"].get("viaCount", 0) for sample in mutual) for arm in ["A", "B"]}}


def parse_log(text, pins, dataset):
    manifest = validate_pins(pins)
    if dataset not in TARGETS:
        raise ValueError("Unknown original dataset")
    selected, issues, records, summaries, active = TARGETS[dataset], [], {}, [], []
    configs = {"A": manifest["baseline"], "B": manifest["experiments"][0]}
    checks = []
    marker_pattern = re.compile(r"(?<![A-Za-z0-9_])TARGETED_SCOPE_(ACTIVE|RESULT|SUMMARY)_JSON (.*)$")
    for line_number, line in enumerate(text.splitlines(), 1):
        match = marker_pattern.search(line)
        if not match:
            continue
        kind, raw = match.groups()
        try:
            value = json.loads(raw)
        except (ValueError, TypeError) as error:
            issues.append({"kind": "invalid_targeted_json", "line": line_number, "error": str(error)})
            continue
        before = len(issues)
        def issue(name, **details):
            issues.append({"kind": name, "line": line_number, "marker": kind, **details})
        if not isinstance(value, dict):
            issue("targeted_payload_not_object")
            continue
        if value.get("qualificationScope") != SCOPE or value.get("pr") != 3198 or value.get("dataset") != dataset:
            issue("targeted_scope_pr_or_dataset_mismatch")
        if kind == "SUMMARY":
            summaries.append(value)
            continue
        sample, arm = value.get("sampleNumber"), value.get("arm")
        if type(sample) is not int or sample not in selected or arm not in ["A", "B"] or type(value.get("round")) is not int or value.get("round") != 1:
            issue("unexpected_original_targeted_result_key", sample=sample, arm=arm, round=value.get("round"))
            continue
        if kind == "ACTIVE":
            if (sample, arm) in active:
                issue("duplicate_targeted_active_marker", sample=sample, arm=arm)
            if len(issues) == before:
                active.append((sample, arm))
            continue
        if value.get("fullPopulationComplete") is not False or value.get("isFullCorpusSweep", False) is not False or value.get("targetedSampleNumbers") != selected:
            issue("targeted_result_denominator_or_full_scope_mismatch")
        expected_sha = pins["baselineSha"] if arm == "A" else pins["candidateSha"]
        expected_hash = manifest["expectedInputHashesByDataset"][dataset][str(sample)]
        for field, wanted in [("sha", expected_sha), ("solverName", configs[arm]["solverName"]), ("expectedInputHash", expected_hash)]:
            if value.get(field) != wanted:
                issue("targeted_result_identity_mismatch", field=field, expected=wanted, observed=value.get(field))
        if not isinstance(value.get("scenarioName"), str) or not value["scenarioName"]:
            issue("missing_original_scenario_name")
        official = value.get("official")
        if official is not None and not isinstance(official, dict):
            issue("invalid_official_record")
            official = None
        if official:
            if any(type(official.get(field)) is not bool for field in ["didSolve", "didTimeout", "relaxedDrcPassed"]):
                issue("invalid_official_outcome_flags")
            elapsed = official.get("elapsedTimeMs")
            if type(elapsed) not in [int, float] or not math.isfinite(elapsed) or elapsed < 0:
                issue("invalid_official_routing_time")
            if "sampleNumber" in official and (type(official["sampleNumber"]) is not int or official["sampleNumber"] != sample):
                issue("official_sample_number_mismatch")
            via_count = official.get("viaCount")
            if via_count is None and official.get("didSolve") is True:
                issue("missing_official_via_count_for_solved_record")
            elif via_count is not None and (type(via_count) not in [int, float] or not math.isfinite(via_count) or via_count < 0):
                issue("invalid_official_via_count")
        elif not value.get("controllerError"):
            issue("missing_official_record_without_controller_error")
        evidence = (official or {}).get("routingMetrics") or {}
        evidence = evidence.get("experimentAudit") if isinstance(evidence, dict) else None
        if evidence is not None:
            if not isinstance(evidence, dict):
                issue("invalid_factory_evidence")
            else:
                wanted_fields = {"actualSolverName": SOLVER, "actualConstructorName": SOLVER, "solverModule": MODULE, "options": configs[arm]["options"], "inputHash": expected_hash, "inputMutated": False}
                for field, wanted in wanted_fields.items():
                    if json.dumps(evidence.get(field), sort_keys=True) != json.dumps(wanted, sort_keys=True):
                        issue("factory_options_or_input_mismatch", field=field)
                if evidence.get("solverFailed") and (official or {}).get("didSolve"):
                    issue("invalid_solved_failed_state")
            checks.append({"sample": sample, "arm": arm, "status": "final_factory_evidence_checked"})
        else:
            progress = value.get("lastObservedEvidence")
            if progress:
                if not isinstance(progress, dict) or progress.get("actualSolverName") != SOLVER or progress.get("inputHash") != expected_hash:
                    issue("progress_solver_or_input_mismatch")
            if (official or {}).get("didSolve") is True:
                issue("missing_final_factory_evidence_for_solved_record")
            checks.append({"sample": sample, "arm": arm, "status": "progress_only" if progress else "unavailable_final_factory_evidence"})
        key = (sample, arm)
        if key in records:
            issue("duplicate_targeted_result", sample=sample, arm=arm)
        if len(issues) == before:
            records[key] = value
    accepted = list(records.values())
    summary = summarize(accepted, dataset)
    if len(summaries) > 1:
        issues.append({"kind": "duplicate_targeted_summary", "count": len(summaries)})
    if len(summaries) == 1:
        reported = summaries[0]
        for field, wanted in summary.items():
            if reported.get(field) != wanted:
                issues.append({"kind": "targeted_summary_mismatch", "field": field, "expected": wanted, "observed": reported.get(field)})
        if reported.get("recordCount") != len(accepted):
            issues.append({"kind": "targeted_summary_record_count_mismatch"})
    names = collections.defaultdict(set)
    for row in accepted:
        names[row["sampleNumber"]].add(row["scenarioName"])
    for sample, values in names.items():
        if len(values) != 1:
            issues.append({"kind": "paired_original_scenario_name_mismatch", "sample": sample})
    missing = [{"sample": sample, "arm": arm} for sample in selected for arm in ["A", "B"] if (sample, arm) not in records]
    return {**summary, "recordCount": len(accepted), "runId": pins["runId"], "jobId": pins["jobs"][dataset], "dataset": dataset,
        "missing": missing, "completeSelectedPopulation": summary["targetedFirstRoundComplete"] and len(summaries) == 1 and not issues,
        "issues": issues, "constructorAndOptionsChecks": checks,
        "limits": "Only the explicitly selected original cases. Unknown, failed and unmatched attempts never become timing wins; other37 conditional unchanged-path cases are not observed here. Full EXPERIMENT markers are ignored."}, accepted


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pins", type=pathlib.Path, required=True)
    parser.add_argument("--dataset", choices=list(TARGETS), required=True)
    parser.add_argument("--log", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--records", type=pathlib.Path)
    args = parser.parse_args()
    audit, records = parse_log(args.log.read_text(), json.loads(args.pins.read_text()), args.dataset)
    args.output.write_text(json.dumps(audit, indent=2) + "\n")
    if args.records:
        args.records.write_text("".join(json.dumps(row) + "\n" for row in records))
    print(json.dumps({key: audit[key] for key in ["qualificationScope", "dataset", "targetedSampleNumbers", "targetedSampleCount", "fullDatasetSampleCount", "fullPopulationComplete", "isFullCorpusSweep", "completeSelectedPopulation", "recordCount", "issues"]}))
    if audit["issues"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
