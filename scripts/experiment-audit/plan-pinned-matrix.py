#!/usr/bin/env python3
"""Dispatch only explicitly requested, fully pinned experiment populations."""
import argparse
import importlib.util
import json
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pinned_selector", ROOT / "select-pinned-experiment.py")
selector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selector)


def create_matrix(path):
    manifest = json.loads(pathlib.Path(path).read_text())
    requested = manifest.get("runPrNumbers")
    if not isinstance(requested, list) or not requested or any(type(item) is not int for item in requested) or len(set(requested)) != len(requested):
        raise ValueError("runPrNumbers must explicitly name a nonempty unique integer PR list")
    available = {item["pr"] for item in manifest["experiments"]}
    if any(pr not in available for pr in requested):
        raise ValueError("Requested PR is absent from the experiment manifest")
    include = []
    for pr in requested:
        for dataset in manifest["datasets"]:
            selector.select(path, pr, dataset)
            include.append({"pr": pr, "dataset": dataset})
    return {"include": include}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    args = parser.parse_args()
    matrix = create_matrix(args.manifest)
    encoded = json.dumps(matrix, separators=(",", ":"))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.write("matrix=" + encoded + "\n")
    print(encoded)


if __name__ == "__main__":
    main()
