#!/usr/bin/env python3
"""Hash-bound retained-copper inspection; no routing or benchmark execution."""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(value, reason):
    if not value:
        raise ValueError(reason)


def case_hashes(case):
    require(case["expectedInputHash"] == case["observedInputHash"], "Qualified input identity disagrees")
    return {"input": case["expectedInputHash"], "output": case["outputHash"], "traces": case["tracesHash"]}


def verify_rows(root, artifact, hash_file=digest):
    """Verify every retained row against independent qualified metadata."""
    provenance = json.loads((root / "provenance.json").read_text())
    require(str(provenance["githubRunId"]) == str(artifact["runId"]) and
            provenance["controllerSha"] == artifact["controllerSha"], "Captured controller/run mismatch")
    require(provenance["dataset"] == artifact["dataset"] and
            provenance["executionOrder"] == artifact["executionOrder"] and
            provenance["qualificationMode"] == artifact["qualificationMode"], "Captured dataset/order/mode mismatch")
    population = artifact["population"]
    require(sorted(row["sampleNumber"] for row in provenance["selectedInputPopulation"]) == sorted(population),
            "Captured original sample population changed")
    require(len(population) == len(set(population)) and
            set(artifact["selectedSamples"]).issubset(population), "Invalid selected original samples")
    expected = {}
    for case in artifact["records"]:
        require(str(case["runId"]) == str(artifact["runId"]) and
                case["controllerSha"] == artifact["controllerSha"] and
                case["dataset"] == artifact["dataset"], "Qualified case is in the wrong artifact")
        key = (case["sample"], case["arm"])
        require(key not in expected and case["sample"] in population and case["arm"] in ("A", "B"),
                "Duplicate or unexpected qualified case")
        expected[key] = case
    require(set(expected) == {(sample, arm) for sample in population for arm in ("A", "B")},
            "Qualified records do not cover the original two-arm population")
    rows = [json.loads(line) for line in (root / "results.jsonl").read_text().splitlines() if line]
    require(len(rows) == len(expected), "Retained record count changed")
    selected, receipts, seen = [], [], set()
    for row in rows:
        key = (row["sampleNumber"], row["arm"])
        require(key in expected and key not in seen, "Missing, duplicated or reindexed retained case")
        seen.add(key)
        case = expected[key]
        hashes = case_hashes(case)
        require(row["dataset"] == case["dataset"] and row["sha"] == case["sourceSha"] and
                row["round"] == 1 and row["executionOrder"] == artifact["executionOrder"], "Captured row identity changed")
        require(row["expectedInputHash"] == hashes["input"], "Original per-case input changed")
        require(provenance["harnesses"][row["arm"]]["checkoutSha"] == case["sourceSha"], "Captured source checkout changed")
        official = row["official"]
        require(official["didSolve"] and not official["didTimeout"] and official["relaxedDrcPassed"] and
                official["drcErrorCount"] == 0 and row["controllerError"] is None and
                row["supplementalValidationError"] is None, "Unqualified capture cannot enter the successful-copper audit")
        audit = official["routingMetrics"]["experimentAudit"]
        require(audit["options"] == case["options"] and audit["solverSolved"] and
                not audit["solverFailed"] and audit["solverError"] is None and
                not audit["inputMutated"], "Captured live constructor identity changed")
        require({"input": audit["inputHash"], "output": audit["rawOutputHash"],
                 "traces": audit["rawNewTracesHash"]} == hashes, "Captured hashes differ from the qualified per-case record")
        if "retainBestPartialRouting" in case["options"]:
            require(audit["evidence"]["portPointPathingSolver.tinyPipelineSolver.solveGraph.RETAIN_BEST_PARTIAL_ROUTING"]
                    is case["options"]["retainBestPartialRouting"], "Native retention flag differs from the qualified case")
        if case["options"].get("constrainViaPadPlacement") is True:
            require(audit["evidence"]["highDensityRouteSolver.viaPlacementContext.layerCount"] == 4,
                    "Native original via placement guard is not live")
        checkpoint = row["phaseCheckpointAudit"]["lastDurableCheckpoint"]
        require(row["phaseCheckpointAudit"]["errors"] == [] and
                checkpoint["algorithmSha"] == case["sourceSha"] and
                str(checkpoint["githubRunId"]) == str(case["runId"]) and
                checkpoint["controllerSha"] == case["controllerSha"] and
                checkpoint["dataset"] == case["dataset"] and checkpoint["originalSample"] == case["sample"] and
                checkpoint["inputSha256"] == hashes["input"], "Captured lifecycle identity changed")
        raw = root / "round-1" / ("sample-%03d" % case["sample"]) / case["arm"] / "raw"
        for filename, name in [("original-input.json", "input"), ("raw-solver-output.json", "output"),
                               ("raw-new-traces.json", "traces")]:
            require(hash_file(raw / filename) == hashes[name], "Captured raw bytes differ from the qualified per-case record")
        receipts.append({"sample": case["sample"], "arm": case["arm"], "sourceSha": case["sourceSha"],
                         "options": case["options"], "hashes": hashes})
        if case["sample"] in artifact["selectedSamples"]:
            selected.append({"label": artifact["artifactName"] + "/" + case["arm"],
                "campaignDirectory": str(root), "rawDirectory": str(raw), "sourceSha": case["sourceSha"],
                "controllerSha": case["controllerSha"], "runId": str(case["runId"]),
                "dataset": case["dataset"], "sample": case["sample"], "round": 1, "arm": case["arm"],
                "artifactId": artifact["artifactId"], "expectedOptions": case["options"], "expectedHashes": hashes})
    require(seen == set(expected), "Incomplete retained population")
    return selected, receipts


