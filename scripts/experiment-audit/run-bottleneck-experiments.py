#!/usr/bin/env python3
"""Characterize three measured bottleneck hypotheses with immutable fresh same-host pairs."""
import argparse
import hashlib
import importlib.util
import inspect
import json
import math
import os
import pathlib
import platform
import re
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("new_pinned_runner", ROOT / "run-pinned-experiment.py")
pinned = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pinned)
MAIN = "e703f0499188f858b2b5e571ac80091d4c10733a"
MAIN_TREE = "c79d9f76c9eff681a0c4665b341fd8af7d750e28"
DEPENDENCY_SECTIONS_SHA256 = "4a0db0b221c49b93cd31cdabc78ed9e9e9874408cbea119a066e47ef41601746"
DEPENDENCY_INVENTORY_AUTHORITY_SHA256 = "74a89db983a4b914698d64917fcf4ec2eb6d23b0299950e8e822a42157588aab"
COUNTS = {"srj18": 16, "srj24": 26}
SOLVER = "AutoroutingPipelineSolver9_PreloadedTraceGraph"
MODULE = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts"
FEATURES = {"lazy-hd": (3199, "experimentLazyHdCandidates"), "repair-preparation": (3202, "experimentSharedRepairGeometry"), "repair-search-scratch": (3198, "experimentRepairSearchScratch")}
CHECKS = ["referenceFullCopperChecks", "inputOnlyPhysicalChecks", "inputOnlyConnectivityFindings", "libraryRoutingChecks", "boardCopperChecks", "viaBoardChecks", "canonicalViaPadChecks"]
VALIDATORS = ["lib/testing/evaluate-relaxed-drc.ts", "lib/testing/getDrcErrors.ts", "lib/testing/drcPresets.ts", "lib/testing/utils/convertToCircuitJson.ts", "lib/testing/utils/migrate-legacy-obstacle-circuit-json-metadata.ts"]
ASSETS = {"capture-terminal-failure-geometry.ts", "experiment-audit-adapter.ts", "experiment-dataset-identity.ts", "install-pinned-dependencies.py", "phase-checkpoint-observer.ts", "prepare-pinned-harness.py", "qualify-pinned-output.ts", "run-pinned-experiment.py", "select-pinned-experiment.py", "declared-intent-copper-v3.ts", "bottleneck-coverage.py", "post588-declared-qualification.py", "parse-post588-experiments-log.py", "bottleneck-feature-contracts.json", "bottleneck-artifact-carrier.py", "tests/bottleneck-artifact-carrier-integrity.py", pathlib.Path(__file__).name}
CAMPAIGN = "bottleneck-experiments-20261029"
BRANCH = "codex/bottleneck-experiments-controller-20261029"
WORKFLOW = ROOT.parent.parent / ".github/workflows/bottleneck-experiments.yml"
DECLARED_SOURCE_SHA256 = "fee128fedcfd96c1d7e70e6597c027a4aa94fe2af69183fd1e38d77f65e8adf4"
CHECKER_SOURCE_SHA256 = "4d568a55512ee599df1422eda189b7c7bbbd1ed20bace1e9922033e12b938a6b"

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

coverage_module = load_module("post588_coverage", ROOT / "bottleneck-coverage.py")
declared = load_module("post588_declared", ROOT / "post588-declared-qualification.py")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def exact(left, right):
    return json.dumps(left, sort_keys=True, separators=(",", ":")) == json.dumps(right, sort_keys=True, separators=(",", ":"))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value, length=40):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{" + str(length) + "}", value) is not None


def finite(value):
    return type(value) in [int, float] and math.isfinite(value) and value >= 0


def execution_scope(manifest):
    request = manifest["dispatchRequest"]
    experiments = [name for name in manifest["requestedExperiments"] if request["experiment"] in ["all", name]]
    datasets = [name for name in COUNTS if request["dataset"] in ["both", name]]
    return {"experiments": experiments, "datasets": datasets, "order": request["order"],
            "plannedRecords": len(experiments) * sum(COUNTS[name] for name in datasets) * 2,
            "plannedMatrixJobs": len(experiments) * len(datasets),
            "completeOriginalSelectedDatasetPopulations": True,
            "fullyCharacterizesBothOriginalDatasets": datasets == list(COUNTS)}


def execution_matrix(manifest):
    scope = execution_scope(manifest)
    return {"include": [{"experiment": name, "dataset": dataset, "count": COUNTS[dataset], "order": scope["order"]}
                        for name in scope["experiments"] for dataset in scope["datasets"]]}


