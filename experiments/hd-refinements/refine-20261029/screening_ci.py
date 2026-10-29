#!/usr/bin/env python3
"""Screen six prespecified boards only; never report a full-corpus result."""
import argparse
import base64
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "harness"))

from arm_profiles import LOCK_SHA256, canonical_sha, load_config, source_hashes, sanitized_child_environment
from cpu_resources import get_cpu_capacity, validate_cpu_request
from screening_summary import build as build_summary, markdown

HERE = Path(__file__).resolve().parents[1] / "harness"
SCREEN_SAMPLES = {"srj18": [2, 11, 15], "srj24": [2, 11, 15]}
GIB = 1024 ** 3
WORKER_SHA256 = "1a2e2bf44ffb46d2bb52f0926b2af4c96684dca348d96acd79c5ed8da53a80f3"
PREVIOUS_WORKER_SHA256 = "a38701372b453e939ec3698703fec73a896b822214a957b8301e978088890858"
ARCHIVE_MANIFEST_SHA256 = "0b42899deea4cd0f4ba73a46fe2e948758bb05af9da6c1541ffd116141b36d6c"
DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions"]


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def output(command, cwd=None):
    return subprocess.check_output(command, cwd=cwd, text=True).strip()


def optional(path):
    try:
        return Path(path).read_text().strip()
    except FileNotFoundError:
        return None


def select_memory_profile(effective, available):
    observed = min(effective, available)
    if observed < 56 * GIB:
        raise RuntimeError("Refinement CI requires at least56GiB effective and available RAM")
    budget = 64 if observed >= 80 * GIB else 48
    return {"profile": f"refinement-{budget}GiB", "reservationBudgetGiB": budget,
            "observedRssGuardGiB": budget, "allowHeavyOverlap": True,
            "minimumEffectiveAndAvailableGiB": 80 if budget == 64 else 56}


def resource_profile():
    allowed = sorted(os.sched_getaffinity(0))
    cpu_max = optional("/sys/fs/cgroup/cpu.max")
    memory_max = optional("/sys/fs/cgroup/memory.max")
    capacity = get_cpu_capacity(allowed, cpu_max)
    meminfo = {line.split(":")[0]: int(line.split()[1]) * 1024 for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith(("MemTotal:", "MemAvailable:"))}
    effective = min(meminfo["MemTotal"], int(memory_max)) if memory_max and memory_max.isdigit() else meminfo["MemTotal"]
    memory_profile = select_memory_profile(effective, meminfo["MemAvailable"])
    if capacity["effectiveCpuCount"] < 3:
        raise RuntimeError("Refinement CI requires at least3 observed CPUs")
    concurrency = 6 if capacity["effectiveCpuCount"] >= 6 else 3
    validate_cpu_request(concurrency, capacity)
    return {
        "allowedCpus": allowed, "cpuMax": cpu_max, "memoryMax": memory_max,
        "cpuCapacity": capacity, "concurrency": concurrency, "sampleCpus": allowed[:concurrency],
        "memory": {**meminfo, "effectiveLimitBytes": effective, **memory_profile},
    }


def validate_dependency_manifests(checkouts, archive_manifest):
    if sha(archive_manifest) != ARCHIVE_MANIFEST_SHA256:
        raise RuntimeError("Archived generating dependency manifest changed")
    expected = json.loads(Path(archive_manifest).read_text())
    observed = {}
    for arm, checkout in checkouts.items():
        path = checkout / "package.json"
        manifest = json.loads(path.read_text())
        for section in DEPENDENCY_SECTIONS:
            if manifest.get(section) != expected.get(section):
                raise RuntimeError(f"Dependency section {section} differs from archived lock manifest for {arm}")
        observed[arm] = sha(path)
    return observed


def log_payload(payload):
    raw = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode()
    packed = gzip.compress(raw, compresslevel=9, mtime=0)
    encoded = base64.b64encode(packed).decode()
    chunks = [encoded[offset:offset + 32000] for offset in range(0, len(encoded), 32000)]
    packed_sha = hashlib.sha256(packed).hexdigest()
    print(f"HD_REFINEMENT_SUMMARY_BEGIN chunks={len(chunks)} gzipSha256={packed_sha} payloadSha256={hashlib.sha256(raw).hexdigest()}", flush=True)
    for number, chunk in enumerate(chunks, 1):
        print(f"HD_REFINEMENT_SUMMARY_CHUNK {number}/{len(chunks)}={chunk}", flush=True)
    print(f"HD_REFINEMENT_SUMMARY_END gzipSha256={packed_sha}", flush=True)


