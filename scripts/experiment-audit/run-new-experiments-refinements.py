#!/usr/bin/env python3
"""Four fresh full-population BA jobs for source-reviewed refinements only."""
import argparse
import copy
import importlib.util
import json
import os
import pathlib
import tempfile
import types

ROOT = pathlib.Path(__file__).resolve().parent
BRANCH = "codex/new-experiments-refinement-controller-20261029"
CAMPAIGN = "new-experiments-refinements-20261029"
AB_CONTROLLER = "fb7e3c898405f4020fe35b53b574cacc8db8ac55"
AB_TREE = "de531d004ba9077e12062cc3ef9c9443c7d0dcf4"
AB_RUN = "40839519545"
AB_MANIFEST_HASH = "c33af6763299fcea21b43237309ed23098e2ed72bb7ac3dec35a8f240362af91"
AB_RUNTIME_HASH = "c8441bc052e1bfd35c91f9f9e57d7e0f3698d735b3e754f0b018d7cc30282124"
FEATURES = ["delta-drc", "joint-layers"]
ASSETS = {"run-new-experiments-refinements.py", "refinement-feature-coverage.py",
          "parse-new-experiments-refinements-log.py", "parse-new-experiments-log.py",
          "compare-new-experiments-refinement-outputs.py"}
WORKFLOW = ROOT.parent.parent / ".github/workflows/new-experiments-refinements.yml"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


r = load_module("original_new_experiments_runtime", ROOT / "run-new-experiments.py")
counter = load_module("refinement_feature_coverage", ROOT / "refinement-feature-coverage.py")
original_coverage = r.feature_coverage
r.feature_coverage = lambda record, item: counter.coverage(record, item, original_coverage)


