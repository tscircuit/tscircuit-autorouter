#!/usr/bin/env python3
"""Selected AB controls for legal anchors and adaptive coverage proofs."""
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
SPEC = importlib.util.spec_from_file_location("unchanged_full42_controller", ROOT / "run-retention-coalesced-model-only-full42.py")
core = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(core)
pinned = core.pinned
MAIN, MODULE, SOLVER, COUNTS = core.MAIN, core.MODULE, core.SOLVER, core.COUNTS
ORIGINAL_PASSING, ORIGINAL_FAILING = core.ORIGINAL_PASSING, core.ORIGINAL_FAILING
OPTIONS = {"cacheProvider": None, "effort": 1, "retainBestPartialRouting": False, "constrainViaPadPlacement": True}
COALESCED_SOURCE = "ee0dac23c8ff76fde81a0124bf444790a8394f25"
COALESCED_TREE = "c96942d07e4887d61759177e552c3d6733021c53"
ROLE_SOURCE_PINS = {'boundary-only': ('bd21dd642b4989b00e8279fae5c60cc7276ad642', 'a336ba7ec687e7813d97284faafd294a94e329eb'),
 'boundary-plus-anchor': ('08a3700fc0c63c81137439013e108196a9693b29', '8bb45629e6e62d66b5cc092fd4193d96b65603e4'),
 'boundary-plus-proof': ('215782e1c7daa71d886cc3da32b75a0ac6235e60', '59da05e8d8190fa73c555fc77a961ea136bb3731')}
VALIDATION_RECEIPTS = {'bd21dd642b4989b00e8279fae5c60cc7276ad642': 'c09890cf0a9dbc35178c85608f30153db41efe5b428426411247e23c60569edd',
 '08a3700fc0c63c81137439013e108196a9693b29': '0e06b79f39c79518288658f7884359dcd4898146156183acf3344672aa4760d1',
 '215782e1c7daa71d886cc3da32b75a0ac6235e60': '7db2fad20fd0a1a2fc81ab2e1e1761d0f1c5db14b7b5e350bc207b1027139fe4'}
AUTHENTICATED_NATIVE_INVENTORIES = {
    "10cdce5ad507adfaaec8ac32ea905ab02ffefa8a": ("2787d665688f00ddd47eaf01cd60d9242ce254cf", "e5ec49d79b9f105f32b79f043eca6ddbbe6ae6c1032243679d94370f78549f94"),
    "c6812cebd44b09f29f2fee929837b313b822f2ae": ("f4bbcefaa56635738561480b6eb949e67916a089", "330fac7c55f52c4edd89508d26deb33f61a814166946c8d9f4fd9daf44b8cc96"),
    "0acce21dc32a279788f88d884618630c82405590": ("862dc4a61b8ef3a0466614dbcd89a6b5d8d58833", "99b33e9228b5c91ce823c825e10bc6c19469b8c7e47fd2e74994cbabba49c40a"),
    "246176c5bc39bdb97c834f6bb4277ec4d101765d": ("ff1e7f654c06bd100411a67a0f442e0431ba2995", "1c42fdb4bc1700f107df8fb6ccadd0113e2f1a473eb07735949c47932681aebd"),
}
CAMPAIGNS = {'boundary-vs-legal-anchors': {'targets': {'srj18': [13, 15, 16], 'srj24': [12]},
                               'roles': {'A': 'boundary-only', 'B': 'boundary-plus-anchor'},
                               'records': 8,
                               'pr': 3348},
 'boundary-vs-adaptive-proof': {'targets': {'srj18': [6, 13, 14, 15, 16], 'srj24': [12]},
                                'roles': {'A': 'boundary-only', 'B': 'boundary-plus-proof'},
                                'records': 12,
                                'pr': 3349}}
TARGETS = None
evidence_paths, sha = core.evidence_paths, core.sha
verify_harnesses, checkpoint_audit = core.verify_harnesses, core.checkpoint_audit
ASSETS = core.ASSETS | {pathlib.Path(__file__).name}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def exact(value, wanted):
    return json.dumps(value, sort_keys=True, allow_nan=False) == json.dumps(wanted, sort_keys=True, allow_nan=False)


def hash_value(value, length=40):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{" + str(length) + "}", value) is not None


