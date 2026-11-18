#!/usr/bin/env python3
"""Run the predetermined published/candidate pair on one worker, once each."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def host_snapshot():
    paths = ["/proc/sys/kernel/random/boot_id", "/proc/loadavg", "/proc/stat", "/proc/pressure/cpu", "/proc/pressure/memory", "/sys/fs/cgroup/cpu.stat", "/sys/fs/cgroup/cpu.max", "/sys/fs/cgroup/cpu.pressure", "/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.peak", "/sys/fs/cgroup/memory.events"]
    values = {}
    for path in paths:
        source = Path(path)
        values[path] = source.read_text() if source.is_file() else None
    return {"monotonicSeconds": time.monotonic(), "runnerName": os.environ.get("RUNNER_NAME"), "githubRunId": os.environ.get("GITHUB_RUN_ID"), "hostname": platform.node(), "machine": platform.machine(), "cpuCount": os.cpu_count(), "cpuAffinity": sorted(os.sched_getaffinity(0)), "files": values}


controller = Path(__file__).resolve().parent
root = Path(sys.argv[1]).resolve()
plan = json.loads((controller / "core-pour-same-worker-plan.json").read_text())
runtime_plan = json.loads((controller / "core-reentrancy-plan.json").read_text())
assert plan["frozen"] and plan["laneOrder"] == ["published", "candidate"]
assert plan["limitsMs"] == {"capture": 900000, "hard": 960000, "assessment": 180000}
for name, digest in plan["controllerFiles"].items():
    assert sha(controller / name) == digest
assert subprocess.check_output(["bun", "--version"], text=True).strip() == "1.4.3"
proof = root / "same-worker"
proof.mkdir()
initial_host = host_snapshot()
assert initial_host["machine"] in ["aarch64", "arm64"]
assert len(initial_host["cpuAffinity"]) == 8, "The diagnostic needs the same eight-CPU worker policy"
(proof / "initial-worker.json").write_text(json.dumps(initial_host, indent=2) + "\n")
guard = ["python3", str(controller / "prepare-core-reentrancy.py"), str(root)]
case = json.loads((root / "cases/imx6-spaced.json").read_text())
assert [case["captureDeadlineMs"], case["hardDeadlineMs"], case["assessmentDeadlineMs"]] == [900000, 960000, 180000]
lane_records = []
for lane in plan["laneOrder"]:
    lane_proof = proof / lane
    lane_proof.mkdir()
    if lane == "candidate":
        subprocess.run([*guard, "candidate", "imx6", "spaced"], check=True)
    subprocess.run([*guard, "verify", "imx6", "spaced"], check=True)
    manifest = json.loads((root / "runtime-manifest.json").read_text())
    assert manifest["sourceOverrides"] is (lane == "candidate")
    core = next(row for row in manifest["packages"] if row["name"] == "@tscircuit/core")
    expected_files = [{**row, "afterSha256": row["beforeSha256"] if lane == "published" else row["afterSha256"]} for row in runtime_plan["runtimeChanges"]]
    assert core["entrySha256"] == next(row["afterSha256"] for row in expected_files if row["path"] == "dist/index.js")
    task = {**case, "experiment": f"same_worker_{lane}", "observeRenderCosts": True, "restorePublishedCoreBeforeAssessment": str(root), "runtimeChunkProof": {"changedFiles": expected_files, "expectPreviewPhase": lane == "candidate"}, "dependencyOverrides": manifest["dependencyOverrides"]}
    task_path = root / "cases" / f"same-worker-{lane}-imx6-spaced.json"
    task_path.write_text(json.dumps(task, indent=2) + "\n")
    before = host_snapshot()
    assert before["files"]["/proc/sys/kernel/random/boot_id"] == initial_host["files"]["/proc/sys/kernel/random/boot_id"]
    assert before["hostname"] == initial_host["hostname"] and before["cpuAffinity"] == initial_host["cpuAffinity"]
    (lane_proof / "host-before.json").write_text(json.dumps(before, indent=2) + "\n")
    shutil.copyfile(root / "runtime-manifest.json", lane_proof / "active-runtime-manifest.json")
    output = root / "results" / lane / "imx6/spaced"
    command = ["bun", str(controller / "run-one.ts"), str(task_path), str(output)]
    completed = subprocess.run(command)
    after = host_snapshot()
    (lane_proof / "host-after.json").write_text(json.dumps(after, indent=2) + "\n")
    subprocess.run([*guard, "verify", "imx6", "spaced"], check=True)
    restored = json.loads((root / "runtime-manifest.json").read_text())
    assert restored["sourceOverrides"] is False
    shutil.copyfile(root / "core-reentrancy/assessment-runtime-restored.json", lane_proof / "assessment-runtime-restored.json")
    shutil.copyfile(root / "runtime-manifest.json", lane_proof / "restored-runtime-manifest.json")
    lane_records.append({"lane": lane, "command": command, "controllerExitCode": completed.returncode, "activeRuntimeManifestSha256": sha(lane_proof / "active-runtime-manifest.json"), "sourceSha256": task["sourceSha256"], "results": str(output), "hostBeforeSha256": sha(lane_proof / "host-before.json"), "hostAfterSha256": sha(lane_proof / "host-after.json")})
    (proof / "lanes.json").write_text(json.dumps(lane_records, indent=2) + "\n")
    # A render timeout/failure remains a result, and the other planned lane runs.
    # Package/assessment restoration failure is an unsafe experiment and stops.
assert len(lane_records) == 2
subprocess.run(["python3", str(controller / "verify-core-pour-same-worker.py"), str(root)], check=True)
