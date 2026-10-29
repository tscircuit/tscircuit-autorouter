#!/usr/bin/env python3
"""Full original42 guarded coalesced-model pairs without partial retention."""
import argparse
import hashlib
import importlib.util
import inspect
import math
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
COUNTS = {"srj18": 16, "srj24": 26}
ORIGINAL_PASSING = {"srj18": list(range(1, 17)), "srj24": [5, 6, 7, 8, 9, 10, 12, 15, 16, 17, 19, 20, 21, 22, 23, 25, 26]}
ORIGINAL_FAILING = {dataset: [n for n in range(1, COUNTS[dataset] + 1) if n not in ORIGINAL_PASSING[dataset]] for dataset in COUNTS}
TARGETS = {dataset: list(range(1, count + 1)) for dataset, count in COUNTS.items()}
MODULE = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts"
SOLVER = "AutoroutingPipelineSolver9_PreloadedTraceGraph"
# Filled only after the geometry agent reports its reviewed selector API.
GEOMETRY_MODULE = "lib/testing/CertifiedDirectAutoroutingPipelineSolver.ts"
GEOMETRY_SOLVER = "CertifiedDirectAutoroutingPipelineSolver"
COMMON_OPTIONS = {"cacheProvider": None, "effort": 1}
FIXES_OPTIONS = {**COMMON_OPTIONS, "usePhysicalNetForest": False, "retainBestPartialRouting": False, "usePhysicalNetForestInteriorCosts": False}
RETENTION_OPTIONS = {**FIXES_OPTIONS, "retainBestPartialRouting": True}
FOREST_OPTIONS = {**RETENTION_OPTIONS, "usePhysicalNetForest": True, "usePhysicalNetForestInteriorCosts": True}
PRIOR_SOURCE = MAIN
PRIOR_TREE = "4848273d65b54a17d1d3cf7d779127756f446d73"
CAMPAIGNS = {
    "main-vs-coalesced-model-only-full42": {"pr": 3338, "family": "retention", "baselineKind": "pinned-prior", "aOptions": {**COMMON_OPTIONS}, "bOptions": {**COMMON_OPTIONS, "retainBestPartialRouting": False, "constrainViaPadPlacement": True}},
}

