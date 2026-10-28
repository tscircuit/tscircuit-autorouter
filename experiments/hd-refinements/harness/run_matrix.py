#!/usr/bin/env python3
"""Controlled fresh-process experiment matrix. Uses no modified checkout files."""
import argparse
import asyncio
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time

from memory_scheduler import MemoryReservationScheduler
from cpu_resources import get_cpu_capacity, validate_cpu_request
from arm_profiles import load_config, planned_order, canonical_sha, source_hashes, sanitized_child_environment, validate_cpu_ids

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(checkout, *args):
    return subprocess.check_output(["git", "-C", str(checkout), *args], text=True).strip()


def rss_bytes(pid):
    try:
        lines = Path(f"/proc/{pid}/status").read_text().splitlines()
        return next(int(s.split()[1]) * 1024 for s in lines if s.startswith("VmRSS:"))
    except (OSError, StopIteration):
        return 0


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def timeout_result(task, progress, elapsed_ms, kind, source_problem=None):
    phase = progress.get("phaseName")
    timing = progress.get("stageTiming")
    if timing:
        timing = json.loads(json.dumps(timing))
        timing["status"] = "partial"
        stages = timing.get("stages", [])
        if stages and stages[-1]["stageName"] == phase:
            stages[-1]["elapsedTimeMs"] += max(0, elapsed_ms - progress.get("elapsedTimeMs", elapsed_ms))
    return {
        "schemaVersion": 1,
        **task,
        "completedAt": now(),
        "result": {
            "didSolve": False,
            "didTimeout": kind == "timeout",
            "relaxedDrcPassed": False,
            "elapsedTimeMs": elapsed_ms,
            "sampleTimeoutMs": task["timeoutMs"],
            "error": f"{kind}: parent stopped or observed an incomplete child",
            "errorPhaseName": phase,
            "errorSolverName": progress.get("phaseSolverName"),
            "peakRssBytes": progress.get("peakRssBytes"),
            "stageTiming": timing,
            "highDensity": progress.get("highDensity"),
            "sourceProblem": source_problem,
        },
    }


def retain_observed_metadata(report, progress, hd_input, source_problem):
    result = report["result"]
    retained = []
    observations = {"hdInput": hd_input, "sourceProblem": source_problem,
                    "stageTiming": progress.get("stageTiming"),
                    "highDensity": progress.get("highDensity")}
    for name, value in observations.items():
        if result.get(name) is None and value is not None:
            result[name] = json.loads(json.dumps(value))
            if name == "stageTiming":
                result[name]["status"] = "partial"
            retained.append(name)
    if retained:
        report["observedMetadataRetention"] = {
            "fields": retained, "lastProgressElapsedTimeMs": progress.get("elapsedTimeMs"),
            "lastObservedPhaseName": progress.get("phaseName"),
            "method": "Previously received input/start events and partial heartbeat metadata retained when child result omitted them; no solve/completion state inferred",
        }
    return report