def finalize_bindings(source, output, configuration):
    manifest = json.loads((output / "binding-manifest.json").read_text())
    for binding in manifest["bindings"]:
        artifacts = [artifact for artifact in configuration["artifacts"] if artifact["artifactId"] == binding["artifactId"]]
        require(len(artifacts) == 1, "Selected artifact is not in the immutable configuration")
        artifact = artifacts[0]
        matches = [case for case in artifact["records"] if case["sample"] == binding["sample"] and
                   case["arm"] == binding["arm"] and case["sourceSha"] == binding["sourceSha"] and
                   case["dataset"] == binding["dataset"] and case["options"] == binding["expectedOptions"]]
        require(len(matches) == 1 and binding["sample"] in artifact["selectedSamples"], "Selected case identity changed")
        case = matches[0]
        require(binding["expectedHashes"] == case_hashes(case), "Selected qualified case hashes changed")
        raw = pathlib.Path(binding["rawDirectory"])
        require(digest(raw / "original-input.json") == case["expectedInputHash"], "Original per-case input bytes changed")
        original = json.loads((raw / "original-input.json").read_text())
        circuit = case["originalSourceCircuitJson"]
        require(original["sourceCircuitJson"] == circuit["relativePath"], "Original per-case CJSON filename changed")
        for part in [circuit["packageName"], circuit["relativePath"]]:
            path = pathlib.PurePosixPath(part)
            require(not path.is_absolute() and ".." not in path.parts and "\\" not in part, "Unsafe original CJSON path")
        path = source / "node_modules" / circuit["packageName"] / circuit["relativePath"]
        require(path.is_file() and digest(path) == circuit["sha256"], "Original per-case source CJSON bytes changed")
        binding["originalSourceCircuitJson"] = {"path": str(path), "sha256": circuit["sha256"]}
    (output / "binding-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--finalize-bindings", action="store_true")
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    configuration = json.loads(args.manifest.read_text())
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=source, text=True).strip()
    require((actual, tree) == (configuration["sourceSha"], configuration["sourceTree"]), "Read-only audit source changed")
    if args.finalize_bindings:
        finalize_bindings(source, output, configuration)
        return
    helper_path = pathlib.Path(__file__).with_name("fetch-fixed-retention-artifact.py")
    spec = importlib.util.spec_from_file_location("fixed_artifact_fetch", helper_path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    output.mkdir(parents=True, exist_ok=False)
    bindings, receipts = [], []
    for artifact in configuration["artifacts"]:
        helper.RUN_ID, helper.ARTIFACT_ID = artifact["runId"], artifact["artifactId"]
        helper.ARTIFACT_NAME, helper.ZIP_SHA256 = artifact["artifactName"], artifact["zipSha256"]
        helper.CONTROLLER_SHA = artifact["controllerSha"]
        data, _metadata = helper.fetch_zip(os.environ["GH_TOKEN"])
        destination = output / str(artifact["artifactId"])
        helper.extract_safe(data, destination)
        roots = list(destination.rglob("provenance.json"))
        require(len(roots) == 1, "Expected exactly one captured campaign")
        selected, cases = verify_rows(roots[0].parent, artifact)
        receipt = {"status": "PASS_ALL_IMMUTABLE_QUALIFIED_CASE_IDENTITIES_AND_RAW_BYTES",
            "artifactId": artifact["artifactId"], "runId": artifact["runId"],
            "controllerSha": artifact["controllerSha"], "zipSha256": artifact["zipSha256"],
            "configurationSha256": digest(args.manifest), "cases": cases,
            "selectedSamples": artifact["selectedSamples"]}
        receipt_path = destination / "offline-audit-receipt.json"
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
        for binding in selected:
            binding["strictQualificationReceipt"] = {"path": str(receipt_path), "sha256": digest(receipt_path)}
        bindings.extend(selected)
        receipts.append(receipt)
    (output / "binding-manifest.json").write_text(json.dumps({"bindings": bindings}, indent=2) + "\n")
    print("QUALIFIED_PRIVATE_ARTIFACT_IDENTITY_JSON " + json.dumps({"receipts": receipts}, sort_keys=True))


if __name__ == "__main__":
    main()
