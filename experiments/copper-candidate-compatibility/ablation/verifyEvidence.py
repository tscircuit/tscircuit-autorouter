#!/usr/bin/env python3
"""Verify the source-pinned causal evidence without executing a router."""
import collections
import gzip
import hashlib
import json
import math
import pathlib


def digest(content):
    hasher = hashlib.sha256()
    hasher.update(content)
    value = hasher.hexdigest()
    if len(value) != 64:
        raise ValueError("Unexpected SHA256 digest length")
    return value


def read_evidence(directory):
    manifest = json.loads((directory / "manifest.json").read_text())
    compressed = []
    for part in manifest["parts"]:
        path = pathlib.PurePosixPath(part["path"])
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Evidence part is not relative")
        content = (directory / path).read_bytes()
        if len(content) != part["bytes"] or digest(content) != part["sha256"]:
            raise ValueError(f"Evidence part differs: {path}")
        compressed.append(content)
    content = b"".join(compressed)
    if len(content) != manifest["compressedBytes"] or digest(content) != manifest["compressedSha256"]:
        raise ValueError("Compressed evidence differs")
    raw = gzip.decompress(content)
    if len(raw) != manifest["decompressedBytes"] or digest(raw) != manifest["decompressedSha256"]:
        raise ValueError("Decompressed evidence differs")
    return json.loads(raw)


def verify_evidence(evidence, repository):
    for name, expected in evidence["sourceFileHashes"].items():
        if digest((repository / name).read_bytes()) != expected:
            raise ValueError(f"Source differs from captured experiment: {name}")
    payloads = evidence["jsonPayloads"]
    for expected, content in payloads.items():
        if digest(content.encode()) != expected:
            raise ValueError("Raw input/copper/finding payload differs")
        json.loads(content)
    schema = evidence["clockLedgerSchema"]
    verified_rows = 0
    prior_via_moves = []
    results = []
    for case in evidence["cases"]:
        hashes = set()
        for entry in case["arms"]:
            result = entry["result"]
            hashes.add(result["inputHash"])
            if entry["originalInputPayload"] != result["inputHash"]:
                raise ValueError("Original input identity differs")
            if entry["finalCopperPayload"] != result["rawTraceHash"]:
                raise ValueError("Final raw copper identity differs")
            columns = entry["clockLedgerColumns"]
            count = entry["clockLedgerRowCount"]
            if len(columns) != 5 or any(len(column) != count for column in columns):
                raise ValueError("Clock ledger columns are incomplete")
            policy_sum = 0
            preempted_sum = 0
            for node, kind, clock, limit, status in zip(*columns):
                if not 0 <= node < len(schema["nodes"]) or not 0 <= kind < len(schema["classes"]):
                    raise ValueError("Clock ledger identity is outside the dictionaries")
                if status not in [0, 1, 2, 3]:
                    raise ValueError("Unknown clock ledger status")
                if schema["classes"][kind] == "PriorityDagIntraNodeSolver":
                    if not math.isfinite(limit) or not 0 <= clock <= limit:
                        raise ValueError("Priority clock exceeds its original allowance")
                    policy_sum += clock
                    if status == 0:
                        preempted_sum += clock
            if policy_sum != result["allPriorityChargedIterations"] or preempted_sum != result["preemptedPriorityChargedIterations"]:
                raise ValueError("Complete/preempted Priority clocks do not match")
            for field, payload in [("referenceChecks", "referenceFindingsPayload"), ("libraryChecks", "libraryFindingsPayload")]:
                errors = json.loads(payloads[entry[payload]])
                counts = dict(collections.Counter(error["type"] for error in errors))
                if len(errors) != result[field]["count"] or counts != result[field]["byType"]:
                    raise ValueError("Original per-board findings do not match their summary")
            traces = json.loads(payloads[entry["finalCopperPayload"]])
            points = sum(len(trace["route"]) for trace in traces)
            vias = sum(point["route_type"] == "via" for trace in traces for point in trace["route"])
            if points != result["routePointCount"] or vias != result["routeViaCount"]:
                raise ValueError("Raw copper count differs")
            verified_rows += count
            results.append({"sample": case["sample"], "arm": result["arm"], "priorityClock": policy_sum, "rawVias": vias, "rawPoints": points})
        if len(hashes) != 1:
            raise ValueError("Ablation arms use different inputs")
        for replay in case.get("geometryProofReplays", []):
            original = next(entry["result"] for entry in case["arms"] if entry["result"]["arm"] == replay["arm"])
            if not replay["replaySignatures"] or any(original[key] != value for key, value in replay["replaySignatures"].items()):
                raise ValueError("Retained geometry replay signatures differ from the original work/output")
            for event in replay["events"]:
                if event["outcome"] != "published":
                    continue
                for change in event["changedGeometry"]:
                    before = change["beforeRoute"]
                    after = change["afterRoute"]
                    if before["connectionName"] != after["connectionName"] or before["rootConnectionName"] != after["rootConnectionName"]:
                        raise ValueError("Prior witness owner changed")
                    if len(before["vias"]) == len(after["vias"]) == 1:
                        a, b = before["vias"][0], after["vias"][0]
                        distance = math.hypot(a["x"] - b["x"], a["y"] - b["y"])
                        if distance > 0:
                            prior_via_moves.append({"sample": case["sample"], "arm": replay["arm"], "node": event["nodeId"], "distance": distance})
        if case["sample"] == 12:
            for entry in case["arms"]:
                arm = entry["result"]["arm"]
                expected_y = 9.8 if arm in ["control", "soft-only"] else 9.4
                opposite_y = 9.4 if expected_y == 9.8 else 9.8
                traces = json.loads(payloads[entry["finalCopperPayload"]])
                points = [point for trace in traces if trace["connection_name"] == "source_trace_0" for point in trace["route"] if point["route_type"] == "via" and math.isclose(point["x"], 18.8, abs_tol=1e-12)]
                matches = [point for point in points if math.isclose(point["y"], expected_y, abs_tol=1e-12)]
                if len(matches) != 1 or any(math.isclose(point["y"], opposite_y, abs_tol=1e-12) for point in points):
                    raise ValueError("Final source_trace_0 does not have the claimed old/new via site")
                point = matches[0]
                if {point["from_layer"], point["to_layer"]} != {"top", "inner2"} or point["via_diameter"] != 0.3 or point["via_hole_diameter"] != 0.15:
                    raise ValueError("Final raw via layers/dimensions differ")
    return {"caseCount": len(evidence["cases"]), "armCount": len(results), "verifiedPortfolioCandidateRows": verified_rows, "rawPayloadCount": len(payloads), "candidatePublishedPriorViaRelocations": prior_via_moves, "publicationScope": "Inside a PriorityDag CSP candidate; winning portfolio/growth attempt identity is not recorded", "results": results}


if __name__ == "__main__":
    directory = pathlib.Path(__file__).resolve().parent
    repository = directory.parents[2]
    result = verify_evidence(read_evidence(directory / "evidence"), repository)
    print(json.dumps({"verified": True, **result}, separators=(",", ":")))