def verify_records(out, config, metadata):
    expected = {(arm["id"], dataset, number) for arm in config["arms"] for dataset, samples in SCREEN_SAMPLES.items() for number in samples}
    refs = {arm["id"]: arm["commit"] for arm in config["arms"]}
    seen = set()
    errors = []
    source_boards = {}
    memory = metadata["memory"]
    expected_memory = select_memory_profile(memory["effectiveLimitBytes"], memory["MemAvailable"])
    if any(memory.get(name) != value for name, value in expected_memory.items()):
        errors.append("Recorded memory resource policy does not match observed capacity gating")
    reservation_budget = memory["reservationBudgetGiB"] * GIB
    driver = json.loads((out / "metadata.json").read_text())
    reservations = json.loads((HERE / "memory-reservations.json").read_text())
    if driver["workerSha256"] != WORKER_SHA256 or driver["dependencyLockSha256"] != LOCK_SHA256:
        errors.append("Driver worker/lock differs from frozen protocol")
    for path in sorted((out / "full").glob("*/*.json")):
        if path.name.endswith((".task.json", ".output.json")):
            continue
        report = json.loads(path.read_text())
        key = (report.get("variant"), report.get("dataset"), report.get("sampleNumber"))
        if key in seen:
            errors.append(f"Duplicate measurement {key}")
        seen.add(key)
        if key not in expected or "result" not in report:
            errors.append(f"Unexpected measurement {key}")
            continue
        if report.get("commit") != refs[key[0]] or report.get("effort") != 1 or report.get("timeoutMs") != 360000 or report.get("mode") != "full":
            errors.append(f"Incorrect source or solve settings {key}")
        if report.get("routingStarted") is not True or report.get("startupTimedOut"):
            errors.append(f"Routing never started or startup timed out {key}")
        source_problem = report["result"].get("sourceProblem") or {}
        if any(not re.fullmatch(r"[0-9a-f]{64}", str(source_problem.get(name, ""))) for name in ["srjSha256", "scenarioSha256"]) or source_problem.get("dataset") != key[1] or source_problem.get("sampleNumber") != key[2]:
            errors.append(f"Missing or invalid pre-solve source-problem identity {key}")
        board = source_boards.setdefault(f"{key[1]}:{key[2]}", {})
        board[key[0]] = {name: source_problem.get(name) for name in ["srjSha256", "scenarioSha256"]}
        if report.get("sourceHashes") != {name: value for name, value in driver["variants"][key[0]].items() if name.endswith("SourceTreeSha256")}:
            errors.append(f"Source tree hashes differ {key}")
        provenance = report.get("measurementProvenance") or {}
        checks = {
            "measurementProtocolSha256": driver["measurementProtocolSha256"],
            "workerSha256": WORKER_SHA256, "dependencyLockSha256": LOCK_SHA256,
            "concurrency": metadata["concurrency"], "cpus": ",".join(map(str, metadata["sampleCpus"])),
            "memoryReservationBudgetBytes": reservation_budget, "memoryHeavyOverlapAllowed": True,
            "armConfigSha256": canonical_sha(config), "injectedSolverVariables": {},
            "memoryReservationPolicySha256": sha(HERE / "memory-reservations.json"),
            "memorySchedulerSha256": sha(HERE / "memory_scheduler.py"),
            "plannedQueueSha256": driver["plannedQueueSha256"],
            "problemContextSha256": sha(HERE / "problem_context.ts"),
        }
        if any(provenance.get(name) != value for name, value in checks.items()):
            errors.append(f"Incorrect measurement provenance {key}")
        if report.get("cpu") not in metadata["sampleCpus"]:
            errors.append(f"Incorrect sample CPU {key}")
        estimated = reservations["samples"][f"{key[1]}:{key[2]}"]["estimatedPeakWithMarginBytes"]
        reservation = min(reservation_budget, estimated)
        exclusive = estimated > reservation_budget
        if report.get("memoryReservationBytes") != reservation or report.get("memoryExclusive") != exclusive:
            errors.append(f"Incorrect per-board admission reservation {key}")
    identity = {board: {"arms": arms, "allArmsSameSourceSrj": len({values["srjSha256"] for values in arms.values()}) == 1 and len(arms) == len(config["arms"]), "allArmsSameSourceScenario": len({values["scenarioSha256"] for values in arms.values()}) == 1 and len(arms) == len(config["arms"])} for board, arms in sorted(source_boards.items())}
    return {"expectedCount": len(expected), "observedCount": len(seen), "missing": sorted(expected - seen), "unexpected": sorted(seen - expected), "errors": errors, "sourceProblemComparisons": identity, "complete": seen == expected and not errors}


