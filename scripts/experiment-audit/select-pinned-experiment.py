#!/usr/bin/env python3
"""Validate immutable experiment refs before handing them to checkout."""
import argparse
import json
import os
import pathlib
import re


def select(manifest_path, pr, dataset):
    manifest = json.loads(pathlib.Path(manifest_path).read_text())
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Unsupported experiment manifest schema")
    if dataset not in manifest["datasets"]:
        raise ValueError("Dataset is absent from the manifest")
    experiment = next(item for item in manifest["experiments"] if item["pr"] == pr)
    for key, sha in [("baselineSha", manifest["baselineSha"]), ("candidateSha", experiment["candidateSha"])]:
        if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise ValueError(f"{key} must be an exact immutable 40-character SHA")
    for config in [manifest["baseline"], experiment]:
        module = pathlib.PurePosixPath(config["solverModule"])
        if module.is_absolute() or ".." in module.parts or not str(module).startswith("lib/"):
            raise ValueError("Solver module must be a repository-relative lib/ file")
        if config["options"].get("effort") != 1 or config["options"].get("cacheProvider", "missing") is not None:
            raise ValueError("All experiments require explicit effort=1 and cacheProvider=null")
    return manifest, experiment


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--dataset", choices=["srj18", "srj24"], required=True)
    args = parser.parse_args()
    manifest, experiment = select(args.manifest, args.pr, args.dataset)
    outputs = {"baseline_sha": manifest["baselineSha"], "candidate_sha": experiment["candidateSha"], "repository": manifest["repository"]}
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.writelines(f"{key}={value}\n" for key, value in outputs.items())
    print(json.dumps({"pr": args.pr, "dataset": args.dataset, **outputs}, sort_keys=True))


if __name__ == "__main__":
    main()