def receipt(envelope, status):
    require(isinstance(envelope, dict) and envelope.get("status") == status, "Required actual source receipt is pending or failed: " + status)
    text = envelope.get("evidenceFileText")
    require(isinstance(text, str) and hashlib.sha256(text.encode()).hexdigest() == envelope.get("evidenceFileSha256"), "Actual receipt bytes/digest missing")
    data = json.loads(text)
    require(isinstance(data, dict) and data.get("status") == status, "Receipt status differs from archived evidence")
    return data


def source_pins(manifest, arm):
    publication = manifest["baselinePublication"] if arm == "A" else manifest["candidatePublication"]
    tiny = manifest["tinyDependencyByArm"][arm]
    return {"sourceRemote": publication["publishedCommit"], "sourceLocal": publication["reviewedLocalCommit"],
        "sourceTree": publication["expectedTree"], "tinyRemote": tiny["remoteSha"], "tinyTree": tiny["tree"], "options": OPTIONS}


def validate_factory(manifest, arm, publication, config):
    proof = manifest.get("factoryParityByArm", {}).get(arm, {})
    require(proof.get("status") == "PASS_LOCAL_TINY_ACTUAL_ADAPTER_FACTORY_CONTROL", "Actual synthetic factory proof pending: " + arm)
    require(proof.get("sourceSha") == publication["reviewedLocalCommit"] and proof.get("sourceTree") == publication["expectedTree"], "Factory source/tree changed")
    names = ["experiment-audit-adapter.ts", "phase-checkpoint-observer.ts", "capture-terminal-failure-geometry.ts"]
    require(exact(proof.get("runtimeSourceHashes"), {n: manifest["runtimeSourceHashes"][n] for n in names}), "Factory helper source changed")
    for name in ["solverName", "solverModule", "options", "evidencePaths"]:
        require(exact(proof.get("config", {}).get(name), config.get(name)), "Factory constructor/module/config changed: " + name)
    actual = proof.get("actualTerminalEvidence", {})
    for name, expected in {"actualSolverName": SOLVER, "actualConstructorName": SOLVER, "solverModule": MODULE,
        "options": OPTIONS, "inputHash": proof.get("inputHash"), "inputMutated": False, "solverSolved": True, "solverFailed": False}.items():
        require(exact(actual.get(name), expected), "Factory actual terminal pin changed: " + name)
    require(hash_value(proof.get("inputHash"), 64) and hash_value(proof.get("outputHash"), 64), "Factory synthetic input/output hashes missing")
    observed = actual.get("evidence", {})
    paths = evidence_paths("retention")
    require(all(p in observed for p in paths) and observed[paths[0]] is False and observed[paths[2]] is None and type(observed[paths[3]]) is int and observed[paths[3]] == 2, "Factory live guard/retention wiring missing")
    text = proof.get("evidenceFileText")
    require(isinstance(text, str) and hashlib.sha256(text.encode()).hexdigest() == proof.get("evidenceFileSha256"), "Factory exact receipt bytes missing")
    archived = json.loads(text)
    for name in ["status", "sourceSha", "sourceTree", "runtimeSourceHashes", "config", "inputHash", "outputHash", "iterations", "maxIterations", "checkpointRows"]:
        require(exact(archived.get(name), proof.get(name)), "Factory archived summary differs: " + name)
    require(exact(archived.get("evidence"), actual), "Factory actual terminal receipt differs")