async def run(args):
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    # Keep the descriptor open for the entire run. A crashed driver releases
    # the lock automatically, and child process groups are killed on cancel.
    lock = (out / ".orchestrator.lock").open("a+")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError(f"Another orchestrator owns {out}")
    lock.seek(0)
    lock.truncate()
    lock.write(str(os.getpid()) + "\n")
    lock.flush()
    worktree_root = Path(args.worktree_root).resolve()
    prior_metadata = None
    prior_metadata_path = None
    if (out / "metadata.json").exists():
        prior_metadata = json.loads((out / "metadata.json").read_text())
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        prior_metadata_path = out / f"metadata-pre-resume-{stamp}.json"
        prior_metadata_path.write_text(json.dumps(prior_metadata, indent=2) + "\n")
    config = load_config(args.arms_config)
    variants = [arm["id"] for arm in config["arms"]]
    arm_by_id = {arm["id"]: arm for arm in config["arms"]}
    child_environment, removed_environment_names = sanitized_child_environment()
    dependency_lock = Path(args.dependency_lock).resolve()
    if digest(dependency_lock) != config["dependencyLockSha256"]:
        raise ValueError("Pinned dependency lock differs from the configured archived resolution")
    selected_datasets = args.datasets.split(",")
    samples = []
    for dataset in selected_datasets:
        if dataset not in {"srj18", "srj24"}:
            raise ValueError("Only srj18 and srj24 are supported")
        n = 16 if dataset == "srj18" else 26
        selected = list(range(1, n + 1)) if args.samples == "all" else [int(x) for x in args.samples.split(",")]
        if any(s < 1 or s > n for s in selected):
            raise ValueError(f"Sample outside {dataset}'s 1..{n} range")
        samples.extend((dataset, s) for s in selected)
    cpus = [int(x) for x in args.cpus.split(",")] if args.cpus else []
    validate_cpu_ids(cpus, args.concurrency, os.sched_getaffinity(0))
    if len(set(selected_datasets)) != len(selected_datasets):
        raise ValueError("Dataset selections must be distinct")
    planned_queue = planned_order(samples, variants, config["orderSeed"])
    reservation_path = Path(args.memory_reservations).resolve()
    reservation_policy = json.loads(reservation_path.read_text())
    if reservation_policy.get("schemaVersion") != 1:
        raise ValueError("Unsupported memory reservation policy")
    reservation_budget_bytes = int(args.reservation_budget_gib * 1024**3)
    resource_values = {}
    for name, resource_path in [
        ("cpuMax", Path("/sys/fs/cgroup/cpu.max")),
        ("memoryMax", Path("/sys/fs/cgroup/memory.max")),
    ]:
        try:
            resource_values[name] = resource_path.read_text().strip()
        except FileNotFoundError:
            # A VM's host-root cgroup may not expose these control files.
            # Report that explicitly instead of inventing a quota/limit.
            resource_values[name] = None
    cpu_capacity = get_cpu_capacity(sorted(os.sched_getaffinity(0)), resource_values["cpuMax"])
    validate_cpu_request(args.concurrency, cpu_capacity)
    physical_memory_bytes = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    memory_max = resource_values["memoryMax"]
    effective_memory_bytes = min(physical_memory_bytes, int(memory_max)) if memory_max and memory_max != "max" else physical_memory_bytes
    if reservation_budget_bytes > effective_memory_bytes - 2 * 1024**3:
        raise ValueError("Admission budget must leave at least2GiB outside sample reservations on this machine")
    metadata = {
        "schemaVersion": 1,
        "startedAt": now(),
        "args": vars(args),
        "runnerSha256": digest(Path(__file__)),
        "workerSha256": digest(HERE / "worker.ts"),
        "problemContextSha256": digest(HERE / "problem_context.ts"),
        "memorySchedulerSha256": digest(HERE / "memory_scheduler.py"),
        "cpuResourcesSha256": digest(HERE / "cpu_resources.py"),
        "cpuCapacity": cpu_capacity,
        "memoryReservationPolicy": {
            "path": str(reservation_path),
            "sha256": digest(reservation_path),
            "budgetBytes": reservation_budget_bytes,
            "maxQueueBypasses": args.max_memory_bypasses,
            "allowHeavyOverlap": args.allow_heavy_overlap,
            "method": reservation_policy["method"],
        },
        "cpuMax": resource_values["cpuMax"],
        "cpuset": sorted(os.sched_getaffinity(0)),
        "logicalCpuCount": os.cpu_count(),
        "availableCpuCount": len(os.sched_getaffinity(0)),
        "memoryMax": resource_values["memoryMax"],
        "physicalMemoryBytes": physical_memory_bytes,
        "effectiveMemoryLimitBytes": effective_memory_bytes,
        "bunVersion": subprocess.check_output([args.bun, "--version"], text=True).strip(),
        "variants": {},
        "armConfig": config,
        "armConfigSha256": canonical_sha(config),
        "dependencyLockSha256": digest(dependency_lock),
        "plannedQueueSha256": canonical_sha(planned_queue),
        "plannedQueue": [{"arm": arm, "dataset": dataset, "sampleNumber": sample} for arm, dataset, sample in planned_queue],
        "childEnvironmentPolicy": {"injectedSolverVariables": {}, "removedVariableNames": removed_environment_names, "method": "Known solver/benchmark experiment variables removed; source-only arms, no mode or constructor overrides"},
        "method": f"Fresh process per sample. Existing repository runTask DRC and trace lint. One synchronous observer, identical for variants. Effort 1. Seeded shuffled board order with balanced rotating arm order per board (planned queue retained); actual memory admission may reorder starts; memory admission can scan ahead with bounded bypasses. Per-sample reservations include conservative observed-RSS margins; tasks exceeding the admission budget are exclusive. Heavy-board overlap is {'enabled using unclamped estimates' if args.allow_heavy_overlap else 'disabled with explicit exclusive reservations'}. Admission budget={args.reservation_budget_gib}GiB; configured maximum concurrent samples={args.concurrency}. Reservations do not cap solver memory. Failure score equals configured timeout; only paired completed clean boards are compared for success-only speed. Observed CPU quota/affinity and physical/cgroup RAM are recorded above. Results are exploratory, not statistically repeated estimates.",
    }
    for variant in variants:
        checkout = worktree_root / variant
        metadata["variants"][variant] = {
            "checkout": str(checkout),
            "commit": git(checkout, "rev-parse", "HEAD"),
            "branch": git(checkout, "branch", "--show-current"),
            "dirtyStatus": git(checkout, "status", "--porcelain"),
            "diffSha256": hashlib.sha256(git(checkout, "diff", "HEAD").encode()).hexdigest(),
            "role": arm_by_id[variant]["role"],
            **source_hashes(checkout),
        }
        if metadata["variants"][variant]["commit"] != arm_by_id[variant]["commit"]:
            raise RuntimeError(f"Unexpected source commit for {variant}")
        if metadata["variants"][variant]["dirtyStatus"]:
            raise RuntimeError(f"Refusing to benchmark dirty checkout {checkout}; commit or restore implementation first")
    if metadata["bunVersion"] != "1.4.3":
        raise RuntimeError("The refinement protocol requires Bun1.4.3")
    fingerprint_fields = {key: metadata[key] for key in ["runnerSha256", "workerSha256", "problemContextSha256", "memorySchedulerSha256", "cpuResourcesSha256", "memoryReservationPolicy", "cpuCapacity", "armConfigSha256", "dependencyLockSha256", "plannedQueueSha256", "childEnvironmentPolicy"]}
    fingerprint_fields["settings"] = {key: getattr(args, key) for key in ["concurrency", "cpus", "timeout", "startup_timeout", "memory_guard_gib", "mode", "save_output"]}
    fingerprint_fields["sourceArms"] = {arm: {key: value for key, value in record.items() if key in {"commit", "role"} or key.endswith("SourceTreeSha256")} for arm, record in metadata["variants"].items()}
    metadata["measurementProtocolSha256"] = canonical_sha(fingerprint_fields)
    (out / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    jobs = []
    for variant, dataset, sample in planned_queue:
        result_path = out / args.mode / variant / f"{dataset}-{sample:03d}.json"
        if result_path.exists() and not args.rerun:
            try:
                previous = json.loads(result_path.read_text())
                if previous.get("result") is not None:
                    if previous.get("commit") != metadata["variants"][variant]["commit"]:
                        raise RuntimeError(f"Commit changed for {result_path}; use --rerun or a new --out directory")
                    if previous.get("timeoutMs") != args.timeout * 1000 or previous.get("effort") != 1 or previous.get("mode") != args.mode:
                        raise RuntimeError(f"Measurement settings changed for {result_path}; use --rerun or a new --out directory")
                    if args.mode == "hd":
                        if previous.get("nodeIds") != (args.node_ids.split(",") if args.node_ids else []):
                            raise RuntimeError(f"HD node selection changed for {result_path}; rerun")
                        if args.hd_input:
                            expected_input = Path(args.hd_input).resolve()
                        else:
                            full = json.loads((Path(args.full_results) / "full" / "control" / f"{dataset}-{sample:03d}.json").read_text())
                            source_input = full.get("result", {}).get("hdInput")
                            if not source_input:
                                raise RuntimeError(f"Original HD input is missing for {result_path}; cannot authenticate reuse")
                            expected_input = Path(source_input["path"])
                        if previous.get("hdInputSha256") != digest(expected_input):
                            raise RuntimeError(f"HD input changed for {result_path}; rerun")
                    provenance = previous.get("measurementProvenance")
                    if not provenance or provenance.get("measurementProtocolSha256") != metadata["measurementProtocolSha256"]:
                        raise RuntimeError(f"Arm/source/dependency/resource/order protocol changed for {result_path}; use a fresh output directory")
                    if provenance["workerSha256"] != metadata["workerSha256"]:
                        raise RuntimeError(f"Worker changed for {result_path}; reuse is unsafe, use --rerun or a new --out directory")
                    if provenance["runnerSha256"] != metadata["runnerSha256"]:
                        raise RuntimeError(f"Driver changed for {result_path}; use a new output directory")
                    continue
            except (ValueError, OSError):
                pass
        task = {
            "mode": args.mode,
            "variant": variant,
            "checkout": str(worktree_root / variant),
            "commit": metadata["variants"][variant]["commit"],
            "armRole": arm_by_id[variant]["role"],
            "sourceHashes": {key: value for key, value in metadata["variants"][variant].items() if key.endswith("SourceTreeSha256")},
            "dataset": dataset,
            "sampleNumber": sample,
            "effort": 1,
            "timeoutMs": args.timeout * 1000,
            "resultPath": str(result_path),
            "inputDirectory": str(out / "hd-inputs"),
            "saveOutput": args.save_output,
            "measurementProvenance": {
                "measurementProtocolSha256": metadata["measurementProtocolSha256"],
                "armConfigSha256": metadata["armConfigSha256"],
                "dependencyLockSha256": metadata["dependencyLockSha256"],
                "plannedQueueSha256": metadata["plannedQueueSha256"],
                "injectedSolverVariables": {},
                "runnerSha256": metadata["runnerSha256"],
                "workerSha256": metadata["workerSha256"],
                "problemContextSha256": metadata["problemContextSha256"],
                "concurrency": args.concurrency,
                "cpus": args.cpus,
                "memorySchedulerSha256": metadata["memorySchedulerSha256"],
                "memoryReservationPolicySha256": metadata["memoryReservationPolicy"]["sha256"],
                "memoryReservationBudgetBytes": reservation_budget_bytes,
                "memoryHeavyOverlapAllowed": args.allow_heavy_overlap,
                "effectiveCpuCount": cpu_capacity["effectiveCpuCount"],
                "quotaCores": cpu_capacity["quotaCores"],
            },
        }
        memory = reservation_policy["samples"].get(f"{dataset}:{sample}")
        if not memory:
            raise ValueError(f"Missing memory reservation for {dataset} sample {sample}")
        requested_reservation = memory["estimatedPeakWithMarginBytes"] if args.allow_heavy_overlap else memory["reservationBytes"]
        exclusive = bool(requested_reservation > reservation_budget_bytes or memory["exclusive"] and not args.allow_heavy_overlap)
        task["memoryReservationBytes"] = reservation_budget_bytes if exclusive else requested_reservation
        task["memoryExclusive"] = exclusive
        task["memoryObservedPeakRssBytes"] = memory["observedPeakRssBytes"]
        task["memoryEstimatedPeakWithMarginBytes"] = memory["estimatedPeakWithMarginBytes"]
        task["measurementProvenance"]["memoryReservationBytes"] = task["memoryReservationBytes"]
        task["measurementProvenance"]["memoryExclusive"] = exclusive
        if args.mode == "hd":
            if args.hd_input:
                if len(samples) != 1:
                    raise ValueError("Explicit --hd-input requires exactly one dataset/sample")
                task["hdInput"] = str(Path(args.hd_input).resolve())
            else:
                full = json.loads((Path(args.full_results) / "full" / "control" / f"{dataset}-{sample:03d}.json").read_text())
                hd_input = full.get("result", {}).get("hdInput")
                if not hd_input:
                    # Upstream failures without HD entrance are not HD tests.
                    print(json.dumps({"type": "no_hd_input", "dataset": dataset, "sample": sample}), flush=True)
                    continue
                task["hdInput"] = hd_input["path"]
            task["hdInputSha256"] = digest(Path(task["hdInput"]))
            task["nodeIds"] = args.node_ids.split(",") if args.node_ids else []
        jobs.append(task)
    scheduler = MemoryReservationScheduler(jobs, reservation_budget_bytes, args.max_memory_bypasses)
    active = {}
    completed = 0
    started = time.monotonic()
    interrupted = False
    log = (out / "events.jsonl").open("a", buffering=1)

    def event(value):
        value = {"at": now(), **value}
        log.write(json.dumps(value) + "\n")
        if value["type"] not in {"progress", "raw"}:
            print(json.dumps(value), flush=True)

    async def run_job(slot, task):
        nonlocal completed
        path = Path(task["resultPath"])
        path.parent.mkdir(parents=True, exist_ok=True)
        spec_path = path.with_suffix(".task.json")
        spec_path.write_text(json.dumps(task))
        command = [args.bun, "--tsconfig-override", str(Path(task["checkout"]) / "tsconfig.json"), str(HERE / "worker.ts"), str(spec_path)]
        if cpus:
            command = ["taskset", "-c", str(cpus[slot]), *command]
        stderr_path = path.with_suffix(".stderr.log")
        stdout_path = path.with_suffix(".stdout.log")
        child_started = time.monotonic()
        solve_started = None
        last_progress = {}
        last_hd_input = None
        source_problem = None
        observed_peak_rss = 0
        result = None
        with stderr_path.open("wb") as stderr, stdout_path.open("w") as stdout:
            proc = await asyncio.create_subprocess_exec(*command, cwd=task["checkout"], env=child_environment, stdout=asyncio.subprocess.PIPE, stderr=stderr, start_new_session=True, limit=32 * 1024 * 1024)
            active[slot] = proc.pid
            event({"type": "start", "slot": slot, "pid": proc.pid, "variant": task["variant"], "dataset": task["dataset"], "sample": task["sampleNumber"], "cpu": cpus[slot] if cpus else None, "memoryReservationBytes": task["memoryReservationBytes"], "memoryExclusive": task["memoryExclusive"], "activeReservedBytes": scheduler.reserved_bytes({slot: rss_bytes(pid) for slot, pid in active.items()})})

            async def read():
                nonlocal solve_started, last_progress, last_hd_input, source_problem, result
                async for raw in proc.stdout:
                    line = raw.decode("utf8", errors="replace")
                    stdout.write(line)
                    try:
                        item = json.loads(line)
                    except ValueError:
                        event({"type": "raw", "slot": slot, "value": line[:1000]})
                        continue
                    if item.get("type") == "started":
                        solve_started = time.monotonic()
                        source_problem = item.get("sourceProblem")
                    elif item.get("type") == "progress":
                        last_progress = item["value"]
                        event({"type": "progress", "slot": slot, "variant": task["variant"], "dataset": task["dataset"], "sample": task["sampleNumber"], **last_progress})
                    elif item.get("type") == "result":
                        result = item["value"]
                    elif item.get("type") == "hdInput":
                        last_hd_input = item["value"]

            reader = asyncio.create_task(read())
            timed_out = False
            try:
                while proc.returncode is None:
                    await asyncio.sleep(0.2)
                    observed_peak_rss = max(observed_peak_rss, rss_bytes(proc.pid))
                    elapsed = time.monotonic() - (solve_started or child_started)
                    # Imports have their own generous cap; routing always has
                    # precisely the configured full-sample wall budget.
                    limit = args.timeout if solve_started else args.startup_timeout
                    if elapsed >= limit:
                        timed_out = True
                        os.killpg(proc.pid, signal.SIGKILL)
                        break
                await proc.wait()
                await reader
            except BaseException:
                if proc.returncode is None:
                    os.killpg(proc.pid, signal.SIGKILL)
                    await proc.wait()
                await reader
                raise
            finally:
                active.pop(slot, None)
        if result is None:
            elapsed_ms = (time.monotonic() - (solve_started or child_started)) * 1000
            result = timeout_result(task, last_progress, elapsed_ms, "timeout" if timed_out else f"child_exit_{proc.returncode}", source_problem)
            if last_hd_input:
                result["result"]["hdInput"] = last_hd_input
            path.write_text(json.dumps(result, indent=2) + "\n")
        result = retain_observed_metadata(result, last_progress, last_hd_input, source_problem)
        result["result"]["peakRssBytes"] = max(observed_peak_rss, result["result"].get("peakRssBytes") or 0)
        result["processExitCode"] = proc.returncode
        result["routingStarted"] = solve_started is not None
        result["startupTimedOut"] = timed_out and solve_started is None
        result["parentWallTimeMs"] = (time.monotonic() - child_started) * 1000
        result["slot"] = slot
        result["cpu"] = cpus[slot] if cpus else None
        path.write_text(json.dumps(result, indent=2) + "\n")
        completed += 1
        r = result["result"]
        event({"type": "complete", "completed": completed, "total": len(jobs), "variant": task["variant"], "dataset": task["dataset"], "sample": task["sampleNumber"], "solveMs": r.get("elapsedTimeMs"), "solved": r.get("didSolve"), "clean": r.get("relaxedDrcPassed"), "timeout": r.get("didTimeout"), "phase": r.get("errorPhaseName"), "rssBytes": r.get("peakRssBytes"), "wallSeconds": time.monotonic() - started})

    async def lane(slot):
        while scheduler.pending_count:
            if (out / "PAUSE_AFTER_CURRENT").exists():
                event({"type": "paused", "slot": slot, "remaining": scheduler.pending_count})
                return
            observed_rss = {worker_slot: rss_bytes(pid) for worker_slot, pid in active.items()}
            if sum(observed_rss.values()) >= args.memory_guard_gib * 1024**3:
                await asyncio.sleep(1)
                continue
            task = scheduler.admit(slot, observed_rss)
            if task is None:
                await asyncio.sleep(0.2)
                continue
            try:
                await run_job(slot, task)
            finally:
                scheduler.release(slot)

    event({"type": "matrix_started", "jobs": len(jobs), "concurrency": args.concurrency, "variants": variants, "out": str(out), "memoryReservationBudgetBytes": reservation_budget_bytes, "memoryReservationPolicySha256": metadata["memoryReservationPolicy"]["sha256"]})
    try:
        await asyncio.gather(*(lane(i) for i in range(args.concurrency)))
    except (KeyboardInterrupt, asyncio.CancelledError):
        interrupted = True
        raise
    finally:
        metadata["finishedAt"] = now()
        metadata["completedThisInvocation"] = completed
        metadata["plannedThisInvocation"] = len(jobs)
        metadata["wallSeconds"] = time.monotonic() - started
        metadata["interrupted"] = interrupted
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        (out / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
        (out / f"metadata-{stamp}.json").write_text(json.dumps(metadata, indent=2) + "\n")
        log.close()


def parse():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", required=True)
    p.add_argument("--worktree-root", default=os.environ.get("HD_EXPERIMENT_ROOT", str(ROOT)))
    p.add_argument("--arms-config", required=True)
    p.add_argument("--dependency-lock", default=str(HERE / "dependencies/bun.lock"))
    p.add_argument("--datasets", default="srj18,srj24")
    p.add_argument("--samples", default="all")
    p.add_argument("--concurrency", type=int, default=3)
    p.add_argument("--cpus", help="Optional exactly one CPU per worker slot, e.g. 0,1,2")
    p.add_argument("--timeout", type=float, default=360)
    p.add_argument("--startup-timeout", type=float, default=60)
    p.add_argument("--memory-guard-gib", type=float, default=12)
    p.add_argument("--memory-reservations", default=str(HERE / "memory-reservations.json"))
    p.add_argument("--reservation-budget-gib", type=float, default=13)
    p.add_argument("--max-memory-bypasses", type=int, default=8)
    p.add_argument("--allow-heavy-overlap", action="store_true", help="Use unclamped measured-margin reservations on a larger-memory runner instead of default heavy-board exclusivity")
    p.add_argument("--bun", default="bun")
    p.add_argument("--save-output", action="store_true")
    p.add_argument("--rerun", action="store_true")
    p.add_argument("--mode", choices=["full", "hd"], default="full")
    p.add_argument("--hd-input", help="Explicit captured input for one selected sample")
    p.add_argument("--node-ids", help="Optional comma-separated HD node subset")
    p.add_argument("--full-results", help="Full-pipeline run directory whose control HD entrances are replayed")
    args = p.parse_args()
    if args.mode == "hd" and not args.hd_input and not args.full_results:
        p.error("HD mode requires --hd-input or --full-results")
    if args.concurrency < 1:
        p.error("Sample concurrency must be positive and cannot exceed observed affinity/quota capacity")
    if not args.reservation_budget_gib >= 1 or args.reservation_budget_gib == float("inf") or args.max_memory_bypasses < 0:
        p.error("Memory admission budget must be finite and at least1GiB; maximum bypasses must be nonnegative")
    return args


if __name__ == "__main__":
    asyncio.run(run(parse()))
