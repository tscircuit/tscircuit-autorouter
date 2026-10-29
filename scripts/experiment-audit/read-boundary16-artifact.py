#!/usr/bin/env python3
"""Read immutable final boundary-screen artifacts without any routing."""
import argparse
import importlib.util
import json
import os
import pathlib
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("frozen_full18_offline_reader", HERE / "read-coalesced-full18-artifact.py")
fixed = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixed)
require, digest, read_json = fixed.require, fixed.digest, fixed.read_json


def verify_selected(root, configuration):
    artifact = configuration["artifact"]
    provenance = read_json(root / "provenance.json")
    require(str(provenance["githubRunId"]) == artifact["runId"] and provenance["controllerSha"] == artifact["controllerSha"], "Captured run/controller changed")
    require(all(provenance[k] == artifact[k] for k in ["dataset", "executionOrder", "qualificationMode"]), "Captured campaign population changed")
    require([row["sampleNumber"] for row in provenance["selectedInputPopulation"]] == [15, 16] == artifact["population"], "Original selected identities changed")
    expected = {(case["sample"], case["arm"]): case for case in artifact["records"]}
    require(len(expected) == len(artifact["records"]) == 4 and set(expected) == {(sample, arm) for sample in [15, 16] for arm in "AB"}, "Expected selected4 population changed")
    rows = [json.loads(line) for line in (root / "results.jsonl").read_text().splitlines() if line]
    require([(row["sampleNumber"], row["arm"]) for row in rows] == [(sample, arm) for sample in [15, 16] for arm in "AB"], "Actual4 ordered identities changed")
    inventory = [{"relativePath": str(path.relative_to(root)), "bytes": path.stat().st_size, "sha256": digest(path.read_bytes())}
        for path in sorted(root.rglob("*")) if path.is_file()]
    stage_candidates = [item for item in inventory if any(token in item["relativePath"].lower()
        for token in ["stage-geometry/", "stage_geometry/", "stage-snapshot/", "stage_snapshots/", "stage-capture/"])]
    receipts, bindings, diagnostics = [], [], []
    for row in rows:
        case = expected[row["sampleNumber"], row["arm"]]
        require(fixed.canonical_record_sha256(row) == case["canonicalRecordSha256"], "Actual complete strict record fields/types changed")
        require(row["dataset"] == "srj18" and row["sha"] == case["sourceSha"] and row["campaign"] == artifact["campaign"] and
            row["round"] == 1 and row["executionOrder"] == "AB" and row["qualificationMode"] == "screen", "Actual row identity changed")
        require(row["expectedInputHash"] == case["expectedInputHash"] and row["controllerError"] is None and
            row["supplementalValidationError"] is None, "Actual row integrity changed")
        harness = provenance["harnesses"][case["arm"]]
        require(harness["checkoutSha"] == configuration["sourceByArm"][case["arm"]]["sha"] == case["sourceSha"] and
            harness["validators"] == configuration["validatorHashes"], "Original source/evaluator provenance changed")
        official = row["official"]
        audit = official["routingMetrics"]["experimentAudit"]
        require(official["didSolve"] is True and official["didTimeout"] is False and official["relaxedDrcPassed"] is True and
            official["drcErrorCount"] == 0 and audit["solverSolved"] is True and audit["solverFailed"] is False and
            audit["solverError"] is None and audit["inputMutated"] is False and audit["actualCacheProviderState"] == "disabled", "Selected successful output/native state changed")
        require(all(fixed.canonical_record_sha256(audit[k]) == fixed.canonical_record_sha256(v) for k, v in case["nativeState"].items()) and
            fixed.canonical_record_sha256(audit["options"]) == fixed.canonical_record_sha256(case["options"]) and
            audit["inputHash"] == case["expectedInputHash"], "Actual constructor options/native state/input changed")
        observed = audit["evidence"]
        require(observed["portPointPathingSolver.tinyPipelineSolver.solveGraph.RETAIN_BEST_PARTIAL_ROUTING"] is False and
            type(observed["highDensityRouteSolver.viaPlacementContext.layerCount"]) is int and
            observed["highDensityRouteSolver.viaPlacementContext.layerCount"] == case["layerCount"], "Actual guard/retention activation changed")
        hashes = {"input": case["expectedInputHash"], "output": case["output"], "traces": case["traces"]}
        raw = root / "round-1" / ("sample-%03d" % case["sample"]) / case["arm"] / "raw"
        raw_hashes = {path.name: digest(path.read_bytes()) for path in sorted(raw.iterdir()) if path.is_file()}
        for filename, key in [("original-input.json", "input"), ("raw-solver-output.json", "output"), ("raw-new-traces.json", "traces")]:
            require(raw_hashes.get(filename) == hashes[key] and isinstance(hashes[key], str), "Selected successful output bytes missing or changed")
        require(audit["rawOutputHash"] == hashes["output"] and audit["rawNewTracesHash"] == hashes["traces"], "Output hash provenance changed")
        for name in ["capture-provenance.json", "point-pair-context.json", "supplemental-validation.json"]:
            require(name in raw_hashes, "Selected final-capture file missing")
        capture = read_json(raw / "capture-provenance.json")
        for key in ["options", "inputHash", "rawOutputHash", "rawNewTracesHash", "solverSolved", "solverFailed", "solverError", "inputMutated", "actualCacheProviderState", "phaseCheckpoint", "phaseCheckpointObservedTarget", "evidence"]:
            require(fixed.canonical_record_sha256(capture[key]) == fixed.canonical_record_sha256(audit[key]), "Final capture/callback terminal provenance changed")
        supplemental = read_json(raw / "supplemental-validation.json")
        require({key: supplemental[key]["count"] for key in case["supplementalCounts"]} == case["supplementalCounts"], "Retained board/reference findings changed")
        checkpoints, checkpoint_hash = fixed.verify_checkpoints(raw, row, case, artifact)
        diagnostics.append(fixed.lifecycle_diagnostic(checkpoints, row, checkpoint_hash))
        receipts.append({"sample": case["sample"], "arm": case["arm"], "sourceSha": case["sourceSha"],
            "canonicalRecordSha256": case["canonicalRecordSha256"], "options": case["options"], "hashes": hashes,
            "nativeSolverSolved": True, "rawFileSha256": raw_hashes, "supplementalCounts": case["supplementalCounts"],
            "checkpointObserverSourceSha256": artifact["observerSourceSha256"],
            "phaseCheckpointObservedTarget": audit["phaseCheckpointObservedTarget"]})
        if case["sample"] == 16:
            bindings.append({"sample": 16, "arm": case["arm"], "sourceSha": case["sourceSha"],
                "rawDirectory": str(raw.resolve()), "campaignDirectory": str(root.resolve()),
                "expectedHashes": hashes, "expectedOptions": case["options"], "rawFileSha256": raw_hashes})
    coverage = {"retainedFileCount": len(inventory), "retainedFileInventory": inventory,
        "possiblePreFinalGeometryFiles": stage_candidates,
        "preFinalGeometryInterpretation": "No pre-final geometry is qualified by this reader. The exact complete retained file inventory is reported; stage-looking names are only heuristic candidates requiring separate content qualification. Scalar checkpoints and final normalized traces cannot reconstruct earlier HD route.vias arrays.",
        "firstProducingStage": "UNDETERMINED_FROM_EXISTING_CAPTURE",
        "newStageInstrumentationOrSolverExecution": False}
    return receipts, bindings, diagnostics, coverage


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    args = parser.parse_args()
    configuration = read_json(args.manifest)
    require(subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=args.source, text=True).strip() == configuration["sourceSha"] and
        subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=args.source, text=True).strip() == configuration["sourceTree"], "Exact boundary predicate source changed")
    data = fixed.fetch_zip(os.environ["GH_TOKEN"], configuration["artifact"])
    fixed.extract_safe(data, args.output)
    matches = list(args.output.rglob("provenance.json"))
    require(len(matches) == 1, "Expected exactly one retained boundary campaign")
    records, bindings, diagnostics, coverage = verify_selected(matches[0].parent, configuration)
    receipt = {"status": "PASS_ACTUAL_BOUNDARY4_IDENTITIES_FINAL_CAPTURE_AND_EXISTING_FILE_COVERAGE", "artifact":
        {key: value for key, value in configuration["artifact"].items() if key != "records"},
        "manifestSha256": digest(args.manifest.read_bytes()), "parsedEvidenceSha256": configuration["parsedEvidenceSha256"],
        "records": records, "lifecycleDiagnostics": diagnostics, "captureCoverage": coverage}
    receipt_path = args.output / "boundary16-identity-receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    (args.output / "boundary16-placement-bindings.json").write_text(json.dumps({"configuration": configuration, "bindings": bindings,
        "strictQualificationReceipt": {"path": str(receipt_path.resolve()), "sha256": digest(receipt_path.read_bytes())}}, indent=2) + "\n")
    print("BOUNDARY16_RETAINED_IDENTITY_JSON " + json.dumps(receipt, separators=(",", ":")))


if __name__ == "__main__":
    main()
