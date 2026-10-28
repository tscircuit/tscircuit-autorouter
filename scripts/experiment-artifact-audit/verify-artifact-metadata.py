#!/usr/bin/env python3
"""Read and verify one immutable GitHub Actions artifact's metadata."""
import argparse
import json
import os
import pathlib
import urllib.request


def validate(metadata, expected):
    artifact = expected["artifact"]
    pairs = [("id", metadata.get("id"), artifact["id"]), ("name", metadata.get("name"), artifact["name"]),
        ("size_in_bytes", metadata.get("size_in_bytes"), artifact["sizeBytes"]), ("digest", metadata.get("digest"), artifact["digest"]),
        ("workflow_run.id", metadata.get("workflow_run", {}).get("id"), expected["runId"]),
        ("workflow_run.head_sha", metadata.get("workflow_run", {}).get("head_sha"), expected["controllerSha"]),
        ("expired", metadata.get("expired"), False)]
    return [{"field": key, "observed": observed, "expected": wanted} for key, observed, wanted in pairs if observed != wanted]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    expected = json.loads(args.expected.read_text())
    url = f'https://api.github.com/repos/{expected["repository"]}/actions/artifacts/{expected["artifact"]["id"]}'
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"], "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(request, timeout=30) as response:
        metadata = json.load(response)
    selected = {key: metadata.get(key) for key in ["id", "name", "size_in_bytes", "digest", "expired", "workflow_run"]}
    issues = validate(selected, expected)
    report = {"metadata": selected, "issues": issues, "qualification": "EXACT_ARTIFACT_METADATA_VERIFIED" if not issues else "ARTIFACT_METADATA_MISMATCH"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print("ARTIFACT_SOURCE_METADATA_JSON " + json.dumps(report, separators=(",", ":")))
    if issues:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
