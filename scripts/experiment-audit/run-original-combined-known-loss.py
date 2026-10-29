#!/usr/bin/env python3
"""HELD original637 versus final combined source on seven known-loss controls."""
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
BASELINE_OPTIONS = {"cacheProvider": None, "effort": 1}
CANDIDATE_OPTIONS = {"cacheProvider": None, "effort": 1, "retainBestPartialRouting": False, "constrainViaPadPlacement": True}
APPROVED_NEXT6_ACTIVATION = {'ledgerSha256': 'd04619e02f3a2079edd92cf6b73d90d7c020ec225a52142bc1b5f4a243b2a16d',
 'runId': '40817511880',
 'controllerSha': '39e4b5a2ee36515219fa694a0ae74a2263f28faf',
 'controllerTree': '69715eefb35768720afba9870fa462f1d1518063',
 'campaign': 'boundary-vs-board-acceptance-fix',
 'candidateSource': '4ba67e225cf566ce89124b4b0e959294425f7820',
 'candidateTree': '7d3d6dee6659e024e1d019aad70ee119c94a00c4',
 'parsedByDataset': {'srj18': {'sha256': '2737fdb344f086a6101fa821372ca049699c167d428d3d7d8d6dc3838030ac1c',
                               'jobId': '123262039429'},
                     'srj24': {'sha256': '4b01ba3f5d8d9380a5ae751ad0c94aa39048e60a53411d0350139e811da0d641',
                               'jobId': '123262039379'}}}
APPROVED_CANDIDATE_QA = {'receiptSha256': '783440f4cf7c26aaddb0caf61dc949512c7016790a48f49311038e38de2c13fe',
 'localSourceKey': 'localCommit',
 'sourceTreeKey': 'tree',
 'independentReviewSha256': '6fe402f267c41ca2ccb1f757ed154a54cc85854c5f2269b3a2361a471ce178ef',
 'requiredEvidenceByKind': {'fullTypes': {'path': ['validation', 'fullCallerProjectTypesExitCode'], 'expected': 0},
                            'fullBuild': {'path': ['validation', 'serializedWorkerEsmDtsBuildExitCode'],
                                          'expected': 0},
                            'focusedTests': {'path': ['validation', 'callerFocusedTests'], 'expected': 60},
                            'assertions': {'path': ['validation', 'assertions'], 'expected': 730},
                            'focusedExit': {'path': ['validation', 'testExitCode'], 'expected': 0},
                            'exactStandaloneBytes': {'path': ['validation',
                                                              'exactChangedFileBytesMatchStandalone15Files'],
                                                     'expected': True},
                            'noHarnessEdits': {'path': ['validation', 'baselineValidatorAndHarnessEdits'],
                                               'expected': 0},
                            'noBudgetFallbackChanges': {'path': ['validation',
                                                                 'budgetFormulaOrderOrFallbackChanges'],
                                                        'expected': 0},
                            'noLocalBoards': {'path': ['validation', 'localBoardRoutingOrBenchmarks'],
                                              'expected': 0}}}
COALESCED_SOURCE = "ee0dac23c8ff76fde81a0124bf444790a8394f25"
COALESCED_TREE = "c96942d07e4887d61759177e552c3d6733021c53"
ROLE_SOURCE_PINS = {'original637': ('637b6c581128238f6c61227a1c15be423d24baca', '4848273d65b54a17d1d3cf7d779127756f446d73'),
 'combined-plus-acceptance-fix': ('b12fa8483606b35fa072898eb46edc4978e8f817',
                                  '6a7a272fc8e853685fd1d88e418eb4e66e4f7240')}