def validate_anchor_or_proof_qualification(manifest, arm, gate, pins):
    require(gate.get("status") == "PASS_PUBLISHED_SOURCE_QUALIFICATION_RECEIPT", "Actual published source qualification is pending")
    text = gate.get("evidenceFileText")
    require(isinstance(text, str) and hashlib.sha256(text.encode()).hexdigest() == gate.get("evidenceFileSha256") == VALIDATION_RECEIPTS[pins["sourceRemote"]], "Exact reviewed anchor/proof qualification bytes differ")
    data = json.loads(text)
    if pins["sourceRemote"] == "08a3700fc0c63c81137439013e108196a9693b29":
        require(data.get("sourceCommit") == pins["sourceLocal"] and data.get("sourceTree") == pins["sourceTree"], "Anchor qualification source differs")
        checks = data.get("checks", {})
        focused = checks.get("boundaryAndAnchorFocusedTests", {})
        require(exact({k: focused.get(k) for k in ["passed", "failed", "assertions"]}, {"passed": 44, "failed": 0, "assertions": 456}), "Actual anchor44/456 focused receipt differs")
        require(type(checks.get("fullCallerProjectTypesExitCode")) is int and checks["fullCallerProjectTypesExitCode"] == 0 and all(checks.get(k) is True for k in ["fullBuild", "workerBundles", "esm", "declarations", "cleanCommittedWorktree"]), "Actual anchor full types/build failed")
        require(isinstance(checks.get("independentReview"), str) and "no source blockers" in checks["independentReview"], "Actual anchor source review missing")
        require(data.get("invariants") and all(v is True for v in data["invariants"].values()), "Actual anchor default/budget/owner/world-coordinate invariants failed")
        node = data.get("initialNode13", {})
        require(node.get("baseline", {}).get("failed") is True and node.get("candidate", {}).get("solved") is True and node.get("candidate", {}).get("failed") is False and node.get("originalPadAndBoardCallbackAcceptsOutput") is True and node.get("rawInputNodeUnchanged") is True, "Actual initial-node13 functional proof missing")
        require("Initial regular node only" in node.get("limitation", ""), "Initial-node13 scope must not become a whole-sample success claim")
        setup = data.get("fullTypesDependencyAndSparseSetup", {})
        require(setup.get("tinyDeclaredRemotePin") == pins["tinyRemote"] and setup.get("tinyTree") == pins["tinyTree"] and setup.get("a01DeclaredPinUnchanged") == "10cdce5ad507adfaaec8ac32ea905ab02ffefa8a", "Actual anchor validation dependency pins differ")
    else:
        require(data.get("status") == "PASS_LOCAL_TYPES_BUILD_REVIEW_AND_BOUNDED_HD0_AWAITING_BLACKSMITH" and data.get("localSource") == pins["sourceLocal"] and data.get("tree") == pins["sourceTree"], "Adaptive proof qualification source differs")
        require(exact(data.get("tests"), 41) and exact(data.get("assertions"), 516) and data.get("fullCallerTypes") == "PASS" and data.get("workerEsmDtsBuild") == "PASS" and data.get("independentReview") == "NO_SOURCE_BLOCKERS", "Actual proof41/516/fulltypes/build/review failed")
        require(exact(data.get("proofBudgets"), {"cells": 128, "depth": 8, "padToleranceMm": 0.005}) and data.get("oldGenericCertificatesLostOnThoseFourSnapshots") == 0 and data.get("wholeBoardSolvesPerformed") is False and data.get("optimizationClaimed") is False, "Positive-proof budget or bounded scope differs")
        rows = data.get("boundedHd0", [])
        require(len(rows) == 5, "All five actual source bounded controls must remain explicit")
        observed = set()
        for item in rows:
            row = item.get("summary", {})
            dataset, sample = row.get("dataset", "srj18"), row.get("sample")
            require(type(sample) is int and dataset in COUNTS, "Bounded proof input identity type differs")
            observed.add((dataset, sample))
            expected = {"sourceSha": pins["sourceLocal"], "sourceTree": pins["sourceTree"], "tinyTree": pins["tinyTree"],
                "inputSha256": manifest["expectedInputHashesByDataset"][dataset][str(sample)], "phase": "highDensityRouteSolver",
                "retainOption": False, "retainFlag": False, "guard": True, "constrainFlag": True, "failed": False, "error": None,
                "externalCutoffReached": False, "hdContextPresent": True, "hdIterations": 0, "coarseSolved": True, "coarseFailed": False,
                "coarseMAXIterations": 2000000, "forbiddenLayerChanges": 0, "forbiddenPhysicalCrossings": 0,
                "exactPerLayerWorldGeometryMetadataCoveragePreserved": True, "retiredNodeIdsMustBeMappedNotTreatedAsRecovered": True}
            require(all(exact(row.get(k), v) for k, v in expected.items()), "Actual bounded proof source/options/input/geometry pin differs")
            require(hash_value(row.get("hdContextSha256"), 64) and hash_value(row.get("geometryPerLayerMetadataMultisetBeforeSha256"), 64) and row["geometryPerLayerMetadataMultisetBeforeSha256"] == row.get("geometryPerLayerMetadataMultisetAfterSha256"), "Actual bounded geometry/context bytes differ")
        require(observed == {("srj18", 6), ("srj18", 13), ("srj18", 14), ("srj18", 15), ("srj24", 12)} and data.get("14And24_12ContextsByteIdentical") is True, "Actual five-control proof identities or duplicate context disclosure differ")


