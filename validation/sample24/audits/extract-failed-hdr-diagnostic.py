#!/usr/bin/env python3
"""Summarize one genuine retained HDR failure; never invoke routing."""
import argparse
import hashlib
import json
import math
from pathlib import Path


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def read_one(root, name):
    files = list(Path(root).rglob(name))
    if len(files) != 1:
        raise ValueError(f"Expected one {name}, found {len(files)}")
    return json.loads(files[0].read_text()), files[0]


def strings(value):
    if isinstance(value, str):
        return {value}
    if isinstance(value, (list, tuple)):
        return set().union(*(strings(item) for item in value)) if value else set()
    if isinstance(value, dict):
        return strings(list(value.values()))
    return set()


def map_entries(value):
    if isinstance(value, dict) and value.get("__captureType") == "Map":
        return value["entries"]
    if isinstance(value, dict):
        return list(value.items())
    raise ValueError("Unknown captured map format")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture-dir", required=True)
    parser.add_argument("--proof-dir", required=True)
    parser.add_argument("--benchmark-dir", required=True)
    parser.add_argument("--binding", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    binding = json.loads(Path(args.binding).read_text())
    assert binding["binding"] == config
    assert binding["runId"] == config["runId"] and binding["headSha"] == config["transportCommit"]
    manifest, manifest_path = read_one(args.proof_dir, "runtime-source-manifest.json")
    assert hashlib.sha256(manifest_path.read_bytes()).hexdigest() == config["runtimeManifestSha256"]
    assert manifest["rootSource"] == config["source"]
    runtime, _ = read_one(args.proof_dir, "runtime-verification.json")
    assert runtime["ready"] is True and runtime["runtimeSourceFiles"] == 218
    assert runtime["localRuntimeReceiptSha256"] == config["runtimeReceiptSha256"]
    input_proof, _ = read_one(args.proof_dir, "input-verification.json")
    assert input_proof["rawSampleSha256"] == config["originalInputSha256"]
    if config.get("neighborsOnly"):
        print("[sample24-failed-hdr-neighbor-source-proof] " + json.dumps(
            {"runId": config["runId"], "head": config["transportCommit"],
             "runtimeSourceFiles": 218, "originalInputSha256": input_proof["rawSampleSha256"]}))
        return
    capture, path = read_one(args.capture_dir, "*.hdr.json")
    assert capture["kind"] == "ACTUAL_FAILED_HDR_RETAINED_CONSTRUCTOR_NOT_ROUTED_BOARD"
    assert capture["sampleNumber"] == 24 and capture["scenarioName"] == "sample024"
    assert capture["failedNodeIds"] == config["failedNodeIds"]
    params = capture["constructorParams"]
    nodes = [n for n in params["nodePortPoints"] if n["capacityMeshNodeId"] in capture["failedNodeIds"]]
    assert len(nodes) == 1 and nodes == capture["matchingFailedNodes"]
    node = nodes[0]
    bounds = {"minX": node["center"]["x"] - node["width"] / 2,
              "maxX": node["center"]["x"] + node["width"] / 2,
              "minY": node["center"]["y"] - node["height"] / 2,
              "maxY": node["center"]["y"] + node["height"] / 2}
    obstacles = params["obstacles"]
    assert len(obstacles) == 4418 and params["layerCount"] == 8
    nearby = []
    for index, obstacle in enumerate(obstacles):
        center = obstacle.get("center", {})
        radius = math.hypot(obstacle.get("width", 0), obstacle.get("height", 0)) / 2
        near = (center.get("x", math.inf) + radius >= bounds["minX"] - 2
                and center.get("x", -math.inf) - radius <= bounds["maxX"] + 2
                and center.get("y", math.inf) + radius >= bounds["minY"] - 2
                and center.get("y", -math.inf) - radius <= bounds["maxY"] + 2)
        if near or index in (1184, 1185):
            nearby.append({"constructorObstacleIndex": index, "obstacle": obstacle})
    aliases = strings(node) | strings([o["obstacle"].get("connectedTo", []) for o in nearby])
    conn_map = params["connMap"]
    assert conn_map.get("__captureType") == "ConnectivityMap"
    entries = map_entries(conn_map["netMap"])
    selected = []
    remaining = list(entries)
    for _ in range(10):
        matched = [entry for entry in remaining if strings(entry) & aliases]
        if not matched:
            break
        selected.extend(matched)
        aliases |= strings(matched)
        remaining = [entry for entry in remaining if entry not in matched]
    pf = params.get("nodePfById")
    if isinstance(pf, dict):
        pf = [entry for entry in map_entries(pf) if entry[0] == node["capacityMeshNodeId"]]
    color = params.get("colorMap", {})
    if isinstance(color, dict):
        color = {k: v for k, v in color.items() if k in aliases}
    excluded = {"nodePortPoints", "obstacles", "connMap", "nodePfById", "colorMap", "fixedHdRoutes"}
    options = {k: v for k, v in params.items() if k not in excluded}
    benchmark, benchmark_path = read_one(args.benchmark_dir, "benchmark-result.json")
    tests = benchmark["tests"]
    assert len(tests) == 1 and tests[0]["sampleNumber"] == 24 and tests[0]["didSolve"] is False
    pairs = node.get("portPointsInPairs", [])
    nearby_fixed = []
    for route in params.get("fixedHdRoutes", []):
        points = route.get("route", []) + route.get("vias", [])
        if points and (min(p["x"] for p in points) <= bounds["maxX"] + 2
                       and max(p["x"] for p in points) >= bounds["minX"] - 2
                       and min(p["y"] for p in points) <= bounds["maxY"] + 2
                       and max(p["y"] for p in points) >= bounds["minY"] - 2):
            nearby_fixed.append(route)
    output = {"kind": "ACTUAL_FAILED_HDR_NODE_DIAGNOSTIC_NOT_ROUTED_BOARD", "runId": config["runId"],
              "producerHead": config["transportCommit"], "producerSource": config["source"],
              "captureSha256": hashlib.sha256(path.read_bytes()).hexdigest(), "captureBytes": path.stat().st_size,
              "actualCaptureKeys": sorted(capture), "actualConstructorKeys": sorted(params),
              "retainedConstructorNodeCount": len(params["nodePortPoints"]), "error": capture.get("error"),
              "failedNode": node, "bounds": bounds, "constructorOptions": options,
              "portPairCount": len(pairs), "crossLayerPortPairCount": sum(a["z"] != b["z"] for a, b in pairs),
              "fullObstacleCount": len(obstacles), "fullObstaclesCanonicalSha256": digest(obstacles),
              "nearbyObstacleCount": len(nearby), "nearbyObstacles": nearby[:128],
              "nearbyObstacleRecordsTruncated": len(nearby) > 128,
              "raw1184And1185": [{"constructorObstacleIndex": i, "obstacle": obstacles[i]} for i in (1184, 1185)],
              "connMapEncoding": conn_map["__captureType"], "fullNetMapCanonicalSha256": digest(conn_map["netMap"]),
              "matchingConnMapEntries": selected, "nodePf": pf, "colorMapSubset": color,
              "fixedHdRouteCount": len(params.get("fixedHdRoutes", [])),
              "nearbyActualFixedHdRoutes": nearby_fixed,
              "benchmarkResultSha256": hashlib.sha256(benchmark_path.read_bytes()).hexdigest(),
              "actualBenchmarkTest": {k: v for k, v in tests[0].items() if k != "benchmarkSnapshot"},
              "sourceOriginalInputSha256": input_proof["rawSampleSha256"],
              "familyStatsAvailableInOriginalCapture": False,
              "statsQualification": "Original capture retains constructor data and the actual aggregated error, not solver-instance counters or rejected candidate routes. No statistics are invented.",
              "routingInvoked": False, "fullBoardRerun": False}
    destination = Path(args.out_dir)
    destination.mkdir(parents=True, exist_ok=False)
    (destination / "failed-hdr-diagnostic.json").write_text(json.dumps(output, indent=2) + "\n")
    print("[sample24-failed-hdr-tasks] " + json.dumps({"failedNode": node, "bounds": bounds,
          "portPairCount": len(pairs)}, separators=(",", ":")))
    print("[sample24-failed-hdr-diagnostic] " + json.dumps(
        {key: value for key, value in output.items() if key not in {"matchingConnMapEntries", "nearbyObstacles"}},
        separators=(",", ":")))
    for entry in selected:
        print("[sample24-failed-hdr-conn-entry] " + json.dumps(entry, separators=(",", ":")))
    for obstacle in nearby[:128]:
        print("[sample24-failed-hdr-nearby-obstacle] " + json.dumps(obstacle, separators=(",", ":")))


if __name__ == "__main__":
    main()
