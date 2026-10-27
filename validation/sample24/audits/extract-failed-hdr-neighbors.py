#!/usr/bin/env python3
"""Read actual neighboring port families and compare exact binary64 geometry."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct


UNDEFINED = {"__captureType": "Undefined"}
NON_GEOMETRY = {"circuitJsonMetadata", "componentId", "obstacleId", "connectedTo", "__zLayers"}


def canonical_binary64(value):
    """Cross-language recipe: sorted JSON, numbers replaced with big-endian f64 hex."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        number = float(value)
        if number == 0:
            number = 0.0
        return {"__ieee754binary64be": struct.pack(">d", number).hex()}
    if isinstance(value, list):
        return [canonical_binary64(item) for item in value]
    if isinstance(value, dict):
        return {key: canonical_binary64(item) for key, item in value.items() if item != UNDEFINED}
    raise TypeError(type(value).__name__)


def digest(value):
    return hashlib.sha256(json.dumps(canonical_binary64(value), sort_keys=True,
                                    separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def shape(value, depth=0):
    if isinstance(value, dict):
        return {"type": "object", "keys": list(value)[:16], "keyCount": len(value),
                "tag": value.get("__captureType"),
                "children": {key: shape(item, depth + 1) for key, item in list(value.items())[:6]}
                if depth < 3 else None}
    if isinstance(value, list):
        return {"type": "array", "length": len(value),
                "firstItems": [shape(item, depth + 1) for item in value[:2]] if depth < 4 else None}
    return {"type": type(value).__name__, "sample": value}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    paths = list(Path(args.capture_dir).rglob("*.hdr.json"))
    assert len(paths) == 1
    raw = paths[0].read_bytes()
    capture = json.loads(raw)
    assert capture["kind"] == "ACTUAL_FAILED_HDR_RETAINED_CONSTRUCTOR_NOT_ROUTED_BOARD"
    config = json.loads(Path(args.config).read_text())
    assert capture["failedNodeIds"] == config["failedNodeIds"]
    params = capture["constructorParams"]
    failed = capture["matchingFailedNodes"][0]
    proposed = config.get("proposedViaForNeighborhoodOnly", failed["center"])
    margin = config["neighborPortMargin"]
    assert 0 < margin <= 2
    bounds = {"minX": min(failed["center"]["x"] - failed["width"] / 2, proposed["x"]) - margin,
              "maxX": max(failed["center"]["x"] + failed["width"] / 2, proposed["x"]) + margin,
              "minY": min(failed["center"]["y"] - failed["height"] / 2, proposed["y"]) - margin,
              "maxY": max(failed["center"]["y"] + failed["height"] / 2, proposed["y"]) + margin}
    selected = []
    for node in params["nodePortPoints"]:
        if any(bounds["minX"] <= point["x"] <= bounds["maxX"]
               and bounds["minY"] <= point["y"] <= bounds["maxY"] for point in node["portPoints"]):
            selected.append(node)
    obstacles = params["obstacles"]
    assert len(obstacles) == 4418
    geometry = [{key: value for key, value in obstacle.items() if key not in NON_GEOMETRY}
                for obstacle in obstacles]
    hashes = [digest(item) for item in geometry]
    conn = params["connMap"]
    report = {"kind": "ACTUAL_FAILED_HDR_NEIGHBOR_AND_GEOMETRY_HASH_DIAGNOSTIC",
              "captureSha256": hashlib.sha256(raw).hexdigest(), "failedNodeId": failed["capacityMeshNodeId"],
              "referencePointForNeighborhoodOnly": proposed, "neighborPortMargin": margin, "selectionBounds": bounds,
              "selectionRule": "All actual constructor nodes with any actual port inside failed-node/proposed-via union expanded by the explicitly configured margin; every selected node retains all of its ports and pairs.",
              "selectedNodeCount": len(selected), "selectedActualNodes": selected,
              "connectivityEncodingShape": shape(conn),
              "physicalGeometryExcludedKeys": sorted(NON_GEOMETRY),
              "physicalGeometryHashRecipe": "canonical_binary64 in extract-failed-hdr-neighbors.py: omit tagged Undefined object properties; numeric values (including layer integers) become {__ieee754binary64be:16 lowercase hex digits of IEEE754 big-endian double}, normalize negative zero; sorted compact ASCII JSON; SHA256. Preserve every other geometry key and array order.",
              "allObstacleGeometryCanonicalBinary64Sha256": digest(geometry),
              "perIndexObstacleGeometrySha256": hashes,
              "allObstacleFieldKeys": sorted({key for obstacle in obstacles for key in obstacle}),
              "routingInvoked": False, "candidateRouteSolvedOrAccepted": False}
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "failed-hdr-neighbor-diagnostic.json").write_text(json.dumps(report, indent=2) + "\n")
    summary = {key: value for key, value in report.items()
               if key not in {"selectedActualNodes", "perIndexObstacleGeometrySha256"}}
    print("[sample24-failed-hdr-neighbor-summary] " + json.dumps(summary, separators=(",", ":")))
    for node in selected:
        print("[sample24-failed-hdr-neighbor-node] " + json.dumps(node, separators=(",", ":")))
    for offset in range(0, len(hashes), 128):
        print("[sample24-failed-hdr-physical-hashes] " + json.dumps(
            {"startIndex": offset, "sha256": hashes[offset:offset + 128]}, separators=(",", ":")))


if __name__ == "__main__":
    main()