def validate_source_qualification(manifest, arm):
    gate = manifest.get("sourceQualificationByArm", {}).get(arm, {})
    pins = source_pins(manifest, arm)
    if pins["sourceRemote"] in {"08a3700fc0c63c81137439013e108196a9693b29", "215782e1c7daa71d886cc3da32b75a0ac6235e60"}:
        validate_anchor_or_proof_qualification(manifest, arm, gate, pins)
        return
    data = receipt(gate, gate.get("status"))
    require(gate.get("evidenceFileSha256") == VALIDATION_RECEIPTS.get(pins["sourceRemote"]), "Unreviewed validation receipt bytes/source")
    if pins["sourceRemote"] == COALESCED_SOURCE:
        require(data.get("status") == "PASS_LOCAL_VALIDATION_WITH_MIXED_FUNCTIONAL_PREFIX_OUTCOMES" and data.get("sourceLocal") == pins["sourceLocal"] and data.get("sourceTree") == pins["sourceTree"], "Original ee0 validation source differs")
        require(data.get("tests", {}).get("status") == "PASS" and data.get("typecheck", {}).get("exitCode") == 0 and data.get("build", {}).get("exitCode") == 0, "Original ee0 focused/types/fullbuild failed")
        require(data.get("tinyRemote") == pins["tinyRemote"] and data.get("tinyTree") == pins["tinyTree"], "Original validation Tiny differs")
    elif pins["sourceRemote"] == "bd21dd642b4989b00e8279fae5c60cc7276ad642":
        require(data.get("status") == "PASS_LOCAL_VALIDATION_AND_INDEPENDENT_REVIEW_AWAITING_BLACKSMITH_SAMPLE16" and data.get("localCommit") == pins["sourceLocal"] and data.get("tree") == pins["sourceTree"], "Boundary validation source differs")
        validation = data.get("validation", {})
        require(validation.get("focusedTests") == 37 and validation.get("assertions") == 418 and validation.get("status") == "PASS" and validation.get("fullProjectTypes") == "PASS" and validation.get("workerEsmDtsBuild") == "PASS", "Actual boundary37/418/fulltypes/fullbuild receipt failed")
        require(data.get("independentReview", {}).get("status") == "PASS_NO_BLOCKERS" and data["independentReview"].get("syntheticCheckerDisagreements") == 0, "Actual boundary independent review failed")
        require("highDensityRouteSolver constructor with 0 HD iterations" in data.get("boundedPipelineFunctionalTest", "") and data.get("wholeBoardRoutingPerformed") is False, "Synthetic original/mutable-board HD0 wiring proof missing or mislabeled as wholeboard")
    elif pins["sourceRemote"] == "5f8aa035b8aa997d72627b9bede72524bb182e5b":
        require(data.get("status") == "PASS_LOCAL_VALIDATION_AND_INDEPENDENT_ROOT_REVIEW" and data.get("localCommit") == pins["sourceLocal"] and data.get("tree") == pins["sourceTree"], "Combined caller validation source differs")
        validation = data.get("validation", {})
        require(validation.get("callerFocusedTests") == 39 and validation.get("callerAssertions") == 468 and validation.get("upstreamFocusedTests") == 5 and validation.get("upstreamAssertions") == 144, "Actual native focused test receipt differs")
        require(type(validation.get("fullCallerProjectTypesExitCode")) is int and validation["fullCallerProjectTypesExitCode"] == 0 and type(validation.get("workerEsmDtsBuildExitCode")) is int and validation["workerEsmDtsBuildExitCode"] == 0, "Actual native full types/build failed")
        require(validation.get("defaultOffParity", "").startswith("PASS;") and validation.get("actualBoardNativeComposition", "").startswith("PASS;"), "Actual default-off/generation/composition proof missing")
        upstream = data.get("upstream", {})
        require(upstream.get("remote") == "246176c5bc39bdb97c834f6bb4277ec4d101765d" and upstream.get("exactPrivateTree") == "ff1e7f654c06bd100411a67a0f442e0431ba2995" and upstream.get("a13Unchanged") == "c6812cebd44b09f29f2fee929837b313b822f2ae", "Actual native API dependency source differs")
        rows = validation.get("compositionCounts", [])
        require(len(rows) == 2 and {row.get("family") for row in rows} == {"HIGH_DENSITY_A01", "HIGH_DENSITY_A03"} and all(row.get("finalEndpointAcceptance") is True and type(row.get("queryCount")) is int and row["queryCount"] > 0 and type(row.get("rejectedCount")) is int and row["rejectedCount"] > 0 for row in rows), "Actual synthetic native generation/endpoints composition failed")
        require(data.get("independentReview", {}).get("status") == "PASS_NO_SOURCE_BLOCKERS" and data.get("noWholeBoardRouting") is True and data.get("noLocalBenchmark") is True, "Actual native source review or scope differs")
    else:
        raise ValueError("HELD: new source actual build/test/types/wiring receipt schema and authoritative pins require materialization")