VALIDATION_RECEIPTS = {
    COALESCED_SOURCE: "7d6cf76d89a7a491883d153aada1afa298aeacb9e8505264d3db16620697433a",
    "bd21dd642b4989b00e8279fae5c60cc7276ad642": "c09890cf0a9dbc35178c85608f30153db41efe5b428426411247e23c60569edd",
    "5f8aa035b8aa997d72627b9bede72524bb182e5b": "3261620dc2be66c453d8484fd457d8f57d94be91db7ab43130664c44a9ba47eb",
}
AUTHENTICATED_NATIVE_INVENTORIES = {
    "10cdce5ad507adfaaec8ac32ea905ab02ffefa8a": ("2787d665688f00ddd47eaf01cd60d9242ce254cf", "e5ec49d79b9f105f32b79f043eca6ddbbe6ae6c1032243679d94370f78549f94"),
    "c6812cebd44b09f29f2fee929837b313b822f2ae": ("f4bbcefaa56635738561480b6eb949e67916a089", "330fac7c55f52c4edd89508d26deb33f61a814166946c8d9f4fd9daf44b8cc96"),
    "0acce21dc32a279788f88d884618630c82405590": ("862dc4a61b8ef3a0466614dbcd89a6b5d8d58833", "99b33e9228b5c91ce823c825e10bc6c19469b8c7e47fd2e74994cbabba49c40a"),
    "246176c5bc39bdb97c834f6bb4277ec4d101765d": ("ff1e7f654c06bd100411a67a0f442e0431ba2995", "1c42fdb4bc1700f107df8fb6ccadd0113e2f1a473eb07735949c47932681aebd"),
}
CAMPAIGNS = {'original-vs-combined-known-loss': {'targets': {'srj18': [6, 13, 15, 16], 'srj24': [12, 15, 20]},
                                     'roles': {'A': 'original637', 'B': 'combined-plus-acceptance-fix'},
                                     'records': 14,
                                     'pr': 3338}}
TARGETS = None
sha = core.sha
JOINT_ACTIVATION_PATH = "pipeline9JointDrcRepairSolver.params.checkOriginalViaPlacement"


def evidence_paths(family):
    paths = list(core.evidence_paths(family))
    if family == "retention":
        paths[1] = JOINT_ACTIVATION_PATH
    return paths
verify_harnesses, checkpoint_audit = core.verify_harnesses, core.checkpoint_audit
ASSETS = core.ASSETS | {pathlib.Path(__file__).name}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def exact(value, wanted):
    return json.dumps(value, sort_keys=True, allow_nan=False) == json.dumps(wanted, sort_keys=True, allow_nan=False)


def hash_value(value, length=40):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{" + str(length) + "}", value) is not None


def original_reference_manifest():
    path = ROOT / "strongest-refinement-main-vs-coalesced-model-only-full42.json"
    require(sha(path) == "feb8cc4621e69491ae025912dbc75f3dd2136e45627c99c7223ec715fac0cdef", "Frozen original full42 baseline reference bytes changed")
    return json.loads(path.read_text())


def validate_original_baseline(manifest):
    base = original_reference_manifest()
    for key in ["baselineSha", "baselineTree", "baselinePublication"]:
        require(exact(manifest.get(key), base[key]), "Original637 baseline source/default options were replaced: " + key)
    expected_config = dict(base["baseline"], evidencePaths=evidence_paths("retention"))
    require(exact(manifest.get("baseline"), expected_config), "Original637 constructor/default options or new four-path observer configuration changed")
    require(exact(manifest.get("tinyDependencyByArm", {}).get("A"), base["tinyDependencyByArm"]["A"]), "Original637 must use original Tinyec80 complete52-file source inventory")
    require(exact(manifest.get("frozenOriginalBaselineFactoryAuthority"), base["factoryParityByArm"]["A"]), "Frozen original637 factory authority was relabelled")
    fresh = manifest.get("factoryParityByArm", {}).get("A", {})
    require(fresh.get("sourceSha") == base["baselineSha"] and fresh.get("sourceTree") == base["baselineTree"] and exact(fresh.get("config", {}).get("options"), BASELINE_OPTIONS) and fresh.get("config", {}).get("evidencePaths") == evidence_paths("retention"), "Fresh original637 four-path factory source/options differ")
    sections = manifest.get("original637DependencySections")
    require(isinstance(sections, dict) and hashlib.sha256(json.dumps(sections, sort_keys=True, separators=(",", ":")).encode()).hexdigest() == "f499085fae1b5fea66bb7c7b61bb663759213cde4931c53767690be8429cb84c" and exact(manifest.get("expectedSourceDependencySectionsByArm", {}).get("A"), sections), "Original637 complete source package sections changed")
    proof = manifest["factoryParityByArm"]["A"]["actualTerminalEvidence"]["evidence"]
    paths = evidence_paths("retention")
    require(all(path in proof for path in paths) and proof[paths[0]] is None and proof[paths[1]] is None and proof[paths[2]] is None and proof[paths[3]] is None, "Original637 actual absent flag/guard evidence must remain explicit null")


