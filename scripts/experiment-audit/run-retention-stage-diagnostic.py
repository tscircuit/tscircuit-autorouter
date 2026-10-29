#!/usr/bin/env python3
"""Capture stage provenance on one fixed-source diagnostic; never qualify timing."""
import argparse
import hashlib
import importlib.util
import inspect
import json
import os
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent
SOURCE = "bd21dd642b4989b00e8279fae5c60cc7276ad642"
TREE = "a336ba7ec687e7813d97284faafd294a94e329eb"
MAIN = "637b6c581128238f6c61227a1c15be423d24baca"
MODULE = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts"
ASSETS = {"run-retention-stage-diagnostic.py", "run-pinned-experiment.py", "select-pinned-experiment.py", "prepare-pinned-harness.py", "install-pinned-dependencies.py", "experiment-audit-adapter.ts", "qualify-pinned-output.ts", "experiment-dataset-identity.ts", "phase-checkpoint-observer.ts", "capture-terminal-failure-geometry.ts", "stage-geometry-capture.ts", "audit-retention-stage-geometry.ts", "audit-boundary16-stage-representations.ts"}
spec = importlib.util.spec_from_file_location("pinned_runner", ROOT / "run-pinned-experiment.py")
pinned = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pinned)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate(path):
    manifest = json.loads(path.read_text())
    if manifest.get("sourceSha") != SOURCE or manifest.get("sourceTree") != TREE or manifest.get("harnessSha") != MAIN:
        raise ValueError("Only exact reviewedbd21 source and original637 harness are permitted")
    if manifest.get("dataset") != "srj18" or manifest.get("sampleNumbers") != [16] or manifest.get("options") != {"cacheProvider": None, "effort": 1, "retainBestPartialRouting": False, "constrainViaPadPlacement": True}:
        raise ValueError("The fixed sample16 guard-on retention-off diagnostic changed")
    if manifest.get("sampleTimeoutSeconds") != 360 or manifest.get("diagnosticOnly") is not True or manifest.get("timingQualified") is not False:
        raise ValueError("Original budget and diagnostic-only boundary are required")
    if set(manifest.get("runtimeSourceHashes", {})) != ASSETS:
        raise ValueError("Complete diagnostic runtime inventory required")
    for name, wanted in manifest["runtimeSourceHashes"].items():
        if sha(ROOT / name) != wanted:
            raise ValueError("Frozen runtime differs: " + name)
    if hashlib.sha256(inspect.getsource(pinned.run_sample).encode()).hexdigest() != manifest.get("runSampleSourceSha256"):
        raise ValueError("Original per-sample runner changed")
    proof = manifest.get("observerParity", {})
    if proof.get("status") != "PASS_LOCAL_TINY_ACTUAL_ADAPTER_FACTORY_CONTROL" or proof.get("sourceTree") != TREE or proof.get("runtimeSourceHashes") != {name: manifest["runtimeSourceHashes"][name] for name in ["experiment-audit-adapter.ts", "phase-checkpoint-observer.ts", "capture-terminal-failure-geometry.ts", "stage-geometry-capture.ts"]}:
        raise ValueError("Exact diagnostic observer lacks actual-factory functional parity")
    return manifest


def verify_checkout(manifest, checkout):
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip()
    tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=checkout, text=True).strip()
    if (actual, tree) != (SOURCE, TREE):
        raise ValueError("Diagnostic algorithm checkout differs from frozen source/tree")
    if sha(checkout / MODULE) != manifest["expectedPipelineSourceSha256"]:
        raise ValueError("Diagnostic pipeline source differs")


def run(args, manifest):
    checkout, output = args.candidate.resolve(), args.output.resolve()
    verify_checkout(manifest, checkout)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Diagnostic output must be new")
    harness = json.loads((checkout / "experiment-harness-provenance.json").read_text())
    if harness.get("checkoutSha") != SOURCE or harness.get("validators") != manifest["expectedValidatorHashes"]:
        raise ValueError("Source/validator provenance differs")
    for name, value in manifest["expectedHarnessSourceHashes"].items():
        if harness.get(name) != value:
            raise ValueError("Frozen diagnostic harness differs: " + name)
    identities = pinned.read_identity(checkout, "srj18")
    if [row["sampleNumber"] for row in identities] != list(range(1, 17)) or {str(row["sampleNumber"]): row["inputHash"] for row in identities} != manifest["expectedInputHashes"]:
        raise ValueError("Original complete SRJ18 identity population differs")
    config = {"solverName": "AutoroutingPipelineSolver9_PreloadedTraceGraph", "solverModule": MODULE, "options": manifest["options"], "evidencePaths": manifest["evidencePaths"],
        "stageGeometryDiagnostic": {"sourceSha256": manifest["runtimeSourceHashes"]["stage-geometry-capture.ts"]},
        "phaseCheckpoint": {"observerSourceSha256": manifest["runtimeSourceHashes"]["phase-checkpoint-observer.ts"], "campaign": "boundary16-stage-provenance-diagnostic", "algorithmSha": SOURCE, "arm": "DIAGNOSTIC_BOUNDARY_GUARD_ON_RETENTION_OFF", "executionOrder": "AB", "githubRunId": os.environ.get("GITHUB_RUN_ID"), "controllerSha": os.environ.get("GITHUB_SHA")}}
    pinned.write_json(output / "config.json", config)
    pinned.write_json(output / "provenance.json", {"manifest": manifest, "harness": harness, "inputPopulation": identities, "githubRunId": os.environ.get("GITHUB_RUN_ID"), "controllerSha": os.environ.get("GITHUB_SHA"), "diagnosticOnly": True, "timingQualified": False})
    record = pinned.run_sample(checkout, output / "config.json", output / "sample-016", "srj18", 16, 360)
    pinned.write_json(output / "record.json", record)
    print("BOUNDARY16_STAGE_DIAGNOSTIC_RECORD_JSON " + json.dumps({"diagnosticOnly": True, "timingQualified": False, "sampleNumber": 16, "sourceSha": SOURCE, "sourceTree": TREE, "controllerError": record.get("controllerError"), "official": {key: record.get("official", {}).get(key) for key in ["didSolve", "didTimeout", "relaxedDrcPassed", "error"]}}), flush=True)
    if record.get("controllerError"):
        raise ValueError("Diagnostic controller failed; retained outputs are not qualified")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["select", "verify-checkout", "run"], required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--candidate", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    manifest = validate(args.manifest)
    if args.mode == "select":
        values = {"candidate_sha": SOURCE, "candidate_tree": TREE, "harness_sha": MAIN}
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as handle:
                handle.write("".join(key + "=" + value + "\n" for key, value in values.items()))
        print(json.dumps(values))
    elif args.mode == "verify-checkout":
        verify_checkout(manifest, args.candidate.resolve())
    else:
        run(args, manifest)


if __name__ == "__main__":
    main()