ASSETS = {"run-pinned-experiment.py", "select-pinned-experiment.py", "prepare-pinned-harness.py", "install-pinned-dependencies.py", "experiment-audit-adapter.ts", "qualify-pinned-output.ts", "experiment-dataset-identity.ts", "phase-checkpoint-observer.ts", "capture-terminal-failure-geometry.ts", "run-retention-coalesced-model-only-full42.py"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evidence_paths(family):
    if family == "geometry":
        return ["selection", "stats"]
    if family == "retention":
        prefix = "portPointPathingSolver.tinyPipelineSolver.solveGraph."
        return [prefix + "RETAIN_BEST_PARTIAL_ROUTING", prefix + "stats.retainedPartialRouteCount", prefix + "problem.regionLayerChangeAllowedNetIds.length", "highDensityRouteSolver.viaPlacementContext.layerCount"]
    return ["physicalNetForestSolver.diagnostics", "highDensityRouteSolver.benchmarkDiagnosticCounters"]


def validate_manifest(path):
    manifest = json.loads(pathlib.Path(path).read_text())
    campaign = CAMPAIGNS.get(manifest.get("campaign"))
    if manifest.get("qualificationScope") != "FULL_ORIGINAL42_MODEL_ONLY_GUARD_ON_RETENTION_OFF_AB" or manifest.get("knownExcludedFailureSampleNumbers") != {"srj18": [], "srj24": []} or manifest.get("noRegressionReleaseEligible") is not False or manifest.get("duplicateGeometryNotIndependentReplication") is not True:
        raise ValueError("Complete original42 scope, no excluded samples and duplicate-screen geometry must remain explicit")
    if manifest.get("plannedRecordCount") != 84 or manifest.get("plannedExecutionOrders") != ["AB"] or manifest.get("fullPopulationRequired") is not True:
        raise ValueError("All84 fresh AB records are required; a target-only screen cannot activate this sweep")
    validate_screen_activation_gate(manifest)
    validate_other_configuration_history(manifest)
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
        raise ValueError("Exact original or same-candidate source tree required")
    if manifest["baselineSha"] != expected_baseline:
        raise ValueError("Baseline must be original637 or the same reviewed candidate source")
    baseline_publication = manifest.get("baselinePublication", {})
    if baseline_publication.get("publishedCommit") != expected_baseline or baseline_publication.get("expectedTree") != expected_baseline_tree or baseline_publication.get("status") != "PUBLISHED_EXACT_TREE_REVIEWED":
        raise ValueError("Baseline source/tree publication binding differs")
    expected_prior_local = MAIN
    if baseline_publication.get("reviewedLocalCommit") != (publication["reviewedLocalCommit"] if campaign["baselineKind"] == "candidate" else expected_prior_local):
        raise ValueError("Baseline local equivalent tree binding differs")
    for arm, source_publication, config in [("A", baseline_publication, manifest["baseline"]), ("B", publication, experiment)]:
        proof = manifest.get("factoryParityByArm", {}).get(arm, {})
        parity_names = ["experiment-audit-adapter.ts", "phase-checkpoint-observer.ts", "capture-terminal-failure-geometry.ts"]
        if proof.get("status") != "PASS_LOCAL_TINY_ACTUAL_ADAPTER_FACTORY_CONTROL" or proof.get("sourceSha") != source_publication["reviewedLocalCommit"] or proof.get("sourceTree") != source_publication["expectedTree"] or proof.get("runtimeSourceHashes") != {name: manifest["runtimeSourceHashes"][name] for name in parity_names}:
            raise ValueError("Actual factory/observer/source tree parity missing for arm " + arm)
        for key in ["solverName", "solverModule", "options", "evidencePaths"]:
            if proof.get("config", {}).get(key) != config.get(key):
                raise ValueError("Factory parity configuration differs: " + arm + "/" + key)
        actual = proof.get("actualTerminalEvidence", {})
        for key, expected in {"actualSolverName": config["solverName"], "actualConstructorName": config["solverName"], "solverModule": config["solverModule"], "options": config["options"], "inputHash": proof.get("inputHash"), "inputMutated": False, "solverSolved": True, "solverFailed": False}.items():
            if actual.get(key) != expected:
                raise ValueError("Terminal factory parity evidence differs: " + arm + "/" + key)
        observed = actual.get("evidence", {})
        live_path, _, permission_path, context_path = evidence_paths("retention")
        if any(path not in observed for path in evidence_paths("retention")):
            raise ValueError("Actual activation evidence key is missing, not an observed null: " + arm)
        expected_live = config["options"].get("retainBestPartialRouting")
        if observed.get(live_path) is not expected_live or (expected_live is not None and type(observed[live_path]) is not bool):
            raise ValueError("Actual live retention activation differs: " + arm)
        if observed.get(context_path) != (2 if config["options"].get("constrainViaPadPlacement") is True else None):
            raise ValueError("Actual HD context activation differs on the tiny control: " + arm)
        if observed.get(permission_path) is not None or "no fully covered foreign-pad regions" not in proof.get("controlScope", ""):
            raise ValueError("Tiny same-net control must report its actual absent coarse restriction array")
        evidence_text = proof.get("evidenceFileText")
        if not isinstance(evidence_text, str) or hashlib.sha256(evidence_text.encode()).hexdigest() != proof.get("evidenceFileSha256"):
            raise ValueError("Exact factory evidence file bytes/digest differ")
        archived_proof = json.loads(evidence_text)
        for key in ["status", "sourceSha", "sourceTree", "runtimeSourceHashes", "config", "inputHash", "outputHash", "iterations", "maxIterations", "checkpointRows"]:
            if archived_proof.get(key) != proof.get(key):
                raise ValueError("Archived factory evidence summary differs: " + key)
        if archived_proof.get("evidence") != actual:
            raise ValueError("Archived actual factory terminal evidence differs")
    activation = manifest.get("frozenPrefixActivation", {})
    activation_text = manifest.get("frozenPrefixActivationEvidenceText")
    if not isinstance(activation_text, str) or hashlib.sha256(activation_text.encode()).hexdigest() != manifest.get("frozenPrefixActivationEvidenceSha256") or json.loads(activation_text) != activation:
        raise ValueError("Frozen real-board prefix evidence bytes/digest differ")
    validate_prefix_activation(activation, publication, manifest)
    for arm, wanted_sha, wanted_tree in [
        ("A", "ec80c91ccbf6529bfd9ae5b205c1d24c7f40bef1" if campaign["baselineKind"] == "pinned-prior" else "7175e6cbeaf1a0102c16730a1d3518910eb08ac7", "7a96716ce52169e0f71774f69798e41535642324" if campaign["baselineKind"] == "pinned-prior" else "01f38869cf3eaebb599218424d81308d060dffce"),
        ("B", "7175e6cbeaf1a0102c16730a1d3518910eb08ac7", "01f38869cf3eaebb599218424d81308d060dffce"),
    ]:
        tiny = manifest.get("tinyDependencyByArm", {}).get(arm, {})
        if tiny.get("remoteSha") != wanted_sha or tiny.get("declaration") != "git+https://github.com/tscircuit/tiny-hypergraph.git#" + wanted_sha or tiny.get("installedSource") != "https://codeload.github.com/tscircuit/tiny-hypergraph/tar.gz/" + wanted_sha:
            raise ValueError("Exact Tiny dependency pin differs: " + arm)
        if tiny.get("tree") != wanted_tree or not tiny.get("sourceFileSha256") or "lib/core.ts" not in tiny["sourceFileSha256"] or "package.json" not in tiny["sourceFileSha256"] or any(not re.fullmatch(r"[0-9a-f]{64}", str(value)) for value in tiny["sourceFileSha256"].values()):
            raise ValueError("Exact Tiny source tree/file inventory differs: " + arm)

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


def validate_other_configuration_history(manifest):
    history = manifest.get("otherConfigurationHistory", {})
    expected_options = {**COMMON_OPTIONS, "constrainViaPadPlacement": True, "retainBestPartialRouting": True}
    if history.get("configuration") != expected_options or history.get("knownLocalCoarseIterationFailures") != {"srj18": [15], "srj24": []} or history.get("failureDoesNotDescribeCandidateConfiguration") is not True:
        raise ValueError("Retention-on sample15 failure is a separate configuration, not an excluded model-only failure")
    raw = history.get("evidenceFileText")
    if not isinstance(raw, str) or hashlib.sha256(raw.encode()).hexdigest() != history.get("evidenceFileSha256"):
        raise ValueError("Exact other-configuration history bytes/digest differ")
    prior = json.loads(raw)
    publication = manifest.get("candidatePublication", {})
    if prior.get("status") != "MIXED_COARSE_GATE_14_AND_DUPLICATE24_PASS_15_ITERATION_FAIL" or prior.get("sourceLocal") != publication.get("reviewedLocalCommit") or prior.get("sourceTree") != publication.get("expectedTree") or prior.get("tinyRemote") != "7175e6cbeaf1a0102c16730a1d3518910eb08ac7" or prior.get("tinyTree") != "01f38869cf3eaebb599218424d81308d060dffce":
        raise ValueError("Other-configuration source/tree binding differs")
    rows = [row for row in prior.get("records", []) if row.get("sample") == 15 and row.get("guard") is True]
    if len(rows) != 1:
        raise ValueError("Original retention-on sample15 failure must remain explicit")
    row = rows[0]
    expected = {"sourceSha": publication.get("reviewedLocalCommit"), "sourceTree": publication.get("expectedTree"), "tinyTree": "01f38869cf3eaebb599218424d81308d060dffce", "retainFlag": True, "constrainFlag": True, "coarseMAXIterations": 2000000, "coarseIterations": 2000000, "externalCutoffReached": False, "failed": True, "coarseFailed": True, "coarseSolved": False, "phase": "portPointPathingSolver", "hdContextPresent": False, "hdContextSha256": None, "inputSha256": manifest.get("expectedInputHashesByDataset", {}).get("srj18", {}).get("15")}
    if any(row.get(k) != v for k, v in expected.items()):
        raise ValueError("Other-configuration failure was relabelled or changed")


def validate_prefix_activation(activation, publication, manifest):
    options = {**COMMON_OPTIONS, "constrainViaPadPlacement": True, "retainBestPartialRouting": False}
    expected = {"status": "ALL_THREE_REACH_HD0_WITH_MODEL_OPTION_ON_AND_RETENTION_OFF",
        "sourceRemote": publication["publishedCommit"], "sourceLocal": publication["reviewedLocalCommit"], "sourceTree": publication["expectedTree"],
        "tinyRemote": "7175e6cbeaf1a0102c16730a1d3518910eb08ac7", "tinyLocal": "eda3349bcf8c6b88105c20981eb34b04852ea556",
        "tinyTree": "01f38869cf3eaebb599218424d81308d060dffce", "retentionOn14Off14Duplicate24ContextsByteIdentical": True,
        "same14And24GeometryNotIndependentReplication": True, "allOriginalBudgetsUnchanged": True, "allOptions": options}
    if any(activation.get(k) != v for k, v in expected.items()):
        raise ValueError("Exact model-only prefix source/configuration binding differs")
    rows = activation.get("records", [])
    if [(row.get("dataset"), row.get("sample")) for row in rows] != [("srj18",14),("srj18",15),("srj24",12)]:
        raise ValueError("All three actual model-only prefix controls must remain explicit")
    for row in rows:
        pins = {"sourceRemote": publication["publishedCommit"], "sourceSha": publication["reviewedLocalCommit"], "sourceTree": publication["expectedTree"],
            "tinySha": expected["tinyLocal"], "tinyTree": expected["tinyTree"], "retainOption": False, "retainFlag": False,
            "configurationControl": "GUARD_ON_RETAIN_BEST_PARTIAL_ROUTING_OFF", "guard": True, "constrainFlag": True,
            "phase": "highDensityRouteSolver", "failed": False, "error": None, "hdContextPresent": True, "hdIterations": 0,
            "coarseSolved": True, "coarseFailed": False, "coarseMAXIterations": 2000000, "externalCutoffReached": False,
            "forbiddenLayerChanges": 0, "forbiddenPhysicalCrossings": 0, "exactPerLayerWorldGeometryMetadataCoveragePreserved": True,
            "retiredNodeIdsMustBeMappedNotTreatedAsRecovered": True,
            "inputSha256": manifest["expectedInputHashesByDataset"][row["dataset"]][str(row["sample"])]}
        if any(row.get(k) != v for k, v in pins.items()) or row.get("geometryPerLayerMetadataMultisetBeforeSha256") != row.get("geometryPerLayerMetadataMultisetAfterSha256") or not re.fullmatch(r"[0-9a-f]{64}", str(row.get("geometryPerLayerMetadataMultisetBeforeSha256"))):
            raise ValueError("Actual model-only activation pins/geometry conservation differ")
        if row["sample"] in [14,12]:
            values = {"coarseIterations": 803099, "constrained": 2130, "topologyOriginalNodes": 2746,
                "topologyGroups": 337, "topologyRemovedNodes": 716, "topologyOutputNodes": 2030,
                "targetNodesProtected": 362, "hdContextSha256": "51cc93752733349f99b330abdb3ed3f2f0fe9f937d132259f926b728a8c60be2"}
        else:
            values = {"coarseIterations": 2000000, "constrained": 3378, "topologyOriginalNodes": 3389,
                "topologyGroups": 195, "topologyRemovedNodes": 458, "topologyOutputNodes": 2931,
                "targetNodesProtected": 584, "hdContextSha256": "0d2f1f2f3858c2fc69383825c57aceb8ec81b089051f6759f51d4c6d099e50ff"}
        if any(row.get(k) != v for k, v in values.items()):
            raise ValueError("Actual model-only coarse activation or target-preservation counts differ")
    audits = activation.get("physicalPlanAudits", {})
    for key, values in {
        "srj18/14_and_duplicate24/12": {"nodeCount": 924, "properSameLayerForeignChordCrossings": 44, "fullyCertifiedNoViaPairCrossings": 0, "unsupportedOriginalSMTShapesExcluded": 199},
        "srj18/15": {"nodeCount": 1388, "properSameLayerForeignChordCrossings": 25, "fullyCertifiedNoViaPairCrossings": 0, "unsupportedOriginalSMTShapesExcluded": 416},
    }.items():
        if any(audits.get(key, {}).get(k) != v for k, v in values.items()):
            raise ValueError("Bounded physical-plan audit or unsupported geometry disclosure differs")


def finite_nonnegative(value):
    return type(value) in [int, float] and math.isfinite(value) and value >= 0


def validate_screen_activation_gate(manifest):
    gate = manifest.get("completedScreenActivationGate", {})
    raw = gate.get("evidenceFileText")
    if gate.get("status") != "PASS_COMPLETED_STRICT_SIX_RECORD_MODEL_ONLY_SCREEN" or not isinstance(raw, str) or hashlib.sha256(raw.encode()).hexdigest() != gate.get("evidenceFileSha256") or gate.get("evidenceFileSha256") != "bb126d5e81950b52ac389aa011f476f3d9c48d763fd1013d24526a6ceb82b9cb":
        raise ValueError("Exact completed strict six-screen ledger is missing or changed")
    validate_completed_screen_ledger(json.loads(raw), manifest)
    validate_original_input_metadata(manifest)


def validate_original_input_metadata(manifest):
    raw = manifest.get("originalInputManufacturingMetadataEvidenceText")
    digest = manifest.get("originalInputManufacturingMetadataEvidenceSha256")
    if not isinstance(raw, str) or hashlib.sha256(raw.encode()).hexdigest() != digest or digest != "a89d79971acbfabf08ba3f5133f773166c515f054b3bcc36498f382935a9b57d":
        raise ValueError("Exact original42 manufacturing metadata bytes/digest differ")
    metadata = json.loads(raw)
    if metadata.get("status") != "PASS_EXACT_ALL42_IMMUTABLE_INPUT_HASHES" or manifest.get("originalInputManufacturingMetadata") != metadata:
        raise ValueError("Original42 metadata is not hash-qualified")
    for dataset, count in COUNTS.items():
        rows = metadata.get("records", {}).get(dataset, [])
        if [r.get("sampleNumber") for r in rows] != list(range(1, count + 1)):
            raise ValueError("Original42 metadata population changed")
        for row in rows:
            sample = str(row["sampleNumber"])
            if row.get("inputHash") != manifest.get("expectedInputHashesByDataset", {}).get(dataset, {}).get(sample) or type(row.get("layerCount")) is not int or row["layerCount"] not in [2,4,6,8] or type(row.get("allowBlindAndBuriedViasEffective")) is not bool:
                raise ValueError("Original input hash or manufactured layer metadata differs")
            expected = {"expectedOriginalLayerCountsByDataset": row["layerCount"], "expectedAllowBlindAndBuriedViasByDataset": row["allowBlindAndBuriedViasEffective"], "expectedDeclaredAllowBlindAndBuriedViasByDataset": row.get("allowBlindAndBuriedViasDeclared")}
            if any(manifest.get(key, {}).get(dataset, {}).get(sample, "missing") != value for key, value in expected.items()):
                raise ValueError("Per-case original layer or blind-via metadata map differs")
        for key in ["expectedOriginalLayerCountsByDataset", "expectedAllowBlindAndBuriedViasByDataset", "expectedDeclaredAllowBlindAndBuriedViasByDataset"]:
            if set(manifest.get(key, {}).get(dataset, {})) != {str(n) for n in range(1, count + 1)}:
                raise ValueError("All42 original manufacturing metadata entries are required")


def validate_completed_screen_ledger(ledger, manifest):
    publication = manifest.get("candidatePublication", {})
    options = {**COMMON_OPTIONS, "retainBestPartialRouting": False, "constrainViaPadPlacement": True}
    expected = {"status": "PASS_CURRENT_MODEL_ONLY_CONFIGURATION_THREE_CONTROL_SCREEN", "algorithm": publication.get("publishedCommit"), "algorithmTree": publication.get("expectedTree"), "reviewedLocalSource": publication.get("reviewedLocalCommit"), "tiny": "7175e6cbeaf1a0102c16730a1d3518910eb08ac7", "tinyTree": "01f38869cf3eaebb599218424d81308d060dffce", "controller": "1ce225eba5e9df17bdf67e434435e47d2e0f4083", "controllerTree": "ae4e6c886476826dc4b80d2cb0290cd8e838f685", "runId": 40788562236, "candidateOptions": options, "order": "AB", "targets": {"srj18": [14,15], "srj24": [12]}, "recordsExpected": 6, "recordsStrictlyQualified": 6, "candidateReferencePasses": 3, "candidatePhysicalScreenPasses": 3, "baselineReferencePasses": 3, "baselinePhysicalScreenPasses": 2, "baselinePhysicalFailure": {"dataset": "srj18", "sample": 15, "type": "pcb_pad_pad_clearance_error", "count": 13}, "timedOutAttempts": 0, "recordIntegrityIssues": [], "full42TechnicalScreenGateClearedForThisConfiguration": True, "duplicate14And24NotIndependentReplication": True, "retentionTrue15FailureDoesNotDescribeThisConfiguration": True}
    if any(ledger.get(key) != value for key, value in expected.items()):
        raise ValueError("Completed screen source/configuration, strict status or candidate physical passes differ")
    summaries = ledger.get("records", [])
    by_key = {(r.get("dataset"), r.get("sampleNumber"), r.get("arm")): r for r in summaries}
    wanted_keys = {(ds, sample, arm) for ds, numbers in expected["targets"].items() for sample in numbers for arm in ["A", "B"]}
    jobs = ledger.get("jobs", [])
    if len(summaries) != 6 or set(by_key) != wanted_keys or len(jobs) != 2 or {j.get("dataset") for j in jobs} != set(COUNTS):
        raise ValueError("Complete six-record screen and both original datasets are required")
    seen = set()
    for job in jobs:
        raw = job.get("parsedEvidenceText")
        if not isinstance(raw, str) or hashlib.sha256(raw.encode()).hexdigest() != job.get("sha256"):
            raise ValueError("Archived strict parsed screen job bytes/digest differ")
        parsed = json.loads(raw)
        dataset = job["dataset"]
        selected = expected["targets"][dataset]
        pins = {"campaign": "main-vs-coalesced-model-only", "qualificationMode": "screen", "executionOrder": "AB", "dataset": dataset, "runId": str(expected["runId"]), "controllerSha": expected["controller"], "baselineSha": MAIN, "candidateSha": publication.get("publishedCommit"), "selectedSampleNumbers": selected, "selectedSampleCount": len(selected), "fullDatasetSampleCount": COUNTS[dataset], "options": {"A": manifest["baseline"]["options"], "B": options}, "expectedRecordCount": 2 * len(selected), "observedRecordCount": 2 * len(selected), "missing": [], "integrityIssues": [], "diagnosticIssues": [], "populationComplete": True, "hardIntegrityQualified": True, "operationalPopulationComplete": True, "checkpointCoverageQualified": True, "strictlyQualified": True, "isFullCorpusSweep": False, "manifestSha256": sha(ROOT / "strongest-refinement-main-vs-coalesced-model-only.json")}
        if any(parsed.get(key) != value for key, value in pins.items()):
            raise ValueError("Archived screen job strict provenance or population differs")
        physical = parsed.get("physicalQualification", {})
        physical_pins = {"referenceCleanCount": {"A": len(selected), "B": len(selected)}, "physicalScreenCleanCount": {"A": len(selected) - (1 if dataset == "srj18" else 0), "B": len(selected)}, "physicalScreenRegressions": [], "physicalScreenGains": [15] if dataset == "srj18" else []}
        if any(physical.get(k) != v for k,v in physical_pins.items()):
            raise ValueError("Archived screen physical-clean identity summary differs")
        records = parsed.get("records", [])
        if len(records) != 2 * len(selected):
            raise ValueError("Archived screen job record count differs")
        for record in records:
            sample, arm = record.get("sampleNumber"), record.get("arm")
            key = (dataset, sample, arm)
            if key not in wanted_keys or key in seen:
                raise ValueError("Screen result key is missing, repeated or foreign")
            seen.add(key)
            config = manifest["baseline"] if arm == "A" else manifest["experiments"][0]
            source = MAIN if arm == "A" else publication["publishedCommit"]
            input_hash = manifest["expectedInputHashesByDataset"][dataset][str(sample)]
            row = record.get("official") or {}
            audit = row.get("routingMetrics", {}).get("experimentAudit") or {}
            if any(record.get(k) != v for k,v in {"campaign": pins["campaign"], "qualificationMode": "screen", "executionOrder": "AB", "round": 1, "dataset": dataset, "sha": source, "solverName": SOLVER, "expectedInputHash": input_hash}.items()) or record.get("controllerError") is not None or record.get("supplementalValidationError") is not None:
                raise ValueError("Actual archived screen source/input/error fields differ")
            if any(row.get(k) != v for k,v in {"sampleNumber": sample, "solverName": SOLVER, "didSolve": True, "didTimeout": False, "relaxedDrcPassed": True}.items()) or any(audit.get(k) != v for k,v in {"actualSolverName": SOLVER, "actualConstructorName": SOLVER, "solverModule": MODULE, "options": config["options"], "inputHash": input_hash, "inputMutated": False, "solverSolved": True, "solverFailed": False, "solverError": None, "actualCacheProviderState": "disabled"}.items()):
                raise ValueError("Actual archived screen solve/factory/options are not clean")
            observed = audit.get("evidence", {})
            paths = evidence_paths("retention")
            live = config["options"].get("retainBestPartialRouting")
            if any(path not in observed for path in paths) or observed[paths[0]] is not live:
                raise ValueError("Actual archived screen retention option differs")
            if arm == "B":
                if type(observed[paths[2]]) is not int or observed[paths[2]] <= 0 or observed[paths[3]] != manifest["expectedOriginalLayerCountsByDataset"][dataset][str(sample)]:
                    raise ValueError("Actual archived screen physical guard activation missing")
            elif observed[paths[2]] is not None or observed[paths[3]] is not None:
                raise ValueError("Original screen baseline falsely claims new guards")
            checks = record.get("supplemental") or {}
            for name in ["referenceFullCopperChecks", "inputOnlyPhysicalChecks", "boardCopperChecks", "viaBoardChecks"]:
                if type(checks.get(name, {}).get("count")) is not int or checks[name]["count"] != 0:
                    raise ValueError("Original screen reference or physical checks are not clean")
            library = checks.get("libraryRoutingChecks", {})
            by_type = library.get("byType")
            if not isinstance(by_type, dict) or type(library.get("count")) is not int or any(type(v) is not int or v < 0 for v in by_type.values()) or sum(by_type.values()) != library["count"]:
                raise ValueError("Original screen library findings incomplete")
            pad_count = by_type.get("pcb_pad_pad_clearance_error", 0)
            expected_pad = 13 if key == ("srj18", 15, "A") else 0
            if pad_count != expected_pad:
                raise ValueError("Candidate physical pass or original baseline15 invalidity was changed")
            constructor, elapsed, wall = audit.get("constructorTimeMs"), row.get("elapsedTimeMs"), record.get("externalBenchmarkProcessWallMs")
            if not all(finite_nonnegative(v) for v in [constructor, elapsed, wall]) or wall + 0.001 < constructor + elapsed:
                raise ValueError("Archived screen constructor/official/external clock integrity differs")
            checkpoint = record.get("phaseCheckpointAudit") or {}
            status = checkpoint.get("status") or {}
            last = checkpoint.get("lastDurableCheckpoint") or {}
            count = checkpoint.get("rowCount")
            clock_pins = {"schemaVersion": 1, "campaign": pins["campaign"], "arm": arm, "dataset": dataset, "algorithmSha": source, "inputSha256": input_hash, "originalSample": sample, "observerSourceSha256": manifest["runtimeSourceHashes"]["phase-checkpoint-observer.ts"], "githubRunId": str(expected["runId"]), "controllerSha": expected["controller"], "executionOrder": "AB", "observedObjectPath": "solver", "observedConstructorName": SOLVER, "event": "solve_exit"}
            if checkpoint.get("errors") != [] or type(count) is not int or not 1 <= count <= 256 or status.get("observerSourceSha256") != clock_pins["observerSourceSha256"] or any(status.get(k) is not True for k in ["installed", "solveEntered", "solveFinished"]) or status.get("errors") != [] or status.get("truncated") is not False or any(last.get(k) != v for k,v in clock_pins.items()) or last.get("sequence") != count - 1 or not finite_nonnegative(last.get("monotonicMs")) or not finite_nonnegative(last.get("officialStartOffsetMs")) or last["officialStartOffsetMs"] > elapsed + 2:
                raise ValueError("Archived screen checkpoint source or terminal clock integrity differs")
            summary = by_key[key]
            summary_pins = {"sourceSha": source, "options": config["options"], "expectedInputHash": input_hash, "observedInputHash": input_hash, "outputHash": audit.get("rawOutputHash"), "traceHash": audit.get("rawNewTracesHash"), "didSolve": True, "didTimeout": False, "strictlyQualified": True, "referenceClean": True, "physicalScreenClean": expected_pad == 0, "libraryRoutingFindings": library, "constructorPlusOfficialSolveMs": constructor + elapsed}
            if any(summary.get(k) != v for k,v in summary_pins.items()) or any(not re.fullmatch(r"[0-9a-f]{64}", str(summary.get(k))) for k in ["outputHash", "traceHash"]):
                raise ValueError("Completed screen record summaries were relabelled")
    if seen != wanted_keys:
        raise ValueError("Completed strict six-screen is incomplete")

def selected_numbers(dataset, population):
    if population != "full":
        raise ValueError("Only the complete original42 population is allowed")
    return TARGETS[dataset]


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


def verify_tiny_dependencies(manifest, checkouts):
    for arm, checkout in checkouts.items():
        wanted = manifest["tinyDependencyByArm"][arm]
        source = json.loads((checkout / "package.json").read_text())
        declarations = [source[section]["tiny-hypergraph"] for section in ["dependencies", "devDependencies", "optionalDependencies"] if "tiny-hypergraph" in source.get(section, {})]
        if declarations != [wanted["declaration"]]:
            raise ValueError("Source Tiny declaration differs: " + arm)
        provenance = json.loads((checkout / "experiment-dependencies-provenance.json").read_text())
        actual = provenance.get("directDependencies", {}).get("tiny-hypergraph", {})
        if any(actual.get(key) != wanted[key] for key in ["declaration", "installedSource"]):
            raise ValueError("Installed Tiny provenance differs: " + arm)
        root = checkout / "node_modules" / "tiny-hypergraph"
        for name, digest in wanted["sourceFileSha256"].items():
            if sha(root / name) != digest:
                raise ValueError("Installed Tiny source bytes differ: " + arm + "/" + name)


def run(args, manifest, experiment):
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError("Output must be new; attempts cannot be overwritten")
    checkouts = {"A": args.baseline.resolve(), "B": args.candidate.resolve()}
    verify_tiny_dependencies(manifest, checkouts)
    identities = {arm: pinned.read_identity(checkout, args.dataset) for arm, checkout in checkouts.items()}
    if args.population != "full": raise ValueError("Only all16 SRJ18 and all26 SRJ24 original samples are qualified here")
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
    parser.add_argument("--mode", choices=["plan", "select", "verify-checkouts", "verify-dependencies", "run"], required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--population", choices=["full"], default="full")
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
    elif args.mode == "verify-dependencies":
        verify_tiny_dependencies(manifest, {"A": args.baseline, "B": args.candidate})
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