def validate_manifest(path):
    manifest = json.loads(path.read_text())
    require(type(manifest.get("schemaVersion")) is int and manifest["schemaVersion"] == 3 and manifest.get("campaign") == CAMPAIGN, "Wrong campaign/schema")
    require(manifest.get("baselineSha") == MAIN and manifest.get("baselineTree") == MAIN_TREE and manifest.get("harnessSha") == MAIN, "Frozen e703 source/harness changed")
    require(exact(manifest.get("datasets"), COUNTS) and all(type(manifest.get(k)) is int and manifest[k] == v for k, v in {"sampleTimeoutSeconds": 360, "threads": 1, "concurrency": 1, "effort": 1}.items()), "Original complete populations/effort/thread/deadline changed")
    require(manifest.get("allowedExecutionOrders") == ["AB", "BA"] and manifest.get("regressionBasedLaunchGate") is False and manifest.get("baselineReusedAcrossCandidates") is False, "Characterization/pairing policy changed")
    request = manifest.get("dispatchRequest", {})
    require(set(request) == {"experiment", "dataset", "order"} and request["experiment"] in ["all", *FEATURES] and request["dataset"] in ["both", *COUNTS] and request["order"] in ["AB", "BA"], "Pinned push dispatch request is invalid")
    require(manifest.get("prior588CampaignImmutable") is True and manifest.get("prior568CampaignImmutable") is True and manifest.get("timingsPooledAcrossCampaigns") is False and manifest.get("strictTimeoutPolicy") == "ORIGINAL_UNCHANGED_NO_TERMINAL_GAP_UPGRADE", "Prior campaign or timeout qualification policy changed")
    require(sha(WORKFLOW) == manifest.get("workflowSha256"), "Workflow bytes changed")
    require(manifest.get("declaredIntentSourceSha256") == DECLARED_SOURCE_SHA256 and sha(ROOT / "declared-intent-copper-v3.ts") == DECLARED_SOURCE_SHA256 and manifest.get("declaredIntentCheckerSha256") == CHECKER_SOURCE_SHA256, "Frozen declared-intent sidecar/checker authority changed")
    require(exact(manifest.get("baseline", {}).get("options"), {"cacheProvider": None, "effort": 1}), "Baseline must use current-main default options and explicit cache:null")
    require(manifest.get("expectedValidatorHashes") and set(manifest["expectedValidatorHashes"]) == set(VALIDATORS), "All five current-main validators must be frozen")
    require(set(manifest.get("expectedHarnessSourceHashes", {})) == {"officialHarnessHash", "adaptedHarnessHash", "terminalFailureGeometryCaptureHash", "phaseCheckpointObserverHash", "adapterHash", "benchmarkShellHash"}, "All official/adapted harness and observer identities are required")
    require(hashlib.sha256(json.dumps(manifest.get("sourceDependencySections"), sort_keys=True, separators=(",", ":")).encode()).hexdigest() == DEPENDENCY_SECTIONS_SHA256, "Exact current-main dependency sections changed")
    require(hashlib.sha256(json.dumps(manifest.get("pinnedRuntimeDependencyInventories"), sort_keys=True, separators=(",", ":")).encode()).hexdigest() == DEPENDENCY_INVENTORY_AUTHORITY_SHA256, "Authenticated Tiny/native source inventory authority changed")
    require(set(manifest.get("runtimeSourceHashes", {})) == ASSETS and all(sha(ROOT / name) == value for name, value in manifest["runtimeSourceHashes"].items()), "Exact shared runtime helper bytes changed")
    require(hashlib.sha256(inspect.getsource(pinned.run_sample).encode()).hexdigest() == manifest.get("runSampleSourceSha256"), "Fresh child/original clock runner changed")
    experiments = manifest.get("experiments", [])
    requested = manifest.get("requestedExperiments")
    require(isinstance(requested, list) and 1 <= len(requested) <= 3 and len(set(requested)) == len(requested) and set(requested) <= set(FEATURES), "An explicit nonempty qualified source subset is required")
    require(len(experiments) == len(requested) and [x.get("id") for x in experiments] == requested, "Manifest must contain exactly its requested qualified subset, without silent skips/placeholders")
    require(request["experiment"] == "all" or request["experiment"] in requested, "Requested feature is not in the source-qualified subset")
    scope = execution_scope(manifest)
    require(exact(manifest.get("executionScope"), scope), "Explicit dispatched dataset/order/population scope differs")
    require(type(manifest.get("plannedRecordsAllCandidates")) is int and manifest["plannedRecordsAllCandidates"] == scope["plannedRecords"] and type(manifest.get("plannedMatrixJobs")) is int and manifest["plannedMatrixJobs"] == scope["plannedMatrixJobs"], "Explicit dispatched population/job counts differ")
    selected_pairs = sum(COUNTS[name] for name in scope["datasets"])
    require(type(manifest.get("plannedPairsPerCandidate")) is int and manifest["plannedPairsPerCandidate"] == selected_pairs and type(manifest.get("plannedRecordsPerCandidate")) is int and manifest["plannedRecordsPerCandidate"] == selected_pairs * 2, "Per-candidate selected dataset population differs")
    for dataset, count in COUNTS.items():
        require(set(manifest["expectedInputHashesByDataset"][dataset]) == {str(n) for n in range(1, count + 1)} and all(digest(h, 64) for h in manifest["expectedInputHashesByDataset"][dataset].values()), "Missing original input identity")
    for item in [manifest["baseline"], *experiments]:
        require(item.get("solverName") == SOLVER and item.get("solverModule") == MODULE and 1 <= len(item.get("evidencePaths", [])) <= 4 and len(set(item["evidencePaths"])) == len(item["evidencePaths"]), "Actual constructor/module/evidence budget differs")
    for item in experiments:
        coverage_module.validate_contract(item)
        pr, option = FEATURES[item["id"]]
        require(item.get("pr") == pr and item.get("option") == option and exact(item.get("options"), {"cacheProvider": None, "effort": 1, option: True}), "B must explicitly enable exactly its own experiment")
        require(digest(item.get("candidateSha")) and digest(item.get("candidateTree")), "PENDING_PUBLICATION: exact candidate source/tree required: " + item["id"])
        publication = item.get("publication", {})
        require(publication.get("publishedCommit") == item["candidateSha"] and publication.get("expectedTree") == item["candidateTree"] and digest(publication.get("reviewedLocalCommit")), "Candidate publication proof differs")
        quality = item.get("sourceQualification", {})
        require(quality.get("status") == "PASS_ROOT_REVIEWED" and quality.get("sourceTree") == item["candidateTree"] and all(type(quality.get(k)) is int and quality[k] == 0 for k in ["fullTypesExitCode", "fullBuildExitCode", "focusedTestsExitCode"]), "Source QA/review must complete before source publication, not based on board outcomes")
        raw = quality.get("evidenceText")
        require(isinstance(raw, str) and hashlib.sha256(raw.encode()).hexdigest() == quality.get("evidenceSha256"), "Exact source qualification receipt missing")
        data = json.loads(raw)
        source_record = data.get("source") if isinstance(data.get("source"), dict) else {}
        receipt_tree = data.get("tree") or data.get("sourceTree") or source_record.get("tree")
        receipt_local = data.get("localCommit") or data.get("commit") or data.get("sourceLocal") or (data.get("source") if isinstance(data.get("source"), str) else source_record.get("sha"))
        require(receipt_tree == item["candidateTree"] and receipt_local == publication["reviewedLocalCommit"], "Qualification receipt belongs to a different source/tree")
    return manifest