def validate_per_arm_tiny_policy(manifest, base):
    require(exact(manifest["tinyDependencyByArm"]["A"], base["tinyDependencyByArm"]["A"]), "Original baseline Tinyec80 inventory changed")
    approved = manifest.get("approvedTinyRemoteByArm", {}).get("B")
    available = {base["tinyDependencyByArm"][arm]["remoteSha"]: base["tinyDependencyByArm"][arm] for arm in ["A", "B"]}
    require(approved in available and exact(manifest["tinyDependencyByArm"]["B"], available[approved]), "HELD: final combined-source actual Tiny pin/inventory is not root-approved")


def validate_next6_gate(manifest):
    """A separate board-fix6 result qualifies its B controls, never this B14."""
    approved = APPROVED_NEXT6_ACTIVATION
    require(isinstance(approved, dict) and hash_value(approved.get("ledgerSha256"), 64), "HELD: actual next6 clean source/ledger/run/controller pins are pending")
    gate = manifest.get("next6ActivationGate", {})
    raw = gate.get("ledgerEvidenceText")
    require(gate.get("status") == "PASS_ACTUAL_NEXT6_B15_CAMERA_CLEAN_B16_CLEAN_OR_NAMED_JOINT_FAILURE" and isinstance(raw, str) and hashlib.sha256(raw.encode()).hexdigest() == gate.get("ledgerEvidenceSha256") == approved["ledgerSha256"], "Actual next6 ledger bytes are missing or different")
    ledger = json.loads(raw)
    require(str(ledger.get("runId")) == str(approved["runId"]) and ledger.get("controllerSha") == approved["controllerSha"] and ledger.get("order") == "AB", "Actual next6 run/controller/order differs")
    evidence = gate.get("parsedEvidenceByDataset", {})
    require(set(evidence) == {"srj18", "srj24"}, "Both actual next6 parsed datasets are required")
    observer = manifest["runtimeSourceHashes"]["phase-checkpoint-observer.ts"]
    for dataset, samples in {"srj18": [15, 16], "srj24": [12]}.items():
        expected = approved["parsedByDataset"][dataset]
        text = evidence[dataset].get("evidenceFileText")
        require(isinstance(text, str) and hashlib.sha256(text.encode()).hexdigest() == evidence[dataset].get("evidenceFileSha256") == expected["sha256"], "Actual next6 parsed evidence bytes differ")
        parsed = json.loads(text)
        headers = {"campaign": approved["campaign"], "qualificationMode": "screen", "executionOrder": "AB", "dataset": dataset,
            "runId": str(approved["runId"]), "jobId": str(expected["jobId"]), "controllerSha": approved["controllerSha"],
            "baselineSha": "bd21dd642b4989b00e8279fae5c60cc7276ad642", "candidateSha": approved["candidateSource"],
            "options": {"A": CANDIDATE_OPTIONS, "B": CANDIDATE_OPTIONS}, "selectedSampleNumbers": samples,
            "observedRecordCount": len(samples) * 2, "expectedRecordCount": len(samples) * 2,
            "strictlyQualified": True, "populationComplete": True, "hardIntegrityQualified": True, "checkpointCoverageQualified": True,
            "missing": [], "integrityIssues": [], "diagnosticIssues": []}
        require(all(exact(parsed.get(k), v) for k, v in headers.items()), "Actual next6 source/config/strict qualification differs")
        rows = parsed.get("records", [])
        require(len(rows) == len(samples) * 2 and {(r.get("sampleNumber"), r.get("arm")) for r in rows} == {(n, a) for n in samples for a in ["A", "B"]}, "Actual next6 record identities missing or duplicated")
        for record in rows:
            if record["arm"] != "B":
                continue  # Actual A failures/findings stay archived, never waived.
            sample = record["sampleNumber"]
            input_hash = manifest["expectedInputHashesByDataset"][dataset][str(sample)]
            row = record.get("official") or {}
            audit = row.get("routingMetrics", {}).get("experimentAudit") or {}
            require(record.get("sha") == approved["candidateSource"] and record.get("expectedInputHash") == input_hash and record.get("controllerError") is None and record.get("supplementalValidationError") is None, "Actual next6 B source/input/errors differ")
            named_failure = dataset == "srj18" and sample == 16 and row.get("didSolve") is False
            require(all(exact(row.get(k), v) for k, v in {"sampleNumber": sample, "solverName": SOLVER, "didSolve": not named_failure, "didTimeout": False, "relaxedDrcPassed": not named_failure, "sampleTimeoutMs": 360000}.items()), "Actual next6 B must be clean or the predeclared explicit16 repair failure")
            actual = {"actualSolverName": SOLVER, "actualConstructorName": SOLVER, "solverModule": MODULE, "options": CANDIDATE_OPTIONS,
                "inputHash": input_hash, "inputMutated": False, "solverSolved": not named_failure, "solverFailed": named_failure, "actualCacheProviderState": "disabled"}
            require(all(exact(audit.get(k), v) for k, v in actual.items()), "Actual next6 B factory evidence differs")
            if named_failure:
                require(isinstance(audit.get("solverError"), str) and re.fullmatch(r"Pipeline9 joint repair retains [1-9][0-9]* original via-placement violations", audit["solverError"]), "Next6 failed16 must be the statically named Joint repair, not generic/early failure")
                require(all(audit.get(k) is None for k in ["rawOutputHash", "rawNewTracesHash"]) and record.get("supplemental") is None, "Named failed16 must honestly have no output/copper")
            else:
                require(audit.get("solverError") is None and all(hash_value(audit.get(k), 64) for k in ["rawOutputHash", "rawNewTracesHash"]), "Actual next6 clean B output evidence differs")
            observed, paths = audit.get("evidence", {}), evidence_paths("retention")
            require(all(p in observed for p in paths) and observed[paths[0]] is False and observed[paths[1]] is True and type(observed[paths[3]]) is int and observed[paths[3]] == manifest["expectedOriginalLayerCountsByDataset"][dataset][str(sample)], "Actual next6 B live guard/retention differs")
            if not named_failure:
                checks = record.get("supplemental") or {}
                for name in ["referenceFullCopperChecks", "inputOnlyPhysicalChecks", "inputOnlyConnectivityFindings", "libraryRoutingChecks", "boardCopperChecks", "viaBoardChecks"]:
                    check = checks.get(name, {})
                    count, types = check.get("count"), check.get("byType")
                    require(type(count) is int and count >= 0 and isinstance(types, dict) and all(type(v) is int and v >= 0 for v in types.values()) and sum(types.values()) == count, "Actual next6 B supplemental findings incomplete")
                require(all(checks[n]["count"] == 0 for n in ["referenceFullCopperChecks", "inputOnlyPhysicalChecks", "boardCopperChecks", "viaBoardChecks"]) and checks["libraryRoutingChecks"]["byType"].get("pcb_pad_pad_clearance_error", 0) == 0, "Actual next6 B15/16/camera is physically invalid")
            constructor, elapsed, wall = audit.get("constructorTimeMs"), row.get("elapsedTimeMs"), record.get("externalBenchmarkProcessWallMs")
            require(all(core.finite_nonnegative(v) for v in [constructor, elapsed, wall]) and wall + .001 >= constructor + elapsed, "Actual next6 clock integrity differs")
            checkpoint = record.get("phaseCheckpointAudit") or {}
            status, last, count = checkpoint.get("status") or {}, checkpoint.get("lastDurableCheckpoint") or {}, checkpoint.get("rowCount")
            cp = {"schemaVersion": 1, "campaign": approved["campaign"], "arm": "B", "dataset": dataset, "algorithmSha": approved["candidateSource"],
                "inputSha256": input_hash, "originalSample": sample, "observerSourceSha256": observer, "githubRunId": str(approved["runId"]),
                "controllerSha": approved["controllerSha"], "executionOrder": "AB", "observedObjectPath": "solver", "observedConstructorName": SOLVER, "event": "solve_exit"}
            require(checkpoint.get("errors") == [] and type(count) is int and 1 <= count <= 256 and all(exact(last.get(k), v) for k, v in cp.items()) and type(last.get("sequence")) is int and last["sequence"] == count - 1, "Actual next6 terminal source/clock checkpoint differs")
            require(status.get("observerSourceSha256") == observer and all(status.get(k) is True for k in ["installed", "solveEntered", "solveFinished"]) and status.get("errors") == [] and status.get("truncated") is False and core.finite_nonnegative(last.get("officialStartOffsetMs")) and last["officialStartOffsetMs"] <= elapsed + 2, "Actual next6 observer completion differs")
            if named_failure:
                require(last.get("phaseName") == "pipeline9JointDrcRepairSolver" and last.get("failed") is True and last.get("solved") is False and last.get("error") == audit["solverError"], "Named failed16 requires actual completed Joint-phase failure evidence")
    require(gate.get("doesNotPrequalifyFinalCombinedCandidate") is True, "Separate next6 success cannot prequalify final combined B")