def validate_manifest(path):
    followup = json.loads(path.read_text())
    r.require(type(followup.get("schemaVersion")) is int and followup["schemaVersion"] == 1 and followup.get("campaign") == CAMPAIGN,
              "Wrong refinement campaign/schema")
    request = followup.get("dispatchRequest")
    r.require(r.exact(request, {"status": "ROOT_REVIEWED_PUBLISHED_SOURCE_REFINEMENTS",
                               "experiments": FEATURES, "dataset": "both", "order": "BA"}),
              "PENDING_PUBLICATION: both refined sources require root-reviewed remote SHA/tree and QA before any job")
    r.require(r.exact(followup.get("originalAB"), {"runId": AB_RUN, "controllerSha": AB_CONTROLLER,
              "controllerTree": AB_TREE, "manifestSha256": AB_MANIFEST_HASH,
              "runtimeSha256": AB_RUNTIME_HASH}), "Original AB authority changed")
    r.require(followup.get("timingsPooledAcrossCampaigns") is False and
              followup.get("allOriginalFailuresRetained") is True and
              followup.get("strictTimeoutPolicy") == "ORIGINAL_UNCHANGED_NO_TERMINAL_GAP_UPGRADE",
              "Outcome/order/timeout qualification policy changed")
    hashes = followup.get("runtimeSourceHashes", {})
    r.require(set(hashes) == ASSETS and all(r.sha(ROOT / name) == value for name, value in hashes.items()),
              "Refinement runtime/parser/coverage/comparison helper bytes changed")
    r.require(r.sha(WORKFLOW) == followup.get("workflowSha256"), "Refinement workflow bytes changed")
    r.require(r.sha(ROOT / "new-experiments-20261029.json") == AB_MANIFEST_HASH and
              r.sha(ROOT / "run-new-experiments.py") == AB_RUNTIME_HASH, "Frozen AB manifest/runner changed")
    original = r.validate_manifest(ROOT / "new-experiments-20261029.json")
    replacements = followup.get("replacementSources", {})
    r.require(set(replacements) == set(FEATURES), "Exactly the two reviewed refinements required")
    materialized = copy.deepcopy(original)
    for feature in FEATURES:
        replacement = replacements[feature]
        r.require(isinstance(replacement, dict) and set(replacement) == {
            "candidateSha", "candidateTree", "publication", "sourceQualification", "evidencePaths"},
            "PENDING_PUBLICATION: missing exact refined source receipt: " + feature)
        old = r.select(original, feature)
        r.require(replacement.get("candidateSha") != old["candidateSha"] and
                  replacement.get("candidateTree") != old["candidateTree"],
                  "Refinement must retain the old source separately, not relabel it")
        r.require(replacement.get("evidencePaths") == counter.PATHS[feature],
                  "Refinement counter location differs from the reviewed coverage contract")
        r.select(materialized, feature).update(copy.deepcopy(replacement))
    materialized["dispatchRequest"] = {"experiment": "joint-layers", "dataset": "both", "order": "BA"}
    materialized["refinementController"] = {
        "campaign": CAMPAIGN, "manifestSha256": r.sha(path), "originalAB": followup["originalAB"],
        "requestedFeatures": FEATURES, "order": "BA", "fullPopulations": r.COUNTS,
        "scope": "FIRST_BA_CHARACTERIZATION_OF_NEW_REFINED_SOURCES_NOT_REVERSED_CONFIRMATION_OF_ORIGINAL_AB_CANDIDATES",
        "runtimeSourceHashes": hashes, "workflowSha256": followup["workflowSha256"],
        "originalSourcePins": {feature: {key: r.select(original, feature)[key]
                                for key in ["candidateSha", "candidateTree"]} for feature in FEATURES},
    }
    # Execute every original source/options/dependency/helper/validator/QA check
    # against the materialized pair. The original runtime remains byte-identical.
    with tempfile.TemporaryDirectory(prefix="refinement-manifest-") as directory:
        target = pathlib.Path(directory) / "manifest.json"
        target.write_text(json.dumps(materialized))
        r.validate_manifest(target)
    return followup, materialized


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["plan", "select", "verify-checkouts", "verify-dependencies", "run"])
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--experiment", choices=FEATURES)
    parser.add_argument("--dataset", choices=list(r.COUNTS))
    parser.add_argument("--baseline", type=pathlib.Path)
    parser.add_argument("--candidate", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    followup, manifest = validate_manifest(args.manifest)
    if os.environ.get("GITHUB_ACTIONS") == "true":
        r.require(os.environ.get("GITHUB_EVENT_NAME") == "push" and
                  os.environ.get("GITHUB_REF_NAME") == BRANCH, "Only the dedicated reviewed push branch may run this controller")
    if args.mode == "plan":
        r.require(args.experiment is None and args.dataset is None,
                  "The refinement plan is fixed to both reviewed features and both complete datasets")
        matrix = {"include": [{"experiment": feature, "dataset": dataset,
                              "count": count, "order": "BA"}
                             for feature in FEATURES for dataset, count in r.COUNTS.items()]}
        r.outputs({"matrix": json.dumps(matrix, separators=(",", ":"))})
        return
    r.require(args.experiment in FEATURES and args.dataset in r.COUNTS,
              "One exact reviewed experiment/dataset required outside plan")
    item = r.select(manifest, args.experiment)
    if args.mode == "select":
        r.outputs({"baseline_sha": r.MAIN, "candidate_sha": item["candidateSha"], "harness_sha": r.MAIN})
    elif args.mode == "verify-checkouts":
        r.verify_checkouts(manifest, item, {"A": args.baseline, "B": args.candidate})
    elif args.mode == "verify-dependencies":
        r.verify_dependencies(manifest, {"A": args.baseline, "B": args.candidate})
    else:
        r.require(args.baseline and args.candidate and args.output, "Fresh source checkouts/output required")
        r.require(not args.output.exists() or not any(args.output.iterdir()), "Output must be fresh")
        # This is additional provenance only. It never changes raw route data,
        # reference checks, original timeout policy or official clocks.
        args.output.mkdir(parents=True, exist_ok=True)
        r.pinned.write_json(args.output / "refinement-controller-provenance.json", {
            "followupManifest": followup, "manifestSha256": r.sha(args.manifest),
            "originalABController": AB_CONTROLLER, "originalABRun": AB_RUN,
            "controllerSha": os.environ.get("GITHUB_SHA"), "order": "BA",
        })
        # Original run requires a fresh empty output. Write the additional
        # provenance beside it, then copy it in after run even on failures.
        extra = args.output / "refinement-controller-provenance.json"
        raw_extra = extra.read_bytes()
        extra.unlink()
        try:
            r.run(types.SimpleNamespace(**vars(args), order="BA"), manifest, item)
        finally:
            extra.parent.mkdir(parents=True, exist_ok=True)
            extra.write_bytes(raw_extra)


if __name__ == "__main__":
    main()
