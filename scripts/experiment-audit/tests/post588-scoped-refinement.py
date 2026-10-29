"""Exact two-feature srj18/BA synthetic populations; never executes routing."""
import contextlib
import copy
import importlib.util
import io
import json
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(io.StringIO()):
        spec.loader.exec_module(module)
    return module


population = load("scoped_population_fixtures", ROOT / "tests/post588-parser-population.py")
runtime = population.runtime
sealer = load("scoped_manifest_sealer", ROOT / "seal-post588-manifest.py")
manifest = copy.deepcopy(population.manifest)
requested = ["path-packing", "incremental-path"]
manifest["requestedExperiments"] = requested
manifest["experiments"] = [copy.deepcopy(next(item for item in population.manifest["experiments"] if item["id"] == name)) for name in requested]
manifest["dispatchRequest"] = {"experiment": "all", "dataset": "srj18", "order": "BA"}
sealer.refresh(manifest, runtime)
assert manifest["runSampleSourceSha256"] == "c59222511a8fcade8c59399f8cca643f0ecffc33e8b6e4f01a19c675d8767396"
assert manifest["expectedHarnessSourceHashes"]["adaptedHarnessHash"] == "27354d365585b69e85ba6aa8917ca4a28b4b9650faa2cc196e0cc9761461afc9"
expected_scope = {"experiments": requested, "datasets": ["srj18"], "order": "BA",
                  "plannedRecords": 64, "plannedMatrixJobs": 2,
                  "completeOriginalSelectedDatasetPopulations": True,
                  "fullyCharacterizesBothOriginalDatasets": False}
assert runtime.execution_scope(manifest) == expected_scope
assert manifest["executionScope"] == expected_scope
assert manifest["plannedRecordsAllCandidates"] == 64 and manifest["plannedMatrixJobs"] == 2
assert manifest["plannedPairsPerCandidate"] == 16 and manifest["plannedRecordsPerCandidate"] == 32
assert runtime.execution_matrix(manifest) == {"include": [
    {"experiment": name, "dataset": "srj18", "count": 16, "order": "BA"} for name in requested]}
rejected = 0
with tempfile.TemporaryDirectory(prefix="post588-scoped-synthetic-") as directory:
    path = pathlib.Path(directory) / "manifest.json"
    path.write_text(json.dumps(manifest))
    runtime.validate_manifest(path)
    for key, value in [("plannedPairsPerCandidate", 42), ("plannedRecordsPerCandidate", 84)]:
        invalid = copy.deepcopy(manifest)
        invalid[key] = value
        path.write_text(json.dumps(invalid))
        try:
            runtime.validate_manifest(path)
        except ValueError:
            rejected += 1
        else:
            raise AssertionError("Stale full-dataset population accepted: " + key)
    for key, value in [("plannedRecords", 63), ("plannedMatrixJobs", 4),
                       ("datasets", ["srj18", "srj24"]), ("order", "AB"),
                       ("fullyCharacterizesBothOriginalDatasets", True)]:
        invalid = copy.deepcopy(manifest)
        invalid["executionScope"][key] = value
        path.write_text(json.dumps(invalid))
        try:
            runtime.validate_manifest(path)
        except ValueError:
            rejected += 1
        else:
            raise AssertionError("Forged partial-scope authority accepted: " + key)
    path.write_text(json.dumps(manifest))
    for feature, dataset, order in [("path-packing", "srj24", "BA"),
                                    ("path-packing", "srj18", "AB"),
                                    ("detailed-feedback", "srj18", "BA")]:
        result = subprocess.run(["python3", str(ROOT / "run-post588-experiments.py"),
            "--mode", "select", "--manifest", str(path), "--experiment", feature,
            "--dataset", dataset, "--order", order], capture_output=True, text=True)
        assert result.returncode != 0 and "outside the sealed" in result.stderr
        rejected += 1
    plan = subprocess.run(["python3", str(ROOT / "run-post588-experiments.py"),
        "--mode", "plan", "--manifest", str(path)], capture_output=True, text=True)
    assert plan.returncode == 0 and json.loads(json.loads(plan.stdout)["matrix"]) == runtime.execution_matrix(manifest)
    outside_plan = subprocess.run(["python3", str(ROOT / "run-post588-experiments.py"),
        "--mode", "plan", "--manifest", str(path), "--dataset", "srj24"], capture_output=True, text=True)
    assert outside_plan.returncode != 0 and "outside the sealed" in outside_plan.stderr
    rejected += 1