def receipt(envelope, status):
    require(isinstance(envelope, dict) and envelope.get("status") == status, "Required actual source receipt is pending or failed: " + status)
    text = envelope.get("evidenceFileText")
    require(isinstance(text, str) and hashlib.sha256(text.encode()).hexdigest() == envelope.get("evidenceFileSha256"), "Actual receipt bytes/digest missing")
    data = json.loads(text)
    require(isinstance(data, dict) and data.get("status") == status, "Receipt status differs from archived evidence")
    return data


def source_pins(manifest, arm):
    publication = manifest["baselinePublication"] if arm == "A" else manifest["candidatePublication"]
    config = manifest["baseline"] if arm == "A" else manifest["experiments"][0]
    tiny = manifest["tinyDependencyByArm"][arm]
    return {"sourceRemote": publication["publishedCommit"], "sourceLocal": publication["reviewedLocalCommit"],
        "sourceTree": publication["expectedTree"], "tinyRemote": tiny["remoteSha"], "tinyTree": tiny["tree"], "options": config["options"]}


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
        "options": config["options"], "inputHash": proof.get("inputHash"), "inputMutated": False, "solverSolved": True, "solverFailed": False}.items():
        require(exact(actual.get(name), expected), "Factory actual terminal pin changed: " + name)
    require(hash_value(proof.get("inputHash"), 64) and hash_value(proof.get("outputHash"), 64), "Factory synthetic input/output hashes missing")
    observed = actual.get("evidence", {})
    paths = evidence_paths("retention")
    live = config["options"].get("retainBestPartialRouting")
    context = 2 if config["options"].get("constrainViaPadPlacement") is True else None
    require(all(p in observed for p in paths) and observed[paths[0]] is live and (live is None or type(observed[paths[0]]) is bool) and observed[paths[1]] is (None if arm == "A" else True) and observed[paths[2]] is None and exact(observed[paths[3]], context), "Factory per-arm null/boolean guard-retention wiring missing")
    text = proof.get("evidenceFileText")
    require(isinstance(text, str) and hashlib.sha256(text.encode()).hexdigest() == proof.get("evidenceFileSha256"), "Factory exact receipt bytes missing")
    archived = json.loads(text)
    for name in ["status", "sourceSha", "sourceTree", "runtimeSourceHashes", "config", "inputHash", "outputHash", "iterations", "maxIterations", "checkpointRows"]:
        require(exact(archived.get(name), proof.get(name)), "Factory archived summary differs: " + name)
    require(exact(archived.get("evidence"), actual), "Factory actual terminal receipt differs")


