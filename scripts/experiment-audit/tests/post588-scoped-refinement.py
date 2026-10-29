"""Exact selected-dataset BA synthetic populations; never executes routing."""
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
manifest = json.loads((ROOT / "post588-experiments-20261029.json").read_text())
requested = copy.deepcopy(manifest["requestedExperiments"])
assert set(requested) <= {"path-packing", "incremental-path", "sparse-force"}
selected_dataset = manifest["dispatchRequest"]["dataset"]
assert selected_dataset in runtime.COUNTS
selected_count = runtime.COUNTS[selected_dataset]
other_dataset = next(name for name in runtime.COUNTS if name != selected_dataset)
manifest["requestedExperiments"] = requested
manifest["experiments"] = [copy.deepcopy(next(item for item in population.manifest["experiments"] if item["id"] == name)) for name in requested]
manifest["dispatchRequest"] = {"experiment": "all", "dataset": selected_dataset, "order": "BA"}
sealer.refresh(manifest, runtime)
assert manifest["runSampleSourceSha256"] == "c59222511a8fcade8c59399f8cca643f0ecffc33e8b6e4f01a19c675d8767396"
assert manifest["expectedHarnessSourceHashes"]["adaptedHarnessHash"] == "27354d365585b69e85ba6aa8917ca4a28b4b9650faa2cc196e0cc9761461afc9"
expected_scope = {"experiments": requested, "datasets": [selected_dataset], "order": "BA",
                  "plannedRecords": len(requested) * selected_count * 2, "plannedMatrixJobs": len(requested),
                  "completeOriginalSelectedDatasetPopulations": True,
                  "fullyCharacterizesBothOriginalDatasets": False}
assert runtime.execution_scope(manifest) == expected_scope
assert manifest["executionScope"] == expected_scope
assert manifest["plannedRecordsAllCandidates"] == len(requested) * selected_count * 2 and manifest["plannedMatrixJobs"] == len(requested)
assert manifest["plannedPairsPerCandidate"] == selected_count and manifest["plannedRecordsPerCandidate"] == selected_count * 2
assert runtime.execution_matrix(manifest) == {"include": [
    {"experiment": name, "dataset": selected_dataset, "count": selected_count, "order": "BA"} for name in requested]}
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
    for feature, dataset, order in [(requested[0], other_dataset, "BA"),
                                    (requested[0], selected_dataset, "AB"),
                                    ("detailed-feedback", selected_dataset, "BA")]:
        result = subprocess.run(["python3", str(ROOT / "run-post588-experiments.py"),
            "--mode", "select", "--manifest", str(path), "--experiment", feature,
            "--dataset", dataset, "--order", order], capture_output=True, text=True)
        assert result.returncode != 0 and "outside the sealed" in result.stderr
        rejected += 1
    plan = subprocess.run(["python3", str(ROOT / "run-post588-experiments.py"),
        "--mode", "plan", "--manifest", str(path)], capture_output=True, text=True)
    assert plan.returncode == 0 and json.loads(json.loads(plan.stdout)["matrix"]) == runtime.execution_matrix(manifest)
    outside_plan = subprocess.run(["python3", str(ROOT / "run-post588-experiments.py"),
        "--mode", "plan", "--manifest", str(path), "--dataset", other_dataset], capture_output=True, text=True)
    assert outside_plan.returncode != 0 and "outside the sealed" in outside_plan.stderr
    rejected += 1

stats = {
    "path-packing": {"requested": True, "activated": True, "eligibleNodes": 1,
        "instances": 1, "nativeDistinctCandidates": 6, "bankTasks": 2,
        "generatedCandidates": 16, "distinctCandidates": 16, "distinctViaPatterns": 4,
        "generationSearchNodes": 3874, "unaryChecks": 16, "pairChecks": 8,
        "selectionStates": 3, "solvedNodes": 1, "workUnits": 4000, "exhaustedNodes": 0},
    "sparse-force": {"activated": True, "sampleNodes": 1, "kernelCalls": 2,
        "allFixedCalls": 0, "fixedNodeCount": 3, "mutableNodeCount": 2,
        "requestedForceSteps": 8, "executedForceSteps": 8, "skippedForceSteps": 0,
        "noWritePairsSkipped": 4, "fixedClampVisitsSkipped": 3,
        "projectionPassesExecuted": 2, "projectionPassesSkipped": 1,
        "inactiveProjectionExits": 1, "spatialIndexBuilds": 1,
        "inactiveProjectionPassesSkipped": 1},
    "incremental-path": {"activated": 1, "queryStarts": 3, "repeatedQueries": 2,
        "eligibleQueries": 2, "unsupportedQueries": 0, "budgetDeclinedQueries": 0,
        "freshSearches": 1, "repairs": 1, "changedCostReuseQueries": 1,
        "changedTransitions": 3, "reusedLabels": 2, "repairedLabels": 1,
        "dependencyVisits": 4, "generatedTransitions": 6, "chargedWork": 12, "solvedQueries": 2}}
base_record = copy.deepcopy(population.fixture.record)
population.manifest, population.order, population.dataset = manifest, "BA", selected_dataset
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
    records = [population.make_record(sample, arm) for sample in range(1, selected_count + 1) for arm in "BA"]
    parsed = population.parser.parse_log(population.make_log(records), runtime, manifest, item,
        selected_dataset, "BA", population.run_id, population.controller_sha)
    assert parsed["analysisAuthority"] == "STRICT_ALL_RECORDS", parsed["integrityIssues"]
    assert parsed["observedRecordCount"] == selected_count * 2 and len(parsed["qualifiedTimingCohort"]) == selected_count
    assert [(row["sampleNumber"], row["arm"]) for row in parsed["records"]] == [(n, arm) for n in range(1, selected_count + 1) for arm in "BA"]
    for changed_records in [records[:-2], [r for n in range(selected_count) for r in records[2*n:2*n+2][::-1]]]:
        invalid = population.parser.parse_log(population.make_log(changed_records), runtime, manifest,
            item, selected_dataset, "BA", population.run_id, population.controller_sha)
        assert invalid["analysisAuthority"] == "UNQUALIFIED_DIAGNOSTIC_ONLY"
        assert invalid["qualifiedTimingCohort"] == []
        rejected += 1
    if item["id"] == "path-packing":
        candidate = parsed["records"][0]
        assert candidate["featureCoverage"]["actualEvidence"][selected_path] == 0
        assert candidate["featureCoverage"]["actualWorkExercised"] is True
        assert candidate["featureCoverage"]["mechanismWorkIsNotAnOutputOrPerformanceGain"] is True
    elif item["id"] == "incremental-path":
        assert type(parsed["records"][0]["featureCoverage"]["actualEvidence"][item["coverageContract"]["statsPath"]]["activated"]) is int
    else:
        assert parsed["records"][0]["featureCoverage"]["actualEvidence"][item["coverageContract"]["statsPath"]]["spatialIndexBuilds"] == 1
    for outside_dataset, outside_order in [(selected_dataset, "AB"), (other_dataset, "BA")]:
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
    population.dataset, population.order = selected_dataset, "BA"
print(json.dumps({"status": "PASS", "syntheticOnly": True, "newSourceV2Scope": expected_scope,
                  "sourceShapedBARecords": len(requested) * selected_count * 2, "scopeAndPopulationForgeriesRejected": rejected,
                  "proposalAndWorkerLocalSelectionAreNotFinalBoardProof": True}))