def select(manifest, name):
    return next(item for item in manifest["experiments"] if item["id"] == name)


def outputs(values):
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.writelines(f"{key}={value}\n" for key, value in values.items())
    print(json.dumps(values, sort_keys=True), flush=True)


def verify_checkouts(manifest, item, checkouts):
    for arm, checkout in checkouts.items():
        expected = (manifest["baselineSha"], manifest["baselineTree"]) if arm == "A" else (item["candidateSha"], item["candidateTree"])
        observed = subprocess.check_output(["git", "rev-parse", "HEAD", "HEAD^{tree}"], cwd=checkout, text=True).splitlines()
        require(tuple(observed) == expected, "Source commit/tree differs: " + arm)
        package = json.loads((checkout / "package.json").read_text())
        sections = {key: package[key] for key in ["dependencies", "devDependencies", "optionalDependencies"] if key in package}
        require(exact(sections, manifest["sourceDependencySections"]), "An isolated experiment changed source dependency declarations")
        require(all(sha(checkout / path) == value for path, value in manifest["expectedValidatorHashes"].items()), "Current-main validator source changed")


def verify_dependencies(manifest, checkouts):
    for arm, checkout in checkouts.items():
        checker_package = json.loads((checkout / "node_modules/@tscircuit/checks/package.json").read_text())
        require(checker_package.get("version") == "0.0.259" and sha(checkout / "node_modules/@tscircuit/checks/dist/index.js") == manifest["declaredIntentCheckerSha256"], "Frozen seven-predicate geometry checker differs before routing: " + arm)
        provenance = json.loads((checkout / "experiment-dependencies-provenance.json").read_text())
        require(provenance.get("sourcePackageJsonSha256") == sha(checkout / "package.json"), "Installed dependency source-package hash differs")
        for name, expected in manifest["pinnedRuntimeDependencyInventories"].items():
            record = provenance.get("directDependencies", {}).get(name, {})
            require(record.get("declaration") == expected["declaration"] and record.get("installedSource") == expected["installedSource"], "Dependency URL/pin differs: " + name)
            directory = checkout / "node_modules" / name
            actual = {str(p.relative_to(directory)): sha(p) for p in directory.rglob("*") if p.is_file() and not ({"node_modules", ".git"} & set(p.relative_to(directory).parts))}
            if expected.get("inventoryMode") == "src-and-package":
                actual = {path: value for path, value in actual.items() if path == "package.json" or path.startswith("src/")}
            elif expected.get("inventoryMode") == "lib-and-package":
                actual = {path: value for path, value in actual.items() if path == "package.json" or path.startswith("lib/")}
            else:
                require(expected.get("inventoryScope") == "ALL_INSTALLED_FILES_EXCLUDING_NESTED_NODE_MODULES_AND_DOTGIT", "Unknown authenticated inventory scope: " + name)
            wanted = expected["sourceFileSha256"]
            if not exact(actual, wanted):
                missing, extra = sorted(set(wanted) - set(actual)), sorted(set(actual) - set(wanted))
                changed = sorted(path for path in set(actual) & set(wanted) if actual[path] != wanted[path])
                detail = {"arm": arm, "package": name, "expectedCount": len(wanted), "actualCount": len(actual), "missingCount": len(missing), "unexpectedCount": len(extra), "changedCount": len(changed), "boundedMissing": [{"path": p, "expectedSha256": wanted[p]} for p in missing[:8]], "boundedUnexpected": [{"path": p, "actualSha256": actual[p]} for p in extra[:8]], "boundedChanged": [{"path": p, "expectedSha256": wanted[p], "actualSha256": actual[p]} for p in changed[:8]], "contentsIncluded": False}
                raise ValueError("Installed source inventory mismatch: " + json.dumps(detail, separators=(",", ":")))


