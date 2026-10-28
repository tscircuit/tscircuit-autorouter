#!/usr/bin/env python3
"""Strict TARGETED5 provenance wrapper around unchanged raw/identity inspections."""
import argparse
import collections
import hashlib
import importlib.util
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("unchanged_targeted_identity", HERE / "inspect-via-identity-equivalence.py")
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)
base = identity.base
SCOPE = "FOREST_SCOPE_TARGETED_AFFECTED_CASES_ONLY"
TARGETS = {"srj18": [4], "srj24": [5, 9, 10, 16]}
COUNTS = {"srj18": 16, "srj24": 26}
PINS = {"runId": 40640929032, "controllerSha": "afc0e47ba5a03fe2d01959840d7bd92c165b7b1b", "controllerTree": "bf8fdd2f1085e1563387af61299657a3f0f04d4a", "controllerBranch": "codex/deep-experiment-forest-scope-targeted", "baselineSha": "637b6c581128238f6c61227a1c15be423d24baca", "candidateSha": "58873007d669bbeb0d53ea4cb19b983c10ab1c66", "candidateTree": "2b189aba98051506dcf7df7b426a06f3653dc99e", "pr": 3198}
RUN_SAMPLE_HASH = "c1d0e2572e06750a104c09e68df550873718945c707e76aacd1ecd8d2ad9a77e"
MANIFEST_DIGEST = "f03a89082fc21caa4e1f5f45bc92638032662a04b13c780e63e04e16774192a9"
WRAPPER_HASH = "3831fbd3dfdd18065195e43c91709cffaa0de2405fa27c7760b1a3c09d205b5b"
UNCHANGED_ANALYSIS = {"inspect-artifact.py": "0d5d77561be7105d75bcc1c68d02c5c5b05e64a1a3e974a09f7ee474e798ad83", "inspect-via-identity-equivalence.py": "ea3bab3579ca4dbb924e057477b85952624e543dd4b616dd746b475b11475c0e"}


