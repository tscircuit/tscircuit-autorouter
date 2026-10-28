#!/usr/bin/env python3
"""Pin only a completed targeted AB artifact; never claim a full dataset sweep."""
import argparse
import copy
import importlib.util
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("targeted_parser", ROOT / "parse-targeted-job-log.py")
targeted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(targeted)


def prepare(pins, dataset, job_id, metadata, log):
    manifest = targeted.validate_pins(pins)
    if dataset not in targeted.TARGETS or type(job_id) is not int or pins["jobs"][dataset] != job_id:
        raise ValueError("Job/dataset does not match the immutable selected source")
    audit, records = targeted.parse_log(log, pins, dataset)
    if audit["issues"] or not audit["completeSelectedPopulation"] or len(records) != 2 * len(targeted.TARGETS[dataset]):
        raise ValueError("Only a complete, internally consistent selected AB population can prepare a targeted source")
    if not isinstance(metadata, dict) or not isinstance(metadata.get("workflow_run"), dict):
        raise ValueError("Artifact metadata must include its exact source workflow")
    workflow = metadata["workflow_run"]
    wanted_name = f"targeted-forest-scope-3198-{dataset}"
    if metadata.get("name") != wanted_name or metadata.get("expired") is not False or type(workflow.get("id")) is not int or workflow["id"] != pins["runId"] or workflow.get("head_sha") != pins["controllerSha"] or workflow.get("head_branch") != pins["controllerBranch"]:
        raise ValueError("Artifact name/run/controller/branch differs from the exact targeted source")
    if type(metadata.get("id")) is not int or metadata["id"] <= 0 or type(metadata.get("size_in_bytes")) is not int or metadata["size_in_bytes"] <= 0 or not isinstance(metadata.get("digest"), str) or re.fullmatch(r"sha256:[0-9a-f]{64}", metadata["digest"]) is None:
        raise ValueError("An exact nonexpired artifact ID/size/digest is required")
    artifact = {"id": metadata["id"], "name": metadata["name"], "sizeBytes": metadata["size_in_bytes"], "digest": metadata["digest"]}
    existing = pins["artifacts"][dataset]
    if existing is not None and existing != artifact:
        raise ValueError("Artifact metadata differs from the previously pinned exact artifact")
    selected = targeted.TARGETS[dataset]
    full_hashes = manifest["expectedInputHashesByDataset"][dataset]
    return {"qualificationScope": targeted.SCOPE, "fullPopulationComplete": False, "isFullCorpusSweep": False,
        **{key: pins[key] for key in ["runId", "controllerSha", "controllerTree", "controllerBranch", "baselineSha", "candidateSha", "candidateTree", "pr"]},
        "jobId": job_id, "dataset": dataset, "repository": manifest["repository"], "artifact": artifact,
        "configs": {"A": copy.deepcopy(manifest["baseline"]), "B": copy.deepcopy(manifest["experiments"][0])},
        "inputHashes": {str(sample): full_hashes[str(sample)] for sample in selected}, "fullInputHashes": copy.deepcopy(full_hashes),
        "targetedSampleNumbers": selected, "targetedSampleCount": len(selected), "fullDatasetSampleCount": targeted.COUNTS[dataset],
        "controllerManifest": copy.deepcopy(manifest), "runtimeSourceHashes": copy.deepcopy(manifest["runtimeSourceHashes"]),
        "runSampleSourceSha256": manifest["runSampleSourceSha256"], "targetedWrapperSha256": pins["targetedWrapperSha256"],
        "harnessSourceHashes": copy.deepcopy(manifest["expectedHarnessSourceHashes"]), "validatorHashes": copy.deepcopy(manifest["expectedValidatorHashes"])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pins", type=pathlib.Path, required=True)
    parser.add_argument("--dataset", choices=list(targeted.TARGETS), required=True)
    parser.add_argument("--job-id", type=int, required=True)
    parser.add_argument("--artifact-metadata", type=pathlib.Path, required=True)
    parser.add_argument("--log", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    result = prepare(json.loads(args.pins.read_text()), args.dataset, args.job_id, json.loads(args.artifact_metadata.read_text()), args.log.read_text())
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: result[key] for key in ["qualificationScope", "runId", "jobId", "dataset", "artifact", "targetedSampleNumbers", "targetedSampleCount", "fullDatasetSampleCount", "fullPopulationComplete", "isFullCorpusSweep"]}))


if __name__ == "__main__":
    main()
