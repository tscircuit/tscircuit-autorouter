"""Summarize a standard Bun CPU profile; never print the raw profile."""

from collections import Counter
import hashlib
import json
from pathlib import Path
import sys


def summarize(profile: dict) -> dict:
    nodes = {node["id"]: node for node in profile["nodes"]}
    if len(nodes) != len(profile["nodes"]):
        raise ValueError("Duplicate profiler node IDs")
    parents = {}
    for node in nodes.values():
        for child in node.get("children", []):
            if child not in nodes or child in parents:
                raise ValueError("CPU profile must have a unique-parent call tree")
            parents[child] = node["id"]
    samples = profile["samples"]
    if not samples or len(profile["timeDeltas"]) != len(samples):
        raise ValueError("Missing CPU samples or timing deltas")
    if profile["endTime"] <= profile["startTime"] or any(delta < 0 for delta in profile["timeDeltas"]):
        raise ValueError("Invalid profiler timing")
    keys = {node_id: tuple(node["callFrame"].get(key, "") for key in ["functionName", "url", "lineNumber", "columnNumber"]) for node_id, node in nodes.items()}
    self_counts = Counter(samples)
    inclusive = Counter()
    functions = Counter()
    paths = {}
    for leaf, count in self_counts.items():
        if leaf not in nodes:
            raise ValueError("Sample references an unknown profiler node")
        path = []
        current = leaf
        seen_nodes = set()
        while current is not None:
            if current in seen_nodes:
                raise ValueError("Cycle in profiler tree")
            seen_nodes.add(current)
            path.append(current)
            current = parents.get(current)
        paths[leaf] = path
        functions[keys[leaf]] += count
        # Count recursive instances once per stack for function-level inclusion.
        for key in {keys[node_id] for node_id in path}:
            inclusive[key] += count

    def frame(key: tuple) -> dict:
        name, url, line, column = key
        return {"function": str(name)[:140], "source": str(url)[-260:],
                "line": line + 1 if isinstance(line, int) and line >= 0 else None,
                "column": column + 1 if isinstance(column, int) and column >= 0 else None,
                "textTruncated": len(str(name)) > 140 or len(str(url)) > 260}

    def observation(key: tuple) -> dict:
        return {**frame(key), "selfSamples": functions[key], "selfSamplePercent": round(100 * functions[key] / len(samples), 3),
                "inclusiveSamples": inclusive[key], "inclusiveSamplePercent": round(100 * inclusive[key] / len(samples), 3)}

    gc_names = {"(garbage collector)", "(GC)"}
    gc_nodes = {node_id for node_id, node in nodes.items() if node["callFrame"].get("functionName") in gc_names}
    gc_samples = sum(count for leaf, count in self_counts.items() if gc_nodes.intersection(paths[leaf]))
    packet = {"version": 1, "scope": "Full render worker, including imports, bus phases and later P9; assessor and controller excluded",
              "phaseCorrelation": "Unavailable: existing phase times begin after module setup; no exact profile-to-phase clock anchor was added",
              "timingInterpretation": "Sampling shares are observations, not exact CPU milliseconds or a speedup; inclusive shares overlap",
              "sampleCount": len(samples), "nodeCount": len(nodes), "profileDurationMs": (profile["endTime"] - profile["startTime"]) / 1000,
              "topSelf": [observation(key) for key, _ in functions.most_common(8)],
              "topInclusive": [observation(key) for key in [key for key, _ in inclusive.most_common() if key[0] != "(root)"][:8]],
              "gc": {"status": "explicit-profiler-markers" if gc_nodes else "unavailable-no-explicit-gc-marker", "explicitSamples": gc_samples if gc_nodes else None,
                     "sampleSharePercent": round(100 * gc_samples / len(samples), 3) if gc_nodes else None,
                     "limitation": "Only explicit profiler GC markers are classified; absent labels do not establish zero GC work"}}
    if len(json.dumps(packet, ensure_ascii=False, separators=(",", ":")).encode()) > 22000:
        raise ValueError("CPU summary exceeds bounded observation size")
    return packet


if __name__ == "__main__":
    folder = Path(sys.argv[1])
    profile_path = folder / "cpu-profile/render.cpuprofile"
    raw = profile_path.read_bytes()
    packet = summarize(json.loads(raw))
    packet["rawProfile"] = {"file": "cpu-profile/render.cpuprofile", "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "transport": "Ordinary artifact only; raw payload is not printed"}
    progress_path = folder / "progress.json"
    if progress_path.exists():
        progress = json.loads(progress_path.read_text())
        packet["renderContext"] = {key: progress[key] for key in ["id", "cohort", "status", "sourceSha256", "captureDeadlineMs", "hardDeadlineMs", "assessmentDeadlineMs"]}
        packet["runtimePackages"] = [{key: package[key] for key in ["name", "version", "entrySha256"]} for package in progress["runtime"]["packages"]]
        packet["phaseWallContext"] = [{key: phase.get(key) for key in ["name", "status", "startedMs", "elapsedMs", "connections", "inputSha256"]} for phase in progress["phases"]]
    else:
        packet["renderContext"] = None
        packet["phaseWallContext"] = []
    encoded = json.dumps(packet, ensure_ascii=False, separators=(",", ":"))
    if len(("CPU_PROFILE_SUMMARY " + encoded).encode()) >= 24 * 1024:
        raise ValueError("Wrapped CPU summary exceeds 24KiB")
    (folder / "cpu-profile-summary.json").write_text(json.dumps(packet, indent=2) + "\n")
    print("CPU_PROFILE_SUMMARY " + encoded)
    for title, rows in [("Top self sample shares", packet["topSelf"]), ("Top inclusive sample shares (overlap)", packet["topInclusive"])]:
        print(f"\n{title}\n")
        print("| Function | Source (1-based line:column) | Self samples % | Inclusive samples % |")
        print("| --- | --- | ---: | ---: |")
        for row in rows:
            print(f"| {row['function'].replace('|', '/')} | {row['source'].replace('|', '/')}:{row['line']}:{row['column']} | {row['selfSamplePercent']} | {row['inclusiveSamplePercent']} |")