def checkpoint_audit(raw, metadata):
    errors, rows, status = [], [], None
    try:
        lines = (raw / "phase-checkpoints.jsonl").read_bytes().splitlines()
        require(1 <= len(lines) <= 256 and all(len(line) <= 4095 for line in lines), "Checkpoint size bounds violated")
        rows = [json.loads(line) for line in lines]
        require(all(type(row.get("sequence")) is int and row["sequence"] == i and all(exact(row.get(k), v) for k, v in metadata.items()) for i, row in enumerate(rows)), "Checkpoint sequence/source/input/arm provenance differs")
        status = json.loads((raw / "phase-checkpoint-status.json").read_text())
        require(type(status.get("schemaVersion")) is int and status["schemaVersion"] == 1 and status.get("observerSourceSha256") == metadata["observerSourceSha256"] and status.get("installed") is True and status.get("solveEntered") is True and status.get("errors") == [] and status.get("truncated") is False, "Observer coverage/status incomplete")
    except Exception as error:
        errors.append(str(error))
    return {"errors": errors, "rowCount": len(rows), "status": status, "lastDurableCheckpoint": rows[-1] if rows else None, "stageBoundaries": [{k: row.get(k) for k in ["sequence", "event", "phaseName", "officialStartOffsetMs", "solved", "failed"]} for row in rows], "scope": "Synchronous stage boundaries, not pure-stage runtime attribution"}


def timeout_checkpoint_qualification(record):
    row = record.get("official") or {}
    checkpoint = record.get("phaseCheckpointAudit") or {}
    status = checkpoint.get("status") or {}
    last = checkpoint.get("lastDurableCheckpoint") or {}
    boundaries = checkpoint.get("stageBoundaries") or []
    runtime = record.get("officialReportRuntime") or {}
    row = row if isinstance(row, dict) else {}
    checkpoint = checkpoint if isinstance(checkpoint, dict) else {}
    status = status if isinstance(status, dict) else {}
    last = last if isinstance(last, dict) else {}
    runtime = runtime if isinstance(runtime, dict) else {}
    boundary_shape = isinstance(boundaries, list) and all(isinstance(item, dict) for item in boundaries)
    boundaries = boundaries if boundary_shape else []
    expected = {"campaign": record.get("campaign"), "arm": record.get("arm"),
                "algorithmSha": record.get("sha"), "dataset": record.get("dataset"),
                "originalSample": record.get("sampleNumber"), "inputSha256": record.get("expectedInputHash"),
                "executionOrder": record.get("executionOrder")}
    events = [item.get("event") for item in boundaries if isinstance(item, dict)]
    sequence_valid = boundary_shape and type(checkpoint.get("rowCount")) is int and 3 <= checkpoint["rowCount"] <= 256
    sequence_valid = sequence_valid and len(boundaries) == checkpoint["rowCount"] and all(type(item.get("sequence")) is int and item["sequence"] == index for index, item in enumerate(boundaries))
    lifecycle_valid = events[:3] == ["pipeline_constructor_enter", "pipeline_constructor_exit", "solve_enter"]
    lifecycle_valid = lifecycle_valid and all(events.count(name) == 1 for name in events[:3])
    allowed_timeout_events = {"pipeline_constructor_enter", "pipeline_constructor_exit", "solve_enter", "phase_setup_enter", "constructor_params_enter", "constructor_params_exit", "active_subsolver_constructed", "phase_run_enter", "on_solved_enter", "on_solved_exit"}
    lifecycle_valid = lifecycle_valid and all(name in allowed_timeout_events for name in events)
    elapsed = row.get("elapsedTimeMs")
    clock_valid = finite(elapsed) and elapsed + 1 >= 360000 and finite(record.get("externalBenchmarkProcessWallMs")) and record["externalBenchmarkProcessWallMs"] + 1 >= elapsed
    clock_valid = clock_valid and all(item.get("officialStartOffsetMs") is None for item in boundaries[:2])
    clock_valid = clock_valid and all(finite(item.get("officialStartOffsetMs")) and item["officialStartOffsetMs"] <= elapsed + 2 for item in boundaries[2:])
    actual_shape = last.get("observedObjectPath") == "solver" and last.get("observedConstructorName") == SOLVER and last.get("actualCacheProviderState") == "disabled"
    actual_shape = actual_shape and isinstance(record.get("requestedOptions"), dict) and exact(last.get("observedRequestedOptions"), record["requestedOptions"])
    actual_runtime = all(type(runtime.get(key)) is int and runtime[key] == 1 for key in ["threadsPerSample", "effectiveThreadsPerSample", "cpuBudgetPerSample", "requestedConcurrency", "workerCount"]) and runtime.get("bunVersion") == "1.4.2"
    observed_timeout = row.get("didTimeout") is True and row.get("didSolve") is False and type(row.get("sampleTimeoutMs")) is int and row["sampleTimeoutMs"] == 360000
    observed_timeout = observed_timeout and row.get("solverName") == SOLVER and type(row.get("sampleNumber")) is int and row["sampleNumber"] == record.get("sampleNumber")
    status_valid = checkpoint.get("errors") == [] and status.get("errors") == [] and status.get("truncated") is False and status.get("installed") is True and status.get("solveEntered") is True and status.get("solveFinished") is False
    source_valid = all(exact(last.get(key), value) for key, value in expected.items()) and type(last.get("sequence")) is int and last["sequence"] == checkpoint.get("rowCount", 0) - 1
    boundary_fields = ["sequence", "event", "phaseName", "officialStartOffsetMs", "solved", "failed"]
    source_valid = source_valid and bool(boundaries) and exact({key: last.get(key) for key in boundary_fields}, boundaries[-1])
    proven = observed_timeout and status_valid and sequence_valid and lifecycle_valid and clock_valid and actual_shape and actual_runtime and source_valid and record.get("controllerError") is None
    return {"status": "DURABLE_CHECKPOINT_SOURCE_PROVEN_TIMEOUT" if proven else "NO_SEPARATE_TIMEOUT_PROOF",
            "sourceAndInputProvenByBoundedCheckpoints": bool(proven),
            "originalStrictIntegrityFlagsUnchanged": True,
            "outputOrSpeedCredit": False,
            "scope": "Additional attempt provenance only; complete constructor/solve chain, actual requested options/cache/runtime and bounded clocks. Does not fabricate a terminal audit, rewrite official timeout status, or waive missing output evidence"}