def main(args):
    root, out, deps = Path(args.root).resolve(), Path(args.out).resolve(), Path(args.deps).resolve()
    config = load_config(args.config)
    if out.exists() and any(out.iterdir()):
        raise RuntimeError("CI output must be a fresh empty directory; keep previous runs separate")
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / "matrix-config.json", config)
    metadata = {
        "schemaVersion": 2, "startedAt": utc(), "config": config, "armConfigSha256": canonical_sha(config),
        "datasets": SCREEN_SAMPLES, "screeningOnly": True, "pipeline": 9, "effort": 1,
        "sampleTimeoutSeconds": 360, "routingThreadsPerSample": 1,
        "runtime": {"python": sys.version, "system": platform.platform(), "architecture": platform.machine()},
        "ci": {key: os.environ.get(key) for key in ["GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_HEAD_REF", "RUNNER_NAME", "RUNNER_OS", "RUNNER_ARCH"]},
        "controllerSha256": sha(__file__), "sourceArms": {}, "complete": False,
        "observer": {"workerSha256": WORKER_SHA256, "previousRoundWorkerSha256": PREVIOUS_WORKER_SHA256, "problemContextSha256": sha(HERE / "problem_context.ts"), "methodChange": "Common refinement observer for every arm adds loaded source-SRJ/scenario hashes before timed solve and shallow raw-constructor rule declarations. Raw constructor hashing and synchronous phase/clock observer behavior are unchanged. Do not pool these timings with earlier observer cohorts."},
        "method": "One task-interleaved six-board screening measurement; this excludes36 of42 boards and cannot establish full-corpus nonregression. One screening observation per exact source arm on one runner; seeded shuffled board order and balanced rotating arm order, then global memory admission. No solver environment modes or constructor patches. One archived frozen dependency resolution shared by every arm. Exploratory single measurements; no confidence intervals or claim of equal realized co-runners.",
    }
    started = time.monotonic()
    error = None
    try:
        if sha(HERE / "worker.ts") != WORKER_SHA256:
            raise RuntimeError("Measurement worker changed")
        bun = output(["bun", "--version"])
        if bun != "1.4.3":
            raise RuntimeError(f"Expected Bun1.4.3, received {bun}")
        metadata["runtime"]["bun"] = bun
        metadata.update(resource_profile())
        _, removed = sanitized_child_environment()
        metadata["childEnvironmentPolicy"] = {"removedVariableNames": removed, "injectedSolverVariables": {}}
        checkouts = {arm["id"]: root / arm["id"] for arm in config["arms"]}
        for arm in config["arms"]:
            checkout = checkouts[arm["id"]]
            actual = output(["git", "rev-parse", "HEAD"], checkout)
            if actual != arm["commit"] or output(["git", "status", "--porcelain"], checkout):
                raise RuntimeError(f"Expected clean exact source checkout for {arm['id']}")
            metadata["sourceArms"][arm["id"]] = {**arm, **source_hashes(checkout)}
        archive = HERE / "dependencies"
        if sha(archive / "bun.lock") != LOCK_SHA256:
            raise RuntimeError("Archived pinned dependency lock changed")
        manifests = validate_dependency_manifests(checkouts, archive / "package.json")
        if deps.exists() and any(deps.iterdir()):
            raise RuntimeError("Dependency install directory must be fresh")
        deps.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(archive / "package.json", deps / "package.json")
        shutil.copyfile(archive / "bun.lock", deps / "bun.lock")
        with (out / "dependency-install.log").open("w") as log:
            subprocess.run(["bun", "install", "--frozen-lockfile"], cwd=deps, stdout=log, stderr=subprocess.STDOUT, check=True)
        if sha(deps / "bun.lock") != LOCK_SHA256:
            raise RuntimeError("Frozen dependency install changed the archived lock")
        dependency_artifacts = out / "dependencies"
        dependency_artifacts.mkdir()
        for name in ["package.json", "bun.lock"]:
            shutil.copyfile(deps / name, dependency_artifacts / name)
        with (dependency_artifacts / "resolved-packages.txt").open("w") as log:
            subprocess.run(["bun", "pm", "ls", "--all"], cwd=deps, stdout=log, stderr=subprocess.STDOUT, check=True)
        metadata["dependencies"] = {
            "lockSha256": LOCK_SHA256, "archiveManifestSha256": sha(archive / "package.json"), "armManifestSha256": manifests,
            "resolvedPackagesSha256": sha(dependency_artifacts / "resolved-packages.txt"),
            "sameResolvedTreeForAllArms": True, "frozenLockfile": True, "sharedNodeModules": str(deps / "node_modules"),
        }
        for checkout in checkouts.values():
            target = checkout / "node_modules"
            if target.exists() or target.is_symlink():
                raise RuntimeError(f"Unexpected pre-existing dependencies at {target}")
            target.symlink_to(deps / "node_modules", target_is_directory=True)
            exclude = Path(output(["git", "rev-parse", "--git-path", "info/exclude"], checkout))
            if not exclude.is_absolute():
                exclude = checkout / exclude
            with exclude.open("a") as stream:
                stream.write("\n/node_modules\n")
        shutil.copytree(HERE, out / "protocol", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        metadata["protocolSha256"] = {str(path.relative_to(out / "protocol")): sha(path) for path in sorted((out / "protocol").rglob("*")) if path.is_file()}
        budget = metadata["memory"]["reservationBudgetGiB"]
        guard = metadata["memory"]["observedRssGuardGiB"]
        driver = [sys.executable, str(HERE / "run_matrix.py"), "--worktree-root", str(root), "--out", str(out), "--arms-config", str(out / "matrix-config.json"), "--dependency-lock", str(deps / "bun.lock"), "--datasets", "srj18,srj24", "--samples", "2,11,15", "--concurrency", str(metadata["concurrency"]), "--cpus", ",".join(map(str, metadata["sampleCpus"])), "--timeout", "360", "--startup-timeout", "120", "--reservation-budget-gib", str(budget), "--memory-guard-gib", str(guard), "--allow-heavy-overlap"]
        metadata["driverInvocation"] = {"command": driver, "startedAt": utc(), "concurrency": metadata["concurrency"], "sampleCpus": metadata["sampleCpus"], "reservationBudgetGiB": budget, "observedRssGuardGiB": guard, "memoryProfile": metadata["memory"]["profile"], "allowHeavyOverlap": True}
        write_json(out / "multiarm-ci-metadata.json", metadata)
        with (out / "matrix-driver.log").open("w") as log:
            process = subprocess.Popen(driver, stdout=log, stderr=subprocess.STDOUT)
            while True:
                try:
                    return_code = process.wait(timeout=30)
                    break
                except subprocess.TimeoutExpired:
                    count = sum(not path.name.endswith((".task.json", ".output.json")) for path in (out / "full").glob("*/*.json"))
                    print(f"{utc()} {config.get('name', 'multiarm')}: {count}/{len(config['arms']) * 6} result records; matrix running", flush=True)
        metadata["driverInvocation"].update({"finishedAt": utc(), "returnCode": return_code})
        if sha(deps / "bun.lock") != LOCK_SHA256:
            raise RuntimeError("Pinned dependency lock changed during measurements")
        metadata["resultProtocol"] = verify_records(out, config, metadata)
        if return_code != 0 or not metadata["resultProtocol"]["complete"]:
            raise RuntimeError("Multi-arm protocol incomplete; inspect raw records, queue events and driver logs")
        metadata["complete"] = True
    except Exception as failure:
        error = f"{type(failure).__name__}: {failure}"
        metadata["controllerError"] = error
        print(error, file=sys.stderr, flush=True)
    finally:
        metadata.update({"finishedAt": utc(), "wallSeconds": time.monotonic() - started})
        write_json(out / "multiarm-ci-metadata.json", metadata)
        try:
            summary = build_summary(out, config)
            write_json(out / "multiarm-summary.json", summary)
            (out / "multiarm-summary.md").write_text(markdown(summary))
            payload = {"ci": metadata, "summary": summary}
            write_json(out / "multiarm-ci-summary.json", payload)
            print(markdown(summary), flush=True)
            log_payload(payload)
        except Exception as failure:
            metadata["complete"] = False
            metadata["summaryError"] = f"{type(failure).__name__}: {failure}"
            write_json(out / "multiarm-ci-metadata.json", metadata)
            print(metadata["summaryError"], file=sys.stderr, flush=True)
    return 0 if metadata["complete"] and error is None else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--deps", required=True)
    parser.add_argument("--config", required=True)
    sys.exit(main(parser.parse_args()))
