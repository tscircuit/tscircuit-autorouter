#!/usr/bin/env python3
"""Hash-bound private artifact inspection only; never constructs a router."""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess

SOURCE = "ee0dac23c8ff76fde81a0124bf444790a8394f25"
TREE = "c96942d07e4887d61759177e552c3d6733021c53"
MAIN = "637b6c581128238f6c61227a1c15be423d24baca"
CONTROLLER = "b866c51c779ac23e3c0581ce9744e2e965c9b5e6"
INPUT = "4a513349694b8558e159dfc88eda8344f1b6158c63f89f558a9cc8c2fa0bf71e"
ARTIFACTS = [
    (40787080806, 12860675747, "main-vs-coalesced-layer-retention", "srj18", 14,
     "f62b616c13c00884b53da0cf9f757e8eee17fd018dec3cae1cc4aabc1acc6107"),
    (40787080806, 12859847927, "main-vs-coalesced-layer-retention", "srj24", 12,
     "559c98a3df88827fc9a507ce1f7a9f054962b7437a26e5e34b50d64cb80736b2"),
    (40787092770, 12858549821, "coalesced-layer-retention-off-vs-on", "srj18", 14,
     "620c7333cbe8f3d5ac6a4a437541c95a6937b996eb90c91d07d1bc60dc8ec238"),
    (40787092770, 12860242080, "coalesced-layer-retention-off-vs-on", "srj24", 12,
     "1a1cd3011e1b2529ae33db77072ce8569d258930a6bdb8b98630f40da7e4fa65"),
]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(value, reason):
    if not value:
        raise ValueError(reason)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--finalize-bindings", action="store_true")
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=source, text=True).strip()
    require((actual, tree) == (SOURCE, TREE), "Read-only audit source changed")
    if args.finalize_bindings:
        manifest = json.loads((output / "binding-manifest.json").read_text())
        for binding in manifest["bindings"]:
            original = json.loads((pathlib.Path(binding["rawDirectory"]) / "original-input.json").read_text())
            require(original["sourceCircuitJson"] == "circuit-json/sample014-ov9281-camera-board.json", "Original CJSON source identity changed")
            circuit = source / "node_modules/dataset-srj18" / original["sourceCircuitJson"]
            require(circuit.is_file(), "Missing immutable original source circuit JSON")
            binding["originalSourceCircuitJson"] = {"path": str(circuit), "sha256": digest(circuit)}
        (output / "binding-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        return

    helper_path = pathlib.Path(__file__).with_name("fetch-fixed-retention-artifact.py")
    spec = importlib.util.spec_from_file_location("fixed_artifact_fetch", helper_path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    output.mkdir(parents=True, exist_ok=False)
    bindings, receipts = [], []
    for run, artifact_id, campaign, dataset, sample, zip_hash in ARTIFACTS:
        name = "strongest-refinement-" + campaign + "-screen-AB-" + dataset
        helper.RUN_ID, helper.ARTIFACT_ID, helper.ARTIFACT_NAME = run, artifact_id, name
        helper.ZIP_SHA256, helper.CONTROLLER_SHA = zip_hash, CONTROLLER
        data, metadata = helper.fetch_zip(os.environ["GH_TOKEN"])
        destination = output / str(artifact_id)
        helper.extract_safe(data, destination)
        roots = list(destination.rglob("provenance.json"))
        require(len(roots) == 1, "Expected exactly one captured campaign")
        root = roots[0].parent
        provenance = json.loads(roots[0].read_text())
        require(str(provenance["githubRunId"]) == str(run) and provenance["controllerSha"] == CONTROLLER,
                "Captured controller/run mismatch")
        require(provenance["dataset"] == dataset and provenance["executionOrder"] == "AB" and
                provenance["qualificationMode"] == "screen", "Captured population/order mismatch")
        rows = [json.loads(line) for line in (root / "results.jsonl").read_text().splitlines() if line]
        require(len(rows) == 2 and {row["arm"] for row in rows} == {"A", "B"}, "Expected exact two-arm screen")
        artifact_bindings = []
        for row in rows:
            arm = row["arm"]
            expected_source = MAIN if campaign.startswith("main-") and arm == "A" else SOURCE
            expected_options = {"cacheProvider": None, "effort": 1}
            if expected_source == SOURCE:
                expected_options.update({"retainBestPartialRouting": arm == "B", "constrainViaPadPlacement": True})
            # The main comparison uses retained routing for its candidate B.
            require(row["sampleNumber"] == sample and row["dataset"] == dataset and row["round"] == 1 and
                    row["executionOrder"] == "AB" and row["sha"] == expected_source, "Captured row identity changed")
            require(row["expectedInputHash"] == INPUT, "Original camera input changed")
            require(provenance["harnesses"][arm]["checkoutSha"] == expected_source, "Captured source checkout changed")
            official = row["official"]
            require(official["didSolve"] and not official["didTimeout"] and official["relaxedDrcPassed"] and
                    official["drcErrorCount"] == 0 and row["controllerError"] is None and row["supplementalValidationError"] is None,
                    "Failed or unqualified capture must not enter successful-copper audit")
            audit = official["routingMetrics"]["experimentAudit"]
            require(audit["options"] == expected_options and audit["solverSolved"] and not audit["solverFailed"] and
                    audit["solverError"] is None and not audit["inputMutated"], "Captured live constructor identity changed")
            if expected_source == SOURCE:
                require(audit["evidence"]["portPointPathingSolver.tinyPipelineSolver.solveGraph.RETAIN_BEST_PARTIAL_ROUTING"] is expected_options["retainBestPartialRouting"],
                        "Native retention flag differs from the selected arm")
                require(audit["evidence"]["highDensityRouteSolver.viaPlacementContext.layerCount"] == 4,
                        "Native original via placement guard is not live")
            raw = root / "round-1" / ("sample-%03d" % sample) / arm / "raw"
            hashes = {"input": INPUT, "output": audit["rawOutputHash"], "traces": audit["rawNewTracesHash"]}
            for filename, key in [("original-input.json", "input"), ("raw-solver-output.json", "output"), ("raw-new-traces.json", "traces")]:
                require(digest(raw / filename) == hashes[key], "Captured raw hash changed")
            if expected_source == SOURCE:
                require(hashes["output"] == "a746c3e181a4ab8a3e1c5bc4aad3d10bf6f3d70e8b13f25b191cf3206e2f7325" and
                        hashes["traces"] == "c7827df983f33c0d50550fac278c25d6966a33761f34c59184eddb76df3b8a5b", "New candidate output differs from qualified logs")
            artifact_bindings.append({"label": campaign + "/" + dataset + "/" + arm,
                "campaignDirectory": str(root), "rawDirectory": str(raw), "sourceSha": expected_source,
                "controllerSha": CONTROLLER, "runId": str(run), "dataset": dataset, "sample": sample,
                "round": 1, "arm": arm, "expectedOptions": expected_options, "expectedHashes": hashes})
        receipt = {"status": "PASS_EXACT_PRIVATE_ARTIFACT_AND_SELECTED_SUCCESSFUL_ROWS",
            "artifactId": artifact_id, "runId": run, "controllerSha": CONTROLLER,
            "zipSha256": zip_hash, "rawHashes": [binding["expectedHashes"] for binding in artifact_bindings]}
        receipt_file = destination / "offline-audit-receipt.json"
        receipt_file.write_text(json.dumps(receipt, indent=2) + "\n")
        for binding in artifact_bindings:
            binding["strictQualificationReceipt"] = {"path": str(receipt_file), "sha256": digest(receipt_file)}
        bindings.extend(artifact_bindings)
        receipts.append(receipt)
    (output / "binding-manifest.json").write_text(json.dumps({"bindings": bindings}, indent=2) + "\n")
    print("COALESCED_PRIVATE_ARTIFACT_IDENTITY_JSON " + json.dumps({"receipts": receipts}, sort_keys=True))


if __name__ == "__main__":
    main()