def validate_source_qualification(manifest, arm):
    if arm == "A":
        validate_original_baseline(manifest)
        return
    require(isinstance(APPROVED_CANDIDATE_QA, dict), "HELD: exact final combined-source QA schema/digest is pending")
    gate = manifest.get("sourceQualificationByArm", {}).get(arm, {})
    raw = gate.get("evidenceFileText")
    require(isinstance(raw, str) and hashlib.sha256(raw.encode()).hexdigest() == gate.get("evidenceFileSha256") == APPROVED_CANDIDATE_QA.get("receiptSha256"), "Actual combined-source QA bytes differ")
    data = json.loads(raw)
    publication = manifest["candidatePublication"]
    require(data.get(APPROVED_CANDIDATE_QA["localSourceKey"]) == publication["reviewedLocalCommit"] and data.get(APPROVED_CANDIDATE_QA["sourceTreeKey"]) == publication["expectedTree"], "Actual combined-source QA source/tree differs")
    required = APPROVED_CANDIDATE_QA.get("requiredEvidenceByKind", {})
    require(set(required) >= {"fullTypes", "fullBuild", "focusedTests"}, "Root-reviewed actual source validation requirements are incomplete")
    for kind, check in required.items():
        observed = data
        for key in check["path"]:
            require(isinstance(observed, dict) and key in observed, "Actual combined-source QA field missing: " + kind)
            observed = observed[key]
        require(exact(observed, check["expected"]), "Actual combined-source QA failed: " + kind)
    review_text = gate.get("independentReviewEvidenceText")
    require(isinstance(review_text, str) and hashlib.sha256(review_text.encode()).hexdigest() == gate.get("independentReviewEvidenceSha256") == APPROVED_CANDIDATE_QA["independentReviewSha256"], "Actual combined independent review bytes differ")
    review = json.loads(review_text)
    require(review.get("verdict") == "NO_COMPOSITION_BLOCKERS" and review.get("source") == publication["reviewedLocalCommit"] and review.get("tree") == publication["expectedTree"] and review.get("independentlyReconstructedTree") is True and review.get("wholeBoardRecoveryNotYetProved") is True, "Actual combined independent composition review/scope differs")