def validate_manifest(path):
    global TARGETS
    manifest = json.loads(pathlib.Path(path).read_text())
    require(manifest.get("activationStatus") == "READY_EXACT_SOURCE_PROOFS_REVIEWED", "HELD: exact remote sources, full build/tests/types, actual factory and bounded geometry receipts are pending")
    campaign = CAMPAIGNS.get(manifest.get("campaign"))
    require(campaign is not None, "Unknown controlled campaign")
    require(exact(manifest.get("targetedSampleNumbers"), campaign["targets"]) and exact(manifest.get("sourceRolesByArm"), campaign["roles"]), "Exact selected population/source roles changed")
    TARGETS = campaign["targets"]
    require(exact(manifest.get("datasets"), COUNTS) and manifest.get("harnessSha") == MAIN and manifest.get("runPrNumbers") == [campaign["pr"]], "Original populations/harness/declared experiment PR changed")
    require(exact(manifest.get("originalPassingSampleNumbers"), ORIGINAL_PASSING) and exact(manifest.get("originalFailingSampleNumbers"), ORIGINAL_FAILING), "Original33/9 identities changed")
    require(manifest.get("plannedRecordCount") == campaign["records"] and manifest.get("plannedExecutionOrders") == ["AB"] and manifest.get("noRegressionReleaseEligible") is False, "Only initial declared AB controls are authorized here")
    expected_protocol = {"sampleTimeoutSeconds": 360, "firstRound": ["A", "B"], "optionalSecondRound": ["B", "A"], "optionalRepeatBeforeSeconds": 0, "jobBudgetSeconds": 19800, "allowedExecutionOrders": ["AB"]}
    require(all(exact(manifest.get(k), v) for k, v in expected_protocol.items()), "Original effort1/thread1/fresh/360s protocol changed")
    require(len(manifest.get("experiments", [])) == 1, "One exact candidate is required")
    experiment = manifest["experiments"][0]
    require(experiment.get("pr") == campaign["pr"], "Unexpected experiment PR")
    for arm, publication, config, source in [("A", manifest["baselinePublication"], manifest["baseline"], manifest["baselineSha"]), ("B", manifest["candidatePublication"], experiment, experiment["candidateSha"])]:
        require(publication.get("status") == "PUBLISHED_EXACT_TREE_REVIEWED" and publication.get("publishedCommit") == source and all(hash_value(publication.get(k)) for k in ["publishedCommit", "reviewedLocalCommit", "expectedTree"]), "Pending or mismatched source publication: " + arm)
        approved = ROLE_SOURCE_PINS[campaign["roles"][arm]]
        require(approved is not None and (source, publication["expectedTree"]) == approved, "HELD or different authoritative role source/tree: " + arm)
        if campaign["roles"][arm] == "coalesced-model":
            require(source == COALESCED_SOURCE and publication["expectedTree"] == COALESCED_TREE, "Original ee0 comparison source changed")
        require(config.get("solverName") == SOLVER and config.get("solverModule") == MODULE and exact(config.get("options"), OPTIONS) and exact(config.get("evidencePaths"), evidence_paths("retention")) and config.get("phaseCheckpointTarget") is None, "Exact actual constructor/options changed")
        tiny = manifest["tinyDependencyByArm"][arm]
        require(hash_value(tiny.get("remoteSha")) and hash_value(tiny.get("tree")) and tiny.get("declaration") == "git+https://github.com/tscircuit/tiny-hypergraph.git#" + tiny["remoteSha"] and tiny.get("installedSource") == "https://codeload.github.com/tscircuit/tiny-hypergraph/tar.gz/" + tiny["remoteSha"], "Exact installed Tiny source pin missing")
        inventory = tiny.get("sourceFileSha256")
        require(isinstance(inventory, dict) and "lib/core.ts" in inventory and "package.json" in inventory and all(hash_value(v, 64) for v in inventory.values()), "Full Tiny source byte inventory missing")
        validate_source_qualification(manifest, arm)
        validate_factory(manifest, arm, publication, config)
        # Original ee0 real-board prefix evidence and the new boundary synthetic
        # board handoff have different scopes. Whole-board15/16 success is the
        # purpose of this initial experiment, never a circular launch gate.
    require(manifest.get("baselineTree") == manifest["baselinePublication"]["expectedTree"], "Baseline tree differs")
    for dataset, count in COUNTS.items():
        require(set(manifest.get("expectedInputHashesByDataset", {}).get(dataset, {})) == {str(n) for n in range(1, count + 1)} and all(hash_value(v, 64) for v in manifest["expectedInputHashesByDataset"][dataset].values()), "All42 original immutable input hashes are required")
    core.validate_original_input_metadata(manifest)
    require(set(manifest.get("runtimeSourceHashes", {})) == ASSETS, "Exact unchanged helper/shared-controller source inventory required")
    require(all(sha(ROOT / name) == value for name, value in manifest["runtimeSourceHashes"].items()), "Runtime/helper source bytes differ")
    base_path = ROOT / "strongest-refinement-main-vs-coalesced-model-only-full42.json"
    require(sha(base_path) == "feb8cc4621e69491ae025912dbc75f3dd2136e45627c99c7223ec715fac0cdef", "Original frozen controller reference manifest changed")
    base = json.loads(base_path.read_text())
    for field in ["expectedHarnessSourceHashes", "expectedValidatorHashes", "runSampleSourceSha256"]:
        require(exact(manifest.get(field), base[field]), "Original harness/5validators/run_sample pin changed: " + field)
    require(all(manifest["runtimeSourceHashes"].get(k) == v for k, v in base["runtimeSourceHashes"].items()), "Original9 helpers/shared controller changed")
    require(all(exact(manifest["tinyDependencyByArm"][arm], base["tinyDependencyByArm"]["B"]) for arm in ["A", "B"]), "Authoritative Tiny7175 complete source inventory changed; any future delta requires explicit requalification")
    validate_native_dependency_policy(manifest)
    require(hashlib.sha256(inspect.getsource(pinned.run_sample).encode()).hexdigest() == manifest.get("runSampleSourceSha256"), "Original fresh run_sample changed")
    if manifest["campaign"] == "boundary-vs-boundary-native":
        require(manifest.get("nativeFunctionalQualificationPolicy") == "REVIEWED_SOURCE_SYNTHETIC_API_GENERATION_DEFAULT_OFF_AND_COMPOSITION_CONTROLS;ACTUAL_6_13_WHOLEBOARD_SUCCESS_IS_MEASURED_NOT_ASSUMED", "Native scientific control scope changed")
    return manifest, experiment