def feature_coverage(record, item):
    return coverage_module.coverage(record, item)


def reference_clean(record):
    row = record.get("official") or {}
    return record.get("strictIntegrityQualified") is True and row.get("didSolve") is True and row.get("didTimeout") is False and row.get("relaxedDrcPassed") is True and not record.get("controllerError") and not record.get("supplementalValidationError") and (record.get("supplemental") or {}).get("referenceFullCopperChecks", {}).get("count") == 0


def physical_clean(record):
    supplemental = record.get("supplemental") or {}
    return reference_clean(record) and declared.supported_clean(record) and all(supplemental.get(k, {}).get("count") == 0 for k in ["inputOnlyPhysicalChecks", "boardCopperChecks", "viaBoardChecks", "canonicalViaPadChecks"]) and supplemental.get("libraryRoutingChecks", {}).get("byType", {}).get("pcb_pad_pad_clearance_error", 0) == 0


def summarize(records, dataset, order):
    index = {(r["sampleNumber"], r["arm"]): r for r in records}
    identities = {kind: {arm: [n for n in range(1, COUNTS[dataset] + 1) if (n, arm) in index and fn(index[n, arm])] for arm in ["A", "B"]} for kind, fn in [("completed", lambda row: row.get("strictIntegrityQualified") is True and (row.get("official") or {}).get("didSolve") is True and (row.get("official") or {}).get("didTimeout") is False), ("reference", reference_clean), ("supportedCopper", lambda row: reference_clean(row) and declared.supported_clean(row)), ("physical", physical_clean)]}
    for sets in identities.values():
        sets.update(lost=sorted(set(sets["A"]) - set(sets["B"])), gained=sorted(set(sets["B"]) - set(sets["A"])))
    comparisons = []
    for sample in range(1, COUNTS[dataset] + 1):
        if not all((sample, arm) in index for arm in ["A", "B"]):
            continue
        pair = {arm: index[sample, arm] for arm in ["A", "B"]}
        if not all(record.get("strictIntegrityQualified") is True and (record.get("official") or {}).get("didSolve") is True for record in pair.values()):
            continue
        hashes = {arm: {"rawOutputHash": pair[arm]["official"]["routingMetrics"]["experimentAudit"].get("rawOutputHash"), "rawNewTracesHash": pair[arm]["official"]["routingMetrics"]["experimentAudit"].get("rawNewTracesHash"), "canonicalCircuitJsonSha256": (pair[arm].get("supplemental") or {}).get("canonicalCircuitJsonSha256"), "declaredFindingInventorySha256": (pair[arm].get("declaredIntentCopper") or {}).get("findingInventorySha256")} for arm in ["A", "B"]}
        comparisons.append({"sample": sample, "hashes": hashes, "equal": {key: hashes["A"][key] == hashes["B"][key] for key in hashes["A"]}})
    pairs = []
    for sample in range(1, COUNTS[dataset] + 1):
        if not all((sample, arm) in index for arm in ["A", "B"]):
            continue
        pair = {arm: index[sample, arm] for arm in ["A", "B"]}
        if not all(physical_clean(r) and r.get("strictIntegrityQualified") is True for r in pair.values()):
            continue
        times = {arm: pair[arm]["official"]["elapsedTimeMs"] + pair[arm]["official"]["routingMetrics"]["experimentAudit"]["constructorTimeMs"] for arm in ["A", "B"]}
        pairs.append({"sample": sample, "constructorPlusOfficialSolveMs": times, "candidateBaselineRatio": times["B"] / times["A"] if times["A"] > 0 else None, "physicalCopper": {arm: pair[arm]["supplemental"]["physicalCopper"] for arm in ["A", "B"]}, "candidateFeatureCoverage": pair["B"]["featureCoverage"]})
    return {"dataset": dataset, "order": order, "records": len(records), "expectedRecords": COUNTS[dataset] * 2, "populationComplete": len(index) == len(records) == COUNTS[dataset] * 2, "strictRecordCount": sum(r.get("strictIntegrityQualified") is True for r in records), "separatelyCheckpointProvenTimeoutCount": sum((r.get("durableTimeoutSourceQualification") or {}).get("sourceAndInputProvenByBoundedCheckpoints") is True for r in records), "identitySets": identities, "completedOutputComparisons": comparisons, "officialOutcomeCounts": {arm: {"didSolve": sum((r.get("official") or {}).get("didSolve") is True for r in records if r.get("arm") == arm), "didTimeout": sum((r.get("official") or {}).get("didTimeout") is True for r in records if r.get("arm") == arm), "missingOfficial": sum(not isinstance(r.get("official"), dict) for r in records if r.get("arm") == arm)} for arm in ["A", "B"]}, "mutuallyPhysicalCleanPairs": pairs, "baselineReusedAcrossCandidates": False, "timingPolicy": "Own matched same-host constructor plus official solve only; declared-intent post-timing qualification is additive. Failed/unknown outputs never support quality gains; failures/invalid baselines never support speed claims. Orders/candidates/campaigns stay separate; changed-work proof is required for mechanism attribution."}