def validate_manifest(path):
    global TARGETS
    manifest = json.loads(pathlib.Path(path).read_text())
    require(manifest.get("activationStatus") == "READY_EXACT_SOURCE_PROOFS_REVIEWED", "HELD: exact remote sources, full build/tests/types, actual factory and bounded geometry receipts are pending")
    campaign = CAMPAIGNS.get(manifest.get("campaign"))
    require(campaign is not None, "Unknown controlled campaign")
    validate_original_baseline(manifest)
    validate_next6_gate(manifest)
    require(type(campaign["pr"]) is int and campaign["pr"] > 0, "HELD: authoritative final combined source PR is pending")
    require(manifest.get("dependencyPinApprovalByArm") == {"A": "APPROVED_EXACT_PUBLISHED_SOURCE", "B": "APPROVED_EXACT_PUBLISHED_SOURCE"}, "HELD: actual root-approved source dependency pins are pending")
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
        require(config.get("solverName") == SOLVER and config.get("solverModule") == MODULE and exact(config.get("options"), BASELINE_OPTIONS if arm == "A" else CANDIDATE_OPTIONS) and exact(config.get("evidencePaths"), evidence_paths("retention")) and config.get("phaseCheckpointTarget") is None, "Exact actual constructor/options changed")
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
    validate_per_arm_tiny_policy(manifest, base)
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
    original = manifest.get("original637DependencySections")
    require(isinstance(original, dict) and hashlib.sha256(json.dumps(original, sort_keys=True, separators=(",", ":")).encode()).hexdigest() == "f499085fae1b5fea66bb7c7b61bb663759213cde4931c53767690be8429cb84c", "Original637 full dependency declarations changed")
    for arm in ["A", "B"]:
        expected_sections = json.loads(json.dumps(original))
        packages = manifest.get("nativeDependencyByArm", {}).get(arm, {})
        require(set(packages) == {"@tscircuit/high-density-a01", "@tscircuit/high-density-a13", "@tscircuit/high-density-b01"}, "All three native packages must be pinned per arm")
        role = CAMPAIGNS[manifest["campaign"]]["roles"][arm]
        approved_a01 = manifest.get("approvedA01RemoteByArm", {}).get(arm)
        require(approved_a01 in {"10cdce5ad507adfaaec8ac32ea905ab02ffefa8a", "246176c5bc39bdb97c834f6bb4277ec4d101765d"}, "HELD: authoritative old/new A01 pin is pending")
        if arm == "A": require(approved_a01 == "10cdce5ad507adfaaec8ac32ea905ab02ffefa8a", "Original637 baseline A01 must remain original")
        commits = {"@tscircuit/high-density-a01": approved_a01, "@tscircuit/high-density-a13": "c6812cebd44b09f29f2fee929837b313b822f2ae", "@tscircuit/high-density-b01": "0acce21dc32a279788f88d884618630c82405590"}
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

def qualify_joint_activation(record):
    row = record.get("official") or {}
    audit = row.get("routingMetrics", {}).get("experimentAudit") or {}
    observed = audit.get("evidence") or {}
    present = JOINT_ACTIVATION_PATH in observed
    value = observed.get(JOINT_ACTIVATION_PATH)
    solved = row.get("didSolve") is True
    error = None
    if record["arm"] == "A":
        if (present and value is not None) or (solved and not present):
            error = "Legacy A Joint activation must be observed null"
    elif (solved and (not present or value is not True)) or (present and value is not None and value is not True):
        error = "B completed Joint original-via activation must be boolean true; early null is unproven"
    record["jointActivationEvidence"] = {"path": JOINT_ACTIVATION_PATH, "keyPresent": present,
        "observed": value, "positiveActivationProven": record["arm"] == "B" and value is True,
        "scope": "Activation evidence only; no solve or physical-validity waiver"}
    if error:
        previous = record.get("controllerError")
        record["controllerError"] = (str(previous) + "; " if previous else "") + error


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
            qualify_joint_activation(record)
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