def selected_numbers(dataset, population):
    require(population == "screen" and TARGETS is not None and dataset in COUNTS, "Only the exact validated selected screen is allowed")
    return TARGETS[dataset]


def preflight(manifest, dataset, identities, population):
    require(identities["A"] == identities["B"] and [r["sampleNumber"] for r in identities["A"]] == list(range(1, COUNTS[dataset] + 1)), "Both sources must expose original complete population in original order")
    require({str(r["sampleNumber"]): r["inputHash"] for r in identities["A"]} == manifest["expectedInputHashesByDataset"][dataset], "Original input hash population differs")
    return [r for r in identities["A"] if r["sampleNumber"] in selected_numbers(dataset, population)]


def validate_native_dependency_policy(manifest):
    original = manifest.get("originalEe0DependencySections")
    require(isinstance(original, dict) and hashlib.sha256(json.dumps(original, sort_keys=True, separators=(",", ":")).encode()).hexdigest() == "c1d9b279e6a8cbbcaaa15e2b5ea4bc0c1479346be405977c55e8c28e4f1c4940", "Original ee0 full dependency declarations changed")
    for arm in ["A", "B"]:
        expected_sections = json.loads(json.dumps(original))
        packages = manifest.get("nativeDependencyByArm", {}).get(arm, {})
        require(set(packages) == {"@tscircuit/high-density-a01", "@tscircuit/high-density-a13", "@tscircuit/high-density-b01"}, "All three native packages must be pinned per arm")
        role = CAMPAIGNS[manifest["campaign"]]["roles"][arm]
        commits = {"@tscircuit/high-density-a01": "246176c5bc39bdb97c834f6bb4277ec4d101765d" if role == "boundary-plus-native" else "10cdce5ad507adfaaec8ac32ea905ab02ffefa8a", "@tscircuit/high-density-a13": "c6812cebd44b09f29f2fee929837b313b822f2ae", "@tscircuit/high-density-b01": "0acce21dc32a279788f88d884618630c82405590"}
        for name, package in packages.items():
            repository = "high-density-b01" if name.endswith("b01") else "high-density-a01"
            remote = commits[name]
            declaration = f"git+https://github.com/tscircuit/{repository}.git#{remote}"
            installed = f"https://codeload.github.com/tscircuit/{repository}/tar.gz/{remote}"
            require(package.get("remoteSha") == remote and package.get("declaration") == declaration and package.get("installedSource") == installed, "Unapproved native source/alias declaration: " + arm + "/" + name)
            require(package.get("inventoryScope") == "ALL_INSTALLED_FILES_EXCLUDING_NESTED_NODE_MODULES_AND_DOTGIT" and package.get("commitArchiveAuthentication") == "PASS_EXACT_PUBLIC_COMMIT_ARCHIVE_FILE_BYTES", "Native inventory is not authenticated to exact public Git archive")
            files = package.get("sourceFileSha256")
            require(isinstance(files, dict) and "package.json" in files and any(n.endswith(".ts") for n in files) and all(hash_value(v, 64) for v in files.values()), "Complete authenticated native runtime-source inventory missing")
            authenticated = AUTHENTICATED_NATIVE_INVENTORIES.get(remote)
            require(authenticated is not None and package.get("tree") == authenticated[0] and hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest() == authenticated[1], "Native source inventory is not the exact authenticated public commit tree")
            for section in expected_sections:
                if name in expected_sections[section]: expected_sections[section][name] = declaration
        for section in expected_sections:
            if "tiny-hypergraph" in expected_sections[section]: expected_sections[section]["tiny-hypergraph"] = manifest["tinyDependencyByArm"][arm]["declaration"]
        require(exact(manifest.get("expectedSourceDependencySectionsByArm", {}).get(arm), expected_sections), "Unrelated source dependency declarations changed")