def qualify_record(record, manifest, item):
    problems = []
    row = record.get("official") or {}
    metrics = row.get("routingMetrics")
    if metrics is not None and not isinstance(metrics, dict):
        problems.append("Official routing metrics are not a nullable object")
    observed_audit = metrics.get("experimentAudit") if isinstance(metrics, dict) else None
    if observed_audit is not None and not isinstance(observed_audit, dict):
        problems.append("Actual factory audit is not an object")
    audit = observed_audit if isinstance(observed_audit, dict) else {}
    options = manifest["baseline"]["options"] if record["arm"] == "A" else item["options"]
    if not exact(record.get("requestedOptions"), options):
        problems.append("Record requested options differ from manifest")
    if not audit or audit.get("inputHash") != record["expectedInputHash"] or audit.get("inputMutated") is not False or not exact(audit.get("options"), options) or audit.get("actualCacheProviderState") != "disabled":
        problems.append("Actual factory input/options/cache identity unproven")
    expected_sha = MAIN if record["arm"] == "A" else item["candidateSha"]
    if record.get("sha") != expected_sha or audit.get("actualConstructorName") != SOLVER or audit.get("actualSolverName") != SOLVER or audit.get("solverModule") != MODULE or row.get("solverName") != SOLVER or row.get("sampleNumber") != record["sampleNumber"] or row.get("sampleTimeoutMs") != 360000:
        problems.append("Actual solver/sample/deadline identity differs")
    if any(type(row.get(k)) is not bool for k in ["didSolve", "didTimeout", "relaxedDrcPassed"]) or (audit.get("solverSolved") is True and audit.get("solverFailed") is True):
        problems.append("Invalid typed official outcome or contradictory actual state")
    observed = audit.get("evidence") or {}
    baseline_values = list(observed.values())
    if row.get("didSolve") is True and (set(observed) != set(item["evidencePaths"]) or (record["arm"] == "A" and any(value is not None for value in baseline_values))):
        problems.append("Actual terminal experiment evidence path population or legacy-A feature absence differs")
    if record.get("controllerError") or record.get("supplementalValidationError") or record.get("declaredIntentValidationError"):
        problems.append("Controller or supplemental validation failed")
    actual_runtime = record.get("officialReportRuntime") or {}
    if any(type(actual_runtime.get(k)) is not int or actual_runtime[k] != 1 for k in ["threadsPerSample", "effectiveThreadsPerSample", "cpuBudgetPerSample", "requestedConcurrency", "workerCount"]) or actual_runtime.get("bunVersion") != "1.4.2":
        problems.append("Actual official Bun/thread/concurrency runtime differs from the fixed protocol")
    if not all(finite(v) for v in [row.get("elapsedTimeMs"), audit.get("constructorTimeMs"), record.get("externalBenchmarkProcessWallMs")]):
        problems.append("Timing observations missing")
    elif record["externalBenchmarkProcessWallMs"] + .001 < row["elapsedTimeMs"] + audit["constructorTimeMs"]:
        problems.append("External wall shorter than primary clocks")
    if row.get("didSolve") is True:
        supplemental = record.get("supplemental") or {}
        if audit.get("solverSolved") is not True or audit.get("solverFailed") is not False or audit.get("solverError") is not None or row.get("didTimeout") is not False:
            problems.append("Solved result contradicts actual terminal state")
        if not all(digest(audit.get(k), 64) for k in ["rawOutputHash", "rawNewTracesHash"]) or not digest(supplemental.get("canonicalCircuitJsonSha256"), 64):
            problems.append("Solved result missing actual output/canonical copper hashes")
        for name in CHECKS:
            check = supplemental.get(name, {})
            if type(check.get("count")) is not int or check["count"] < 0 or not isinstance(check.get("byType"), dict) or any(type(v) is not int or v < 0 for v in check.get("byType", {}).values()) or sum(check.get("byType", {}).values()) != check.get("count"):
                problems.append("Supplemental findings population invalid: " + name)
        problems.extend(declared.validate_compact(record, manifest))
        copper = supplemental.get("physicalCopper") or {}
        if any(type(copper.get(k)) is not int or copper[k] < 0 for k in ["combinedRouteViaCount", "uniqueOwnedViaSiteSpanCount", "uniqueOwnedManufacturedViaSiteCount", "foreignOwnerCoincidentViaSiteSpans", "combinedRoutePointCount"]) or any(not finite(copper.get(k)) for k in ["combinedCopperLength", "exactSegmentDeduplicatedCopperLength"]):
            problems.append("Physical copper counts/lengths are not finite typed nonnegative metrics")
    if record.get("phaseCheckpointAudit", {}).get("errors"):
        problems.extend(record["phaseCheckpointAudit"]["errors"])
    record["featureCoverage"] = feature_coverage(record, item)
    record["strictIntegrityIssues"] = problems
    record["strictIntegrityQualified"] = not problems
    return record


