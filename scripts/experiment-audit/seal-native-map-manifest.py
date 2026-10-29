#!/usr/bin/env python3
"""Bind root-reviewed published trees and local QA to the fresh campaign."""
import argparse
import hashlib
import importlib.util
import inspect
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent


def digest(value, length):
    correct_type = isinstance(value, str)
    if not correct_type:
        return False
    pattern = r"[0-9a-f]{" + str(length) + "}"
    matched = re.fullmatch(pattern, value)
    return matched is not None


def load_runtime():
    path = ROOT / "run-native-map-experiment.py"
    spec = importlib.util.spec_from_file_location("post588_sealing_runtime", path)
    module = importlib.util.module_from_spec(spec)
    loader = spec.loader
    loader.exec_module(module)
    return module


def apply_sources(manifest, sources, runtime):
    if set(sources) != set(manifest["requestedExperiments"]):
        raise ValueError("Every explicitly requested source requires its publication/review receipt; no extra/omitted sources")
    for item in manifest["experiments"]:
        receipt = sources[item["id"]]
        for field in ["candidateSha", "candidateTree", "reviewedLocalCommit"]:
            if not digest(receipt.get(field), 40):
                raise ValueError("Exact source/tree/local commit required: " + item["id"])
        if receipt.get("rootReviewed") is not True or not isinstance(receipt.get("rootReview"), str) or not receipt["rootReview"].strip():
            raise ValueError("Root review must be explicit: " + item["id"])
        if any(type(receipt.get(key)) is not int or receipt[key] != 0 for key in ["fullTypesExitCode", "fullBuildExitCode", "focusedTestsExitCode"]):
            raise ValueError("Source QA must complete before publication: " + item["id"])
        path = pathlib.Path(receipt["qualificationPath"])
        raw = path.read_text()
        actual_hash = hashlib.sha256(raw.encode()).hexdigest()
        if actual_hash != receipt.get("qualificationSha256"):
            raise ValueError("Agent source qualification bytes changed: " + item["id"])
        data = json.loads(raw)
        source = data.get("source") if isinstance(data.get("source"), dict) else {}
        qa_tree = data.get("tree") or data.get("sourceTree") or data.get("localTree") or source.get("tree")
        qa_commit = data.get("localCommit") or data.get("sourceCommit") or data.get("commit") or source.get("head") or source.get("sha") or source.get("commit")
        if qa_tree != receipt["candidateTree"] or qa_commit != receipt["reviewedLocalCommit"]:
            raise ValueError("QA identifies another local source/tree: " + item["id"])
        if "evidencePaths" in receipt:
            item["evidencePaths"] = receipt["evidencePaths"]
        if "coverageContract" in receipt:
            item["coverageContract"] = receipt["coverageContract"]
        runtime.coverage_module.validate_contract(item)
        attestation = {"status": "ROOT_REVIEWED_NEW_POST588_SOURCE", "sourceTree": receipt["candidateTree"],
                       "localCommit": receipt["reviewedLocalCommit"], "rootReview": receipt["rootReview"],
                       "agentQualificationSha256": actual_hash, "agentQualificationText": raw}
        evidence = json.dumps(attestation, sort_keys=True, separators=(",", ":"))
        item.update(candidateSha=receipt["candidateSha"], candidateTree=receipt["candidateTree"],
                    publication={"publishedCommit": receipt["candidateSha"], "expectedTree": receipt["candidateTree"],
                                 "reviewedLocalCommit": receipt["reviewedLocalCommit"]},
                    sourceQualification={"status": "PASS_ROOT_REVIEWED", "sourceTree": receipt["candidateTree"],
                                         "fullTypesExitCode": 0, "fullBuildExitCode": 0, "focusedTestsExitCode": 0,
                                         "evidenceText": evidence, "evidenceSha256": hashlib.sha256(evidence.encode()).hexdigest()})


def refresh(manifest, runtime):
    manifest["executionScope"] = runtime.execution_scope(manifest)
    manifest["plannedRecordsAllCandidates"] = manifest["executionScope"]["plannedRecords"]
    manifest["plannedMatrixJobs"] = manifest["executionScope"]["plannedMatrixJobs"]
    manifest["plannedPairsPerCandidate"] = sum(runtime.COUNTS[name] for name in manifest["executionScope"]["datasets"])
    manifest["plannedRecordsPerCandidate"] = manifest["plannedPairsPerCandidate"] * 2
    manifest["runtimeSourceHashes"] = {name: runtime.sha(ROOT / name) for name in sorted(runtime.ASSETS)}
    manifest["runSampleSourceSha256"] = hashlib.sha256(inspect.getsource(runtime.pinned.run_sample).encode()).hexdigest()
    manifest["workflowSha256"] = runtime.sha(runtime.WORKFLOW)
    harness = manifest["expectedHarnessSourceHashes"]
    harness["adapterHash"] = runtime.sha(ROOT / "experiment-audit-adapter.ts")
    harness["phaseCheckpointObserverHash"] = runtime.sha(ROOT / "phase-checkpoint-observer.ts")
    harness["terminalFailureGeometryCaptureHash"] = runtime.sha(ROOT / "capture-terminal-failure-geometry.ts")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=ROOT / "native-map-experiment-20261029.json")
    parser.add_argument("--sources", type=pathlib.Path)
    parser.add_argument("--features", help="Explicit comma-separated qualified subset; rebuilding from source-free definitions")
    parser.add_argument("--order", choices=["AB", "BA"])
    parser.add_argument("--experiment")
    parser.add_argument("--dataset", choices=["both", "srj18", "srj24"])
    args = parser.parse_args()
    runtime = load_runtime()
    manifest = json.loads(args.manifest.read_text())
    if args.features:
        requested = args.features.split(",")
        definitions = json.loads((ROOT / "native-map-feature-contract.json").read_text())
        if not requested or len(set(requested)) != len(requested) or not set(requested) <= set(runtime.FEATURES):
            raise ValueError("Explicit unique known feature subset required")
        by_name = {item["id"]: item for item in definitions}
        manifest["requestedExperiments"] = requested
        manifest["experiments"] = [dict(by_name[name], candidateSha=None, candidateTree=None, publication=None, sourceQualification={"status": "PENDING_PUBLICATION_AND_ROOT_REVIEW"}) for name in requested]
    if args.sources:
        apply_sources(manifest, json.loads(args.sources.read_text()), runtime)
    for key in ["order", "experiment", "dataset"]:
        if getattr(args, key) is not None:
            manifest["dispatchRequest"][key] = getattr(args, key)
    refresh(manifest, runtime)
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    if args.sources:
        runtime.validate_manifest(args.manifest)
        print(json.dumps({"status": "SEALED_ROOT_REVIEWED_EXPLICIT_NEW_SOURCE_SUBSET", "manifestSha256": runtime.sha(args.manifest)}))
    else:
        print(json.dumps({"status": "HELPER_HASHES_REFRESHED_SOURCE_PUBLICATION_STILL_REQUIRED", "manifestSha256": runtime.sha(args.manifest)}))


if __name__ == "__main__":
    main()