def validate_expected(expected):
    dataset = expected.get("dataset")
    if dataset not in TARGETS or any(expected.get(key) != value for key, value in PINS.items()):
        raise ValueError("Expected source differs from the reviewed targeted campaign")
    if expected.get("qualificationScope") != SCOPE or expected.get("fullPopulationComplete") is not False or expected.get("isFullCorpusSweep") is not False:
        raise ValueError("Targeted evidence must never claim a full population")
    if expected.get("targetedSampleNumbers") != TARGETS[dataset] or expected.get("fullDatasetSampleCount") != COUNTS[dataset]:
        raise ValueError("Original selected numbers and1/4 denominators are required")
    full = expected.get("fullInputHashes", {})
    if set(full) != {str(n) for n in range(1, COUNTS[dataset] + 1)} or any(not re.fullmatch(r"[0-9a-f]{64}", str(value)) for value in full.values()):
        raise ValueError("Complete original preflight hashes are required")
    if expected.get("inputHashes") != {str(n): full[str(n)] for n in TARGETS[dataset]}:
        raise ValueError("Selected hashes must retain original sample numbering")
    manifest = expected.get("controllerManifest", {})
    if base.digest(manifest) != MANIFEST_DIGEST:
        raise ValueError("Expected controller manifest differs from the exact reviewed publication")
    if manifest.get("qualificationScope") != SCOPE or manifest.get("targetedSampleNumbers") != TARGETS or manifest.get("datasets") != COUNTS or manifest.get("baselineSha") != PINS["baselineSha"]:
        raise ValueError("The controller manifest has a different scope")
    if manifest.get("sampleTimeoutSeconds") != 360 or manifest.get("firstRound") != ["A", "B"] or manifest.get("optionalRepeatBeforeSeconds") != 0 or manifest.get("runPrNumbers") != [3198]:
        raise ValueError("Targeted AB-only routing protocol differs")
    experiments = manifest.get("experiments", [])
    if len(experiments) != 1 or experiments[0].get("candidateSha") != PINS["candidateSha"]:
        raise ValueError("Manifest candidate differs")
    if expected.get("configs") != {"A": manifest.get("baseline"), "B": experiments[0]}:
        raise ValueError("Expected constructor configurations differ from the controller")
    for arm, options in [("A", {"cacheProvider": None, "effort": 1}), ("B", {"cacheProvider": None, "effort": 1, "usePhysicalNetForest": True})]:
        config = expected["configs"][arm]
        if config.get("solverName") != "AutoroutingPipelineSolver9_PreloadedTraceGraph" or config.get("solverModule") != "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts" or config.get("options") != options:
            raise ValueError("Exact factory/module/options differ")
    publication = manifest.get("candidatePublication", {})
    if publication.get("status") != "PUBLISHED_EXACT_TREE_REVIEWED" or publication.get("publishedCommit") != PINS["candidateSha"] or publication.get("expectedTree") != PINS["candidateTree"]:
        raise ValueError("Reviewed scope-tree publication pin differs")
    for field, manifest_field in [("runtimeSourceHashes", "runtimeSourceHashes"), ("runSampleSourceSha256", "runSampleSourceSha256"), ("harnessSourceHashes", "expectedHarnessSourceHashes"), ("validatorHashes", "expectedValidatorHashes")]:
        if expected.get(field) != manifest.get(manifest_field):
            raise ValueError("Expected runtime/validator source pins differ: " + field)
    if expected.get("runSampleSourceSha256") != RUN_SAMPLE_HASH or expected.get("targetedWrapperSha256") != WRAPPER_HASH:
        raise ValueError("Unchanged sample runner/targeted wrapper source pin is absent")
    if manifest.get("expectedInputHashesByDataset", {}).get(dataset) != full:
        raise ValueError("Expected full input hashes differ from the controller")
    artifact = expected.get("artifact", {})
    if type(artifact.get("id")) is not int or artifact["id"] <= 0 or type(artifact.get("sizeBytes")) is not int or artifact["sizeBytes"] <= 0 or artifact.get("name") != f"targeted-forest-scope-3198-{dataset}" or not re.fullmatch(r"sha256:[0-9a-f]{64}", str(artifact.get("digest"))):
        raise ValueError("Exact targeted artifact ID/name/size/digest is required")
    for name, wanted in UNCHANGED_ANALYSIS.items():
        if hashlib.sha256((HERE / name).read_bytes()).hexdigest() != wanted:
            raise ValueError("Original full-analysis helper was modified: " + name)
    return TARGETS[dataset]


def clean(record):
    official = record.get("official") or {}
    return bool(official.get("didSolve") and not official.get("didTimeout") and official.get("relaxedDrcPassed") and not record.get("controllerError"))