def run(args, manifest, item):
    output = args.output.resolve()
    require(not output.exists() or not any(output.iterdir()), "Output must be fresh; never overwrite an attempt")
    checkouts = {"A": args.baseline.resolve(), "B": args.candidate.resolve()}
    verify_dependencies(manifest, checkouts)
    pinned.write_json(output / "post588-controller-provenance.json", {
        "campaign": CAMPAIGN, "manifestSha256": sha(args.manifest),
        "controllerSha": os.environ.get("GITHUB_SHA"), "githubRunId": os.environ.get("GITHUB_RUN_ID"),
        "baselineSha": MAIN, "candidateSha": item["candidateSha"], "candidateTree": item["candidateTree"],
        "executionScope": manifest["executionScope"],
        "executionOrder": args.order, "completeOriginalDatasetRequested": {"dataset": args.dataset, "count": COUNTS[args.dataset]},
        "prior588CampaignImmutable": True, "prior568CampaignImmutable": True, "timingsPooledAcrossCampaigns": False,
        "strictTimeoutPolicy": manifest["strictTimeoutPolicy"],
        "declaredIntentPostTiming": {"sourceSha256": DECLARED_SOURCE_SHA256,
                                      "checkerSha256": CHECKER_SOURCE_SHA256},
    })
    identities = {arm: pinned.read_identity(path, args.dataset) for arm, path in checkouts.items()}
    require(exact(identities["A"], identities["B"]) and [x["sampleNumber"] for x in identities["A"]] == list(range(1, COUNTS[args.dataset] + 1)) and {str(x["sampleNumber"]): x["inputHash"] for x in identities["A"]} == manifest["expectedInputHashesByDataset"][args.dataset], "Exact complete original population changed")
    harnesses = {arm: json.loads((path / "experiment-harness-provenance.json").read_text()) for arm, path in checkouts.items()}
    for arm, value in harnesses.items():
        require(value.get("checkoutSha") == (MAIN if arm == "A" else item["candidateSha"]) and value.get("validators") == manifest["expectedValidatorHashes"] and all(value.get(k) == v for k, v in manifest["expectedHarnessSourceHashes"].items()), "Adapted current-main harness/validator identity differs")
    dependency_comparison = pinned.compare_dependency_resolutions(harnesses)
    configs = {"A": dict(manifest["baseline"], evidencePaths=item["evidencePaths"]), "B": dict(item)}
    campaign = manifest["campaign"] + ":" + item["id"]
    for arm, config in configs.items():
        config["phaseCheckpoint"] = {"observerSourceSha256": manifest["runtimeSourceHashes"]["phase-checkpoint-observer.ts"], "campaign": campaign, "algorithmSha": MAIN if arm == "A" else item["candidateSha"], "arm": arm, "executionOrder": args.order, "githubRunId": os.environ.get("GITHUB_RUN_ID"), "controllerSha": os.environ.get("GITHUB_SHA")}
        pinned.write_json(output / ("config-" + arm + ".json"), config)
    pinned.write_json(output / "provenance.json", {"manifest": manifest, "experiment": item["id"], "dataset": args.dataset, "inputPopulation": identities["A"], "harnesses": harnesses, "dependencyComparison": dependency_comparison, "machine": {"platform": platform.platform(), "architecture": platform.machine(), "cpuCount": os.cpu_count()}, "githubRunId": os.environ.get("GITHUB_RUN_ID"), "controllerSha": os.environ.get("GITHUB_SHA"), "executionOrder": args.order})
    records = []
    for identity in identities["A"]:
        for arm in args.order:
            sample = identity["sampleNumber"]
            metadata = {"campaign": campaign, "experiment": item["id"], "pr": item["pr"], "dataset": args.dataset, "round": 1, "sampleNumber": sample, "arm": arm, "executionOrder": args.order, "requestedOptions": configs[arm]["options"]}
            print("POST588_EXPERIMENT_ACTIVE_JSON " + json.dumps(metadata), flush=True)
            target = output / "round-1" / f"sample-{sample:03d}" / arm
            record = pinned.run_sample(checkouts[arm], output / ("config-" + arm + ".json"), target, args.dataset, sample, 360)
            record.update(metadata, qualificationMode="full", scenarioName=identity["scenarioName"], expectedInputHash=identity["inputHash"], sha=MAIN if arm == "A" else item["candidateSha"], solverName=SOLVER)
            declared.qualify_output(record, target, checkouts[arm], manifest, ROOT, pinned.execute_with_deadline)
            record["phaseCheckpointAudit"] = checkpoint_audit(target / "raw", {"campaign": campaign, "arm": arm, "algorithmSha": record["sha"], "dataset": args.dataset, "originalSample": sample, "inputSha256": identity["inputHash"], "observerSourceSha256": manifest["runtimeSourceHashes"]["phase-checkpoint-observer.ts"], "executionOrder": args.order, "githubRunId": os.environ.get("GITHUB_RUN_ID"), "controllerSha": os.environ.get("GITHUB_SHA")})
            qualify_record(record, manifest, item)
            record["durableTimeoutSourceQualification"] = timeout_checkpoint_qualification(record)
            record["nonterminalFeatureObservations"] = coverage_module.nonterminal_observations(record, item)
            records.append(record)
            pinned.write_json(target / "audit-result.json", record)
            with (output / "results.jsonl").open("a") as stream:
                stream.write(json.dumps(record) + "\n")
            print("POST588_EXPERIMENT_RESULT_JSON " + json.dumps(record, separators=(",", ":")), flush=True)
            pinned.write_json(output / "summary.json", summarize(records, args.dataset, args.order))
    result = summarize(records, args.dataset, args.order)
    pinned.write_json(output / "summary.json", result)
    print("POST588_EXPERIMENT_SUMMARY_JSON " + json.dumps(result, separators=(",", ":")), flush=True)
    require(result["populationComplete"] and result["strictRecordCount"] == result["expectedRecords"], "Characterization completed with integrity issues; every failure/attempt remains retained")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["plan", "select", "verify-checkouts", "verify-dependencies", "run"], required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--experiment", choices=["all", *FEATURES])
    parser.add_argument("--dataset", choices=["both", *COUNTS])
    parser.add_argument("--order", choices=["AB", "BA"])
    parser.add_argument("--baseline", type=pathlib.Path)
    parser.add_argument("--candidate", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    manifest = validate_manifest(args.manifest)
    for key, value in manifest["dispatchRequest"].items():
        if getattr(args, key) is None:
            setattr(args, key, value)
    if os.environ.get("GITHUB_ACTIONS") == "true":
        require(os.environ.get("GITHUB_EVENT_NAME") == "push" and os.environ.get("GITHUB_REF_NAME") == BRANCH, "Only the dedicated reviewed push branch may run this controller")
    if args.mode == "plan":
        require(exact({key: getattr(args, key) for key in ["experiment", "dataset", "order"]}, manifest["dispatchRequest"]), "Plan lies outside the sealed experiment/dataset/order scope")
        outputs({"matrix": json.dumps(execution_matrix(manifest), separators=(",", ":"))})
        return
    require(args.experiment != "all" and args.dataset != "both", "One exact experiment/dataset required outside plan")
    scope = manifest["executionScope"]
    require(args.experiment in scope["experiments"] and args.dataset in scope["datasets"] and args.order == scope["order"], "Attempt lies outside the sealed experiment/dataset/order scope")
    item = select(manifest, args.experiment)
    if args.mode == "select":
        outputs({"baseline_sha": MAIN, "candidate_sha": item["candidateSha"], "harness_sha": MAIN})
    elif args.mode == "verify-checkouts":
        verify_checkouts(manifest, item, {"A": args.baseline, "B": args.candidate})
    elif args.mode == "verify-dependencies":
        verify_dependencies(manifest, {"A": args.baseline, "B": args.candidate})
    else:
        run(args, manifest, item)


if __name__ == "__main__":
    main()