def installed_file_inventory(root):
    return {str(path.relative_to(root)): sha(path) for path in sorted(root.rglob("*")) if path.is_file() and not ({"node_modules", ".git"} & set(path.relative_to(root).parts))}


def verify_tiny_dependencies(manifest, checkouts):
    core.verify_tiny_dependencies(manifest, checkouts)
    for arm, checkout in checkouts.items():
        source_bytes = (checkout / "package.json").read_bytes()
        source = json.loads(source_bytes)
        sections = {name: source.get(name, {}) for name in ["dependencies", "devDependencies", "optionalDependencies"]}
        require(exact(sections, manifest["expectedSourceDependencySectionsByArm"][arm]), "Actual source dependency sections differ: " + arm)
        provenance = json.loads((checkout / "experiment-dependencies-provenance.json").read_text())
        require(provenance.get("sourcePackageJsonSha256") == hashlib.sha256(source_bytes).hexdigest(), "Installed dependency source package provenance differs")
        for name, package in manifest["nativeDependencyByArm"][arm].items():
            declarations = [sections[s][name] for s in sections if name in sections[s]]
            require(declarations == [package["declaration"]], "Native declaration appears differently across3 sections")
            actual = provenance.get("directDependencies", {}).get(name, {})
            require(all(actual.get(k) == package[k] for k in ["declaration", "installedSource"]), "Installed native commit provenance differs: " + arm + "/" + name)
            require(exact(installed_file_inventory(checkout / "node_modules" / name), package["sourceFileSha256"]), "Installed complete native source file set/bytes differs: " + arm + "/" + name)


