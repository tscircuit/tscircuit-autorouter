#!/usr/bin/env python3
"""Diagnostic-only harness changes; source solver and timeout policy stay native."""
import argparse
import hashlib
import importlib.util
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError("Profile harness anchor differs: " + old[:80])
    return text.replace(old, new, 1)


def profile_parent(text):
    text = replace_once(text,
        '): ChildProcessWithoutNullStreams => {\n  const command = cpuIds ? "taskset" : process.execPath',
        '): ChildProcessWithoutNullStreams => {\n  if (!process.env.BOTTLENECK_PROFILE_DIRECTORY) throw new Error("Missing diagnostic profile directory")\n  const profileArgs = ["--cpu-prof", "--cpu-prof-interval=1000", "--cpu-prof-dir=" + process.env.BOTTLENECK_PROFILE_DIRECTORY]\n  const command = cpuIds ? "taskset" : process.execPath')
    text = replace_once(text,
        '        process.execPath,\n        "scripts/benchmark/benchmark.child.ts",',
        '        process.execPath,\n        ...profileArgs,\n        "scripts/benchmark/benchmark.child.ts",')
    text = replace_once(text,
        ': ["scripts/benchmark/benchmark.child.ts"]',
        ': [...profileArgs, "scripts/benchmark/benchmark.child.ts"]')
    # The official parent kills workers even after a successful result. EOF on
    # normal final shutdown lets Bun flush its profiler; timeout/replacement
    # paths retain SIGKILL. No routing result or solver source is changed.
    text = replace_once(text,
        '      slot.child.kill("SIGKILL")',
        '      if (context.startsWith("shutting down worker ")) slot.child.stdin.end()\n      else slot.child.kill("SIGKILL")')
    return text


def profile_adapter(text):
    return replace_once(text,
        '  const observerMetadata: Record<string, unknown> = { campaign:',
        '  const observerMetadata: Record<string, unknown> = { profilePid: process.pid, profilePerformanceTimeOriginMs: performance.timeOrigin, profileClockOriginPolicy: "ACTUAL_NAMED_MARKER_BRACKETS", campaign:')


def profile_child(text):
    prefix = 'import { bottleneckProfileStartMarker, bottleneckProfileEndMarker, recordBottleneckProfileMarker } from "./profile-clock-markers"\n'
    if text.startswith("#!"):
        shebang, remainder = text.split("\n", 1)
        text = shebang + "\n" + prefix + remainder
    else:
        text = prefix + text
    text = replace_once(text, 'const rl = readline.createInterface({', 'recordBottleneckProfileMarker("bottleneckProfileStartMarker", bottleneckProfileStartMarker())\nconst rl = readline.createInterface({')
    text = replace_once(text, '    })\n    peakRssBytes = process.resourceUsage().maxRSS * 1024\n    const payload: WorkerResultMessage', '    })\n    recordBottleneckProfileMarker("bottleneckProfileEndMarker", bottleneckProfileEndMarker())\n    peakRssBytes = process.resourceUsage().maxRSS * 1024\n    const payload: WorkerResultMessage')
    # A diagnostic worker has exactly one task. After parent EOF, force normal
    # Bun exit even if an imported package retained an unrelated async handle.
    # CLI profiling flushes on normal exit; native timeout SIGKILL is unchanged.
    return text.rstrip() + "\nprocess.exit(0)\n"


def prepare(controller, target, expected_sha):
    spec = importlib.util.spec_from_file_location("original_prepare", ROOT / "prepare-pinned-harness.py")
    original = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(original)
    provenance = original.prepare(controller, target, expected_sha)
    parent = target / "scripts/benchmark/index.ts"
    adapter = target / "scripts/benchmark/experiment-audit-adapter.ts"
    child = target / "scripts/benchmark/benchmark.child.ts"
    unchanged = {name: original.digest(target / name) for name in [
        "scripts/benchmark/benchmark-run-task.ts",
        "scripts/benchmark/phase-checkpoint-observer.ts", "benchmark.sh"]}
    parent.write_text(profile_parent(parent.read_text()))
    adapter.write_text(profile_adapter(adapter.read_text()))
    child.write_text(profile_child(child.read_text()))
    marker_path = target / "scripts/benchmark/profile-clock-markers.ts"
    marker_path.write_bytes((ROOT / "profile-clock-markers.ts").read_bytes())
    assert all(original.digest(target / name) == value for name, value in unchanged.items())
    provenance.update({"profileDiagnosticOnly": True,
        "profileParentHash": original.digest(parent),
        "profileAdapterHash": original.digest(adapter),
        "profileChildHash": original.digest(child),
        "profileClockMarkerSourceHash": original.digest(marker_path),
        "profileSourcePatchHash": original.digest(pathlib.Path(__file__)),
        "unchangedOfficialTaskChildObserverShell": unchanged,
        "profileFlushPolicy": "Normal final shutdown uses stdin EOF; native timeout and replacement SIGKILL retained. Parent shutdown bound10000ms is post-routing only.",
        "profileClock": "Actual named start/end marker performance brackets constrain sampled epoch offset. Missing/inconsistent markers leave exact phase CPU alignment UNKNOWN; whole-profile caller ancestry remains available."})
    (target / "experiment-harness-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    return provenance


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--controller", type=pathlib.Path, required=True)
    parser.add_argument("--target", type=pathlib.Path, required=True)
    parser.add_argument("--expected-sha", required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.controller, args.target, args.expected_sha), sort_keys=True))
