#!/usr/bin/env python3
"""Verify and reconstruct the chunked benchmark payload from saved job logs."""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import re


def extract(text):
    starts = re.findall(r"HD_REFINEMENT_SUMMARY_BEGIN chunks=(\d+) gzipSha256=([0-9a-f]{64}) payloadSha256=([0-9a-f]{64})", text)
    if len(set(starts)) != 1:
        raise ValueError("Expected one unambiguous summary header")
    count, packed_sha, raw_sha = starts[0]
    count = int(count)
    entries = re.findall(r"HD_REFINEMENT_SUMMARY_CHUNK (\d+)/(\d+)=([A-Za-z0-9+/=]+)", text)
    chunks = {}
    for number, total, chunk in entries:
        number = int(number)
        if int(total) != count or not 1 <= number <= count or number in chunks and chunks[number] != chunk:
            raise ValueError("Conflicting summary chunks")
        chunks[number] = chunk
    if set(chunks) != set(range(1, count + 1)):
        raise ValueError("Missing summary chunks; preserve incomplete log evidence")
    if f"HD_REFINEMENT_SUMMARY_END gzipSha256={packed_sha}" not in text:
        raise ValueError("Summary terminator missing")
    packed = base64.b64decode("".join(chunks[n] for n in range(1, count + 1)), validate=True)
    if hashlib.sha256(packed).hexdigest() != packed_sha:
        raise ValueError("Summary gzip digest mismatch")
    raw = gzip.decompress(packed)
    if hashlib.sha256(raw).hexdigest() != raw_sha:
        raise ValueError("Summary payload digest mismatch")
    return json.loads(raw), packed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    text = args.log.read_text()
    # Accept the raw GitHub-tool JSON response as well as plain job log text.
    try:
        value = json.loads(text)
    except ValueError:
        value = None
    def strings(item):
        if isinstance(item, str):
            return [item]
        if isinstance(item, dict):
            return [text for child in item.values() for text in strings(child)]
        if isinstance(item, list):
            return [text for child in item for text in strings(child)]
        return []
    if value is not None:
        text = "\n".join(strings(value))
    payload, packed = extract(text)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "multiarm-ci-summary.json").write_text(json.dumps(payload, indent=2) + "\n")
    (args.out / "multiarm-ci-summary.json.gz").write_bytes(packed)
    print(json.dumps({"complete": payload["ci"].get("complete"), "observed": payload["summary"]["resultCount"], "gzipSha256": hashlib.sha256(packed).hexdigest()}))