stats = {
    "path-packing": {"requested": True, "activated": True, "eligibleNodes": 1,
        "instances": 1, "nativeDistinctCandidates": 6, "bankTasks": 2,
        "generatedCandidates": 16, "distinctCandidates": 16, "distinctViaPatterns": 4,
        "generationSearchNodes": 3874, "unaryChecks": 16, "pairChecks": 8,
        "selectionStates": 3, "solvedNodes": 1, "workUnits": 4000, "exhaustedNodes": 0},
    "incremental-path": {"activated": 1, "queryStarts": 3, "repeatedQueries": 2,
        "eligibleQueries": 2, "unsupportedQueries": 0, "budgetDeclinedQueries": 0,
        "freshSearches": 1, "repairs": 1, "changedCostReuseQueries": 1,
        "changedTransitions": 3, "reusedLabels": 2, "repairedLabels": 1,
        "dependencyVisits": 4, "generatedTransitions": 6, "chargedWork": 12, "solvedQueries": 2}}
base_record = copy.deepcopy(population.fixture.record)
population.manifest, population.order, population.dataset = manifest, "BA", "srj18"
for item in manifest["experiments"]:
    population.item = item
    population.fixture.record = copy.deepcopy(base_record)
    evidence = {path: {} for path in item["evidencePaths"]}
    evidence[item["coverageContract"]["statsPath"]] = stats[item["id"]]
    if item["id"] == "path-packing":
        # A worker-local portfolio selection is distinct from the final board.
        selected_path = "highDensityRouteSolver.benchmarkDiagnosticCounters.pathPackingPortfolioSelectedNodes"
        evidence[selected_path] = 0
        if selected_path not in item["evidencePaths"]:
            item["evidencePaths"].append(selected_path)
    population.fixture.record["official"]["routingMetrics"]["experimentAudit"]["evidence"] = evidence
    records = [population.make_record(sample, arm) for sample in range(1, 17) for arm in "BA"]
    parsed = population.parser.parse_log(population.make_log(records), runtime, manifest, item,
        "srj18", "BA", population.run_id, population.controller_sha)
    assert parsed["analysisAuthority"] == "STRICT_ALL_RECORDS", parsed["integrityIssues"]
    assert parsed["observedRecordCount"] == 32 and len(parsed["qualifiedTimingCohort"]) == 16
    assert [(row["sampleNumber"], row["arm"]) for row in parsed["records"]] == [(n, arm) for n in range(1, 17) for arm in "BA"]
    for changed_records in [records[:-2], [r for n in range(16) for r in records[2*n:2*n+2][::-1]]]:
        invalid = population.parser.parse_log(population.make_log(changed_records), runtime, manifest,
            item, "srj18", "BA", population.run_id, population.controller_sha)
        assert invalid["analysisAuthority"] == "UNQUALIFIED_DIAGNOSTIC_ONLY"
        assert invalid["qualifiedTimingCohort"] == []
        rejected += 1
    if item["id"] == "path-packing":
        candidate = parsed["records"][0]
        assert candidate["featureCoverage"]["actualEvidence"][selected_path] == 0
        assert candidate["featureCoverage"]["actualWorkExercised"] is True
        assert candidate["featureCoverage"]["mechanismWorkIsNotAnOutputOrPerformanceGain"] is True
    else:
        assert type(parsed["records"][0]["featureCoverage"]["actualEvidence"][item["coverageContract"]["statsPath"]]["activated"]) is int
    for outside_dataset, outside_order in [("srj18", "AB"), ("srj24", "BA")]:
        population.dataset, population.order = outside_dataset, outside_order
        outside_records = [population.make_record(sample, arm) for sample in range(1, runtime.COUNTS[outside_dataset] + 1) for arm in outside_order]
        outside = population.parser.parse_log(population.make_log(outside_records), runtime, manifest,
            item, outside_dataset, outside_order, population.run_id, population.controller_sha)
        assert outside["populationComplete"] is True
        assert all(row["strictIntegrityQualified"] for row in outside["records"])
        assert outside["analysisAuthority"] == "UNQUALIFIED_DIAGNOSTIC_ONLY"
        assert outside["qualifiedTimingCohort"] == [] and outside["qualifiedIdentitySets"] == {}
        assert outside["unrelatedIntegrityIssues"] == [{"kind": "requested_parse_outside_sealed_execution_scope"}]
        rejected += 1
    population.dataset, population.order = "srj18", "BA"
print(json.dumps({"status": "PASS", "syntheticOnly": True, "newSourceV2Scope": expected_scope,
                  "sourceShapedBARecords": 64, "scopeAndPopulationForgeriesRejected": rejected,
                  "proposalAndWorkerLocalSelectionAreNotFinalBoardProof": True}))