def compare_harness_dependencies(manifest, harnesses):
    compared = pinned.compare_dependency_resolutions(harnesses)
    allowed = [name for name in ["tiny-hypergraph", "@tscircuit/high-density-a01"] if (manifest["tinyDependencyByArm"]["A"]["declaration"] != manifest["tinyDependencyByArm"]["B"]["declaration"] if name == "tiny-hypergraph" else manifest["nativeDependencyByArm"]["A"][name]["declaration"] != manifest["nativeDependencyByArm"]["B"][name]["declaration"])]
    require(compared["changedDirectDependencyDeclarations"] == sorted(allowed), "Unrelated installed direct dependency changes are forbidden")
    return {**compared, "explicitAllowedDirectSourceChanges": sorted(allowed), "nativeSourceBytesIndependentlyVerified": True}


def reference_clean(record):
    return pinned.is_clean(record) and not record.get("supplementalValidationError") and (record.get("supplemental") or {}).get("referenceFullCopperChecks", {}).get("count") == 0


def physical_clean(record):
    checks = record.get("supplemental") or {}
    return reference_clean(record) and all(checks.get(name, {}).get("count") == 0 for name in ["inputOnlyPhysicalChecks", "boardCopperChecks", "viaBoardChecks"]) and checks.get("libraryRoutingChecks", {}).get("byType", {}).get("pcb_pad_pad_clearance_error", 0) == 0


def summary(records, dataset, population, order="AB"):
    value = _legacy_summary(records, dataset, population, order)
    clean = {arm: {r["sampleNumber"] for r in records if r["arm"] == arm and physical_clean(r)} for arm in ["A", "B"]}
    reference = {arm: {r["sampleNumber"] for r in records if r["arm"] == arm and reference_clean(r)} for arm in ["A", "B"]}
    paired = {r["sampleNumber"] for r in records if sum(q["sampleNumber"] == r["sampleNumber"] for q in records) == 2}
    value.update(physicalScreenCleanIdentitiesByArm={a: sorted(clean[a]) for a in ["A", "B"]},
        referenceCleanIdentitiesByArm={a: sorted(reference[a]) for a in ["A", "B"]},
        physicalScreenIdentitiesLost=sorted((clean["A"] - clean["B"]) & paired), physicalScreenIdentitiesGained=sorted((clean["B"] - clean["A"]) & paired),
        referenceIdentitiesLost=sorted((reference["A"] - reference["B"]) & paired), referenceIdentitiesGained=sorted((reference["B"] - reference["A"]) & paired),
        primaryTimingPolicy="Constructor plus official solve only for strictly qualified mutually physical-screen-clean pairs, computed by offline strict parser. Legacy official-only summary timings are diagnostic; failed/invalid attempts never support an optimization.")
    return value


def _legacy_summary(records, dataset, mode, order="AB"):
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
    verify_tiny_dependencies(manifest, checkouts)
    identities = {arm: pinned.read_identity(checkout, args.dataset) for arm, checkout in checkouts.items()}
    if args.population != "screen" or args.order != "AB": raise ValueError("Only the exact initial selected AB experiment is allowed")
    selected = preflight(manifest, args.dataset, identities, args.population)
    harnesses = {a: json.loads((c / "experiment-harness-provenance.json").read_text()) for a, c in checkouts.items()}
    verify_harnesses(manifest, experiment, harnesses)
    dependencies = compare_harness_dependencies(manifest, harnesses)
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
    parser.add_argument("--population", choices=["screen"], default="screen")
    parser.add_argument("--order", choices=["AB"], default="AB")
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
            wanted_tree = (manifest["baselinePublication"] if arm == "A" else manifest["candidatePublication"])["expectedTree"]
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