def inspect_targeted(directory, expected, metadata_verification, example_limit=3):
    selected = validate_expected(expected)
    issues = []
    def issue(kind, **details):
        issues.append({"kind": kind, **details})
    metadata = metadata_verification.get("metadata", {})
    actual = {"id": metadata.get("id"), "name": metadata.get("name"), "sizeBytes": metadata.get("size_in_bytes"), "digest": metadata.get("digest")}
    workflow = metadata.get("workflow_run", {})
    if metadata_verification.get("qualification") != "EXACT_ARTIFACT_METADATA_VERIFIED" or metadata_verification.get("issues") or actual != expected["artifact"] or metadata.get("expired") is not False or workflow.get("id") != expected["runId"] or workflow.get("head_sha") != expected["controllerSha"] or workflow.get("head_branch") != expected["controllerBranch"]:
        issue("artifact_metadata_mismatch")
    matches = [path for path in directory.rglob("provenance.json") if base.read(path).get("dataset") == expected["dataset"] and base.read(path).get("experiment", {}).get("pr") == 3198]
    if len(matches) != 1:
        issue("source_root_count", count=len(matches))
        root, provenance = None, {}
    else:
        root, provenance = matches[0].parent, base.read(matches[0])
    if root is not None:
        for field, wanted in [("githubRunId", str(expected["runId"])), ("controllerSha", expected["controllerSha"]), ("qualificationScope", SCOPE), ("targetedSampleNumbers", selected), ("targetedSampleCount", len(selected)), ("fullDatasetSampleCount", COUNTS[expected["dataset"]]), ("fullPopulationComplete", False), ("manifest", expected["controllerManifest"]), ("experiment", expected["configs"]["B"])]:
            observed = str(provenance.get(field)) if field == "githubRunId" else provenance.get(field)
            if observed != wanted or (field == "fullPopulationComplete" and observed is not False):
                issue("targeted_provenance_mismatch", field=field)
        population = provenance.get("inputPopulation", [])
        if not isinstance(population, list) or [row.get("sampleNumber") for row in population] != list(range(1, COUNTS[expected["dataset"]] + 1)) or {str(row.get("sampleNumber")): row.get("inputHash") for row in population} != expected["fullInputHashes"]:
            issue("full_preflight_population_mismatch")
        if provenance.get("targetedInputPopulation") != [row for row in population if row.get("sampleNumber") in selected]:
            issue("targeted_preflight_selection_mismatch")
        runtime = provenance.get("runtimeVerification", {})
        for field in ["runtimeSourceHashes", "runSampleSourceSha256", "targetedWrapperSha256"]:
            if runtime.get(field) != expected[field]:
                issue("runtime_source_pin_mismatch", field=field)
        harnesses = provenance.get("harnesses", {})
        for arm in ["A", "B"]:
            if not (root / f"config-{arm}.json").exists() or base.read(root / f"config-{arm}.json") != expected["configs"][arm]:
                issue("config_mismatch", arm=arm)
            harness = harnesses.get(arm, {})
            if harness.get("checkoutSha") != expected["baselineSha" if arm == "A" else "candidateSha"]:
                issue("algorithm_checkout_mismatch", arm=arm)
            for field in ["officialHarnessHash", "adaptedHarnessHash", "adapterHash", "benchmarkShellHash"]:
                if not re.fullmatch(r"[0-9a-f]{64}", str(harness.get(field))):
                    issue("missing_harness_source_hash", arm=arm, field=field)
            for field, wanted in expected["harnessSourceHashes"].items():
                if harness.get(field) != wanted:
                    issue("harness_source_hash_mismatch", arm=arm, field=field)
            if harness.get("validators") != expected["validatorHashes"] or harness.get("adapterHash") != expected["runtimeSourceHashes"]["experiment-audit-adapter.ts"]:
                issue("validator_or_factory_adapter_source_mismatch", arm=arm)
        for field in ["officialHarnessHash", "adaptedHarnessHash", "adapterHash", "benchmarkShellHash", "validators"]:
            if harnesses.get("A", {}).get(field) != harnesses.get("B", {}).get(field):
                issue("matched_harness_mismatch", field=field)
    records = {}
    if root is not None:
        for path in sorted(root.rglob("audit-result.json")):
            record = base.read(path)
            key = (record.get("round"), record.get("sampleNumber"), record.get("arm"))
            if type(key[0]) is not int or key[0] != 1 or type(key[1]) is not int or key[1] not in selected or key[2] not in ["A", "B"] or key in records:
                issue("unexpected_or_duplicate_targeted_result", key=key)
                continue
            arm, sample = key[2], key[1]
            if path != root / "round-1" / f"sample-{sample:03d}" / arm / "audit-result.json":
                issue("original_number_output_path_mismatch", sample=sample, arm=arm)
            for field, wanted in [("qualificationScope", SCOPE), ("pr", 3198), ("dataset", expected["dataset"]), ("sha", expected["baselineSha" if arm == "A" else "candidateSha"]), ("expectedInputHash", expected["inputHashes"][str(sample)]), ("solverName", expected["configs"][arm]["solverName"]), ("targetedSampleNumbers", selected), ("fullPopulationComplete", False)]:
                if record.get(field) != wanted or (field == "fullPopulationComplete" and record.get(field) is not False):
                    issue("targeted_record_mismatch", sample=sample, arm=arm, field=field)
            official = record.get("official") or {}
            original_name = next((row.get("scenarioName") for row in provenance.get("inputPopulation", []) if row.get("sampleNumber") == sample), None)
            if record.get("scenarioName") != original_name:
                issue("original_scenario_name_mismatch", sample=sample, arm=arm)
            if official and official.get("sampleNumber") != sample:
                issue("renumbered_official_sample", sample=sample, arm=arm)
            routing_metrics = official.get("routingMetrics")
            if routing_metrics is not None and not isinstance(routing_metrics, dict):
                issue("invalid_routing_metrics", sample=sample, arm=arm)
            evidence = routing_metrics.get("experimentAudit") if isinstance(routing_metrics, dict) else None
            if evidence:
                config = expected["configs"][arm]
                for field, wanted in [("actualSolverName", config["solverName"]), ("actualConstructorName", config["solverName"]), ("solverModule", config["solverModule"]), ("options", config["options"]), ("inputHash", expected["inputHashes"][str(sample)])]:
                    if evidence.get(field) != wanted:
                        issue("actual_factory_or_input_mismatch", sample=sample, arm=arm, field=field)
                if evidence.get("inputMutated"):
                    issue("input_mutation", sample=sample, arm=arm)
            records[key] = (record, path)
    wanted_keys = {(1, sample, arm) for sample in selected for arm in ["A", "B"]}
    if set(records) != wanted_keys:
        issue("incomplete_targeted_population", missing=sorted(wanted_keys - set(records)))
    if root is not None:
        summary_path = root / "targeted-summary.json"
        summary = base.read(summary_path) if summary_path.exists() else {}
        own_clean = {arm: [sample for sample in selected if (1, sample, arm) in records and clean(records[1, sample, arm][0])] for arm in ["A", "B"]}
        mutual = sorted(set(own_clean["A"]) & set(own_clean["B"]))
        attempted = [sample for sample in selected if all((1, sample, arm) in records for arm in ["A", "B"])]
        expected_summary = {"qualificationScope": SCOPE, "targetedSampleNumbers": selected, "targetedSampleCount": len(selected), "fullDatasetSampleCount": COUNTS[expected["dataset"]], "fullPopulationComplete": False, "isFullCorpusSweep": False, "firstRoundAttemptCount": len(records), "targetedFirstRoundComplete": set(records) == wanted_keys and not any(value[0].get("controllerError") for value in records.values()), "officialCleanCount": {arm: len(values) for arm, values in own_clean.items()}, "mutuallyOfficialCleanSamples": mutual, "cleanRegressions": [sample for sample in attempted if sample in own_clean["A"] and sample not in own_clean["B"]], "cleanGains": [sample for sample in attempted if sample in own_clean["B"] and sample not in own_clean["A"]], "targetedMutuallyCleanRoutingTimeTotalsMs": {arm: sum(records[1, sample, arm][0]["official"]["elapsedTimeMs"] for sample in mutual) for arm in ["A", "B"]}}
        for field, wanted in expected_summary.items():
            if summary.get(field) != wanted or (field in ["fullPopulationComplete", "isFullCorpusSweep"] and summary.get(field) is not False):
                issue("targeted_summary_mismatch", field=field)
    wanted_provenance = {key: expected[key] for key in ["runId", "controllerSha", "baselineSha", "candidateSha", "pr", "dataset"]}
    report = {"qualificationScope": SCOPE, "fullPopulationComplete": False, "isFullCorpusSweep": False, "targetedSampleNumbers": selected, "targetedSampleCount": len(selected), "fullDatasetSampleCount": COUNTS[expected["dataset"]], "sourceArtifact": expected["artifact"], "expectedProvenance": wanted_provenance, "sourceArtifactMetadataVerification": metadata_verification, "analysisSources": {**UNCHANGED_ANALYSIS, "inspect-targeted-forest-scope-artifact.py": hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}, "results": []}
    if not issues:
        for key, (record, path) in sorted(records.items()):
            context = {"round": 1, "sample": key[1], "arm": key[2]}
            def sample_issue(kind, **details):
                issue(kind, **context, **details)
            raw = path.parent / "raw"
            row = {**context, "official": record.get("official"), "controllerError": record.get("controllerError"), "supplementalValidationError": record.get("supplementalValidationError")}
            if (raw / "capture-provenance.json").exists():
                row["inspection"] = base.inspect_raw(raw, record, expected, sample_issue, max(0, min(example_limit, 5)))
            elif clean(record):
                sample_issue("missing_raw_capture_for_clean_result")
            report["results"].append(row)
    if not issues:
        internal_proof = {"qualification": "PROVENANCE_CHECKS_PASSED", "expectedProvenance": wanted_provenance, "sourceArtifact": expected["artifact"], "sourceArtifactMetadataVerification": metadata_verification}
        report["typedIdentity"] = identity.inspect(directory, expected, internal_proof, include_baseline=True)
        report["typedIdentity"]["qualificationScope"] = SCOPE
        report["typedIdentity"]["fullPopulationComplete"] = False
        report["typedIdentity"]["isFullCorpusSweep"] = False
    report["integrityIssues"] = issues
    report["qualification"] = "TARGETED_SOURCE_PROVENANCE_CHECKS_PASSED" if not issues else "DISQUALIFIED_TARGETED_SOURCE_OR_CAPTURE"
    report["limits"] = "Read-only selected-case evidence only. Full original preflight hashes are verified, but only the explicitly selected1/4 original cases were routed. No source artifacts are edited and no solver/converter/checker is rerun. Raw/typed identity helpers are byte-identical to full-campaign tools; their internal capture proof never qualifies the other37 cases. Identity equality, reference checks and manufacturing/library constraints remain distinct. Exact segment deduplication is not arbitrary overlap union; partial ownership/width coverage remains explicit."
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=pathlib.Path, required=True)
    parser.add_argument("--expected", type=pathlib.Path, required=True)
    parser.add_argument("--source-metadata", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--example-limit", type=int, default=3)
    args = parser.parse_args()
    report = inspect_targeted(args.directory, base.read(args.expected), base.read(args.source_metadata), args.example_limit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(base.canonical(report) + "\n")
    summary = {key: report[key] for key in ["qualificationScope", "qualification", "fullPopulationComplete", "isFullCorpusSweep", "targetedSampleNumbers", "targetedSampleCount", "fullDatasetSampleCount", "sourceArtifact", "expectedProvenance", "integrityIssues"]}
    summary["officialAndReferenceCleanSamplesByArm"] = report.get("typedIdentity", {}).get("officialAndReferenceCleanSamplesByArm")
    print("TARGETED_AUDIT_SUMMARY_JSON " + base.canonical(summary))
    metrics = {(row["sample"], row["arm"]): row for row in report.get("typedIdentity", {}).get("results", [])}
    for row in report["results"]:
        typed = metrics.get((row["sample"], row["arm"]), {})
        print("TARGETED_AUDIT_BOARD_JSON " + base.canonical({"sample": row["sample"], "arm": row["arm"], "qualificationScope": SCOPE, "fullPopulationComplete": False, "official": {key: (row.get("official") or {}).get(key) for key in ["didSolve", "didTimeout", "relaxedDrcPassed", "elapsedTimeMs", "viaCount", "drcErrorCount", "error"]}, "controllerError": row.get("controllerError"), "supplementalValidationError": row.get("supplementalValidationError"), "checks": {name: {key: value.get(key) for key in ["count", "byType", "normalizedErrorFingerprintMultisetHash"]} for name, value in row.get("inspection", {}).get("checks", {}).items()}, "typedNormalizedCopperMetrics": typed.get("explicitIdentityNormalizedCopperMetrics"), "viaPadClassificationCounts": typed.get("viaPadClassificationCounts"), "siteClassificationCounts": typed.get("siteClassificationCounts"), "portExplicitComponentClassificationCounts": typed.get("portExplicitComponentFindings", {}).get("classificationCounts")}))
    if report["integrityIssues"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
