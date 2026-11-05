#!/usr/bin/env python3
"""Same-runner CI controller; all solver measurements use the unchanged worker."""
import argparse
import base64
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

BASE = "637b6c581128238f6c61227a1c15be423d24baca"
VARIANTS = {"portfolio", "kernel", "legalization", "corridors", "compatibility"}
GIB = 1024 ** 3


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def command_output(command, cwd=None):
    return subprocess.check_output(command, cwd=cwd, text=True).strip()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n")


def read_optional(path):
    try:
        return Path(path).read_text().strip()
    except FileNotFoundError:
        return None


def main(args):
    root = Path(args.root).resolve()
    out = Path(args.out).resolve()
    deps = Path(args.deps).resolve()
    harness = Path(__file__).resolve().parent
    out.mkdir(parents=True, exist_ok=True)
    metadata = {
        "schemaVersion": 1,
        "startedAt": utc(),
        "baselineCommit": BASE,
        "experimentCommit": args.head_sha,
        "variant": args.variant,
        "passOrder": ["control", args.variant],
        "datasets": {"srj18": 16, "srj24": 26},
        "pipeline": 9,
        "effort": 1,
        "sampleTimeoutSeconds": 360,
        "routingThreadsPerSample": 1,
        "concurrency": 3,
        "runtime": {"python": sys.version, "system": platform.platform(), "architecture": platform.machine()},
        "ci": {key: os.environ.get(key) for key in ["GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_HEAD_REF", "RUNNER_NAME", "RUNNER_OS", "RUNNER_ARCH"]},
        "cpuMax": read_optional("/sys/fs/cgroup/cpu.max"),
        "memoryMax": read_optional("/sys/fs/cgroup/memory.max"),
        "controllerSha256": sha(__file__),
        "passes": [],
        "method": "Unmodified benchmark worker and repository runTask. Both complete42-sample passes run sequentially on this one runner, with one fresh Bun process per sample, identical resolved dependencies, three affinity-pinned sample lanes and explicit memory admission. Baseline runs first; this is one exploratory paired pass, not a repeated randomized estimate.",
    }
    started = time.monotonic()
    failure = None
    complete = False
    try:
        bun_version = command_output(["bun", "--version"])
        if bun_version != "1.4.3":
            raise RuntimeError(f"Expected Bun1.4.3, received {bun_version}")
        metadata["runtime"]["bun"] = bun_version
        allowed_cpus = sorted(os.sched_getaffinity(0))
        if len(allowed_cpus) < 3:
            raise RuntimeError("The paired benchmark requires at least three allowed CPUs")
        cpus = allowed_cpus[:3]
        metadata["allowedCpus"] = allowed_cpus
        metadata["sampleCpus"] = cpus
        meminfo = {line.split(":")[0]: int(line.split()[1]) * 1024 for line in Path("/proc/meminfo").read_text().splitlines() if line.startswith(("MemTotal:", "MemAvailable:"))}
        memory_limit = metadata["memoryMax"]
        effective_memory = min(meminfo["MemTotal"], int(memory_limit)) if memory_limit and memory_limit.isdigit() else meminfo["MemTotal"]
        generous_memory = min(effective_memory, meminfo["MemAvailable"]) >= 56 * GIB
        if effective_memory < 15 * GIB:
            raise RuntimeError("The conservative paired benchmark requires at least15GiB of memory")
        metadata["memory"] = {
            **meminfo,
            "effectiveLimitBytes": effective_memory,
            "profile": "blacksmith-large48GiB" if generous_memory else "conservative13GiB",
            "reservationBudgetGiB": 48 if generous_memory else 13,
            "observedRssGuardGiB": 48 if generous_memory else 12,
            "allowHeavyOverlap": generous_memory,
        }
        for variant, expected in [("control", BASE), (args.variant, args.head_sha)]:
            actual = command_output(["git", "rev-parse", "HEAD"], root / variant)
            if actual != expected:
                raise RuntimeError(f"Unexpected {variant} checkout {actual}; expected {expected}")

        baseline_manifest = json.loads((root / "control/package.json").read_text())
        head_manifest = json.loads((root / args.variant / "package.json").read_text())
        for section in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions"]:
            if baseline_manifest.get(section) != head_manifest.get(section):
                raise RuntimeError(f"Dependency section {section} differs; paired shared-tree install is not valid")
        deps.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / "control/package.json", deps / "package.json")
        metadata["dependencyInstallStartedAt"] = utc()
        with (out / "dependency-install.log").open("w") as log:
            subprocess.run(["bun", "install"], cwd=deps, stdout=log, stderr=subprocess.STDOUT, check=True)
        # The source repo disables lock saving. This temporary install directory
        # has no bunfig.toml, so capture its newly generated complete resolution.
        lock = deps / "bun.lock"
        if not lock.is_file():
            raise RuntimeError("Temporary dependency install did not generate bun.lock")
        dependency_artifacts = out / "dependencies"
        dependency_artifacts.mkdir()
        shutil.copyfile(lock, dependency_artifacts / "bun.lock")
        shutil.copyfile(deps / "package.json", dependency_artifacts / "package.json")
        metadata["dependencies"] = {
            "lockSha256": sha(lock),
            "baselineManifestSha256": sha(root / "control/package.json"),
            "headManifestSha256": sha(root / args.variant / "package.json"),
            "sharedNodeModules": str(deps / "node_modules"),
            "sameResolvedTreeForBothPasses": True,
            "historicalLockfileAvailable": False,
        }
        with (dependency_artifacts / "resolved-packages.txt").open("w") as log:
            subprocess.run(["bun", "pm", "ls", "--all"], cwd=deps, stdout=log, stderr=subprocess.STDOUT, check=True)
        for variant in ["control", args.variant]:
            checkout = root / variant
            target = checkout / "node_modules"
            if target.exists() or target.is_symlink():
                raise RuntimeError(f"Unexpected pre-existing dependencies at {target}")
            target.symlink_to(deps / "node_modules", target_is_directory=True)
            exclude = Path(command_output(["git", "rev-parse", "--git-path", "info/exclude"], checkout))
            if not exclude.is_absolute():
                exclude = checkout / exclude
            with exclude.open("a") as stream:
                stream.write("\n/node_modules\n")
        protocol = out / "protocol"
        protocol.mkdir()
        for source in harness.iterdir():
            if source.is_file() and source.suffix in {".py", ".ts", ".json", ".md", ".txt"}:
                shutil.copyfile(source, protocol / source.name)
        metadata["protocolSha256"] = {source.name: sha(source) for source in protocol.iterdir()}
        write_json(out / "paired-ci-metadata.json", metadata)

        for variant in ["control", args.variant]:
            driver = [sys.executable, str(harness / "run_matrix.py"), "--worktree-root", str(root), "--out", str(out), "--variants", variant, "--datasets", "srj18,srj24", "--samples", "all", "--concurrency", "3", "--cpus", ",".join(map(str, cpus)), "--timeout", "360", "--startup-timeout", "120", "--reservation-budget-gib", "48" if generous_memory else "13", "--memory-guard-gib", "48" if generous_memory else "12"]
            if generous_memory:
                driver.append("--allow-heavy-overlap")
            entry = {"variant": variant, "startedAt": utc(), "command": driver}
            metadata["passes"].append(entry)
            write_json(out / "paired-ci-metadata.json", metadata)
            print(f"Starting full42-sample pass: {variant}", flush=True)
            with (out / f"{variant}-driver.log").open("w") as log:
                process = subprocess.Popen(driver, stdout=log, stderr=subprocess.STDOUT)
                while True:
                    try:
                        return_code = process.wait(timeout=30)
                        break
                    except subprocess.TimeoutExpired:
                        count = sum(not path.name.endswith((".task.json", ".output.json")) for path in (out / "full" / variant).glob("*.json"))
                        print(f"{utc()} {variant}: {count}/42 result files present; driver running", flush=True)
            entry.update({"finishedAt": utc(), "returnCode": return_code})
            write_json(out / "paired-ci-metadata.json", metadata)
            print(f"Finished full42-sample pass: {variant}; driver exit={return_code}", flush=True)
        expected = {(variant, dataset, sample) for variant in ["control", args.variant] for dataset, count in [("srj18", 16), ("srj24", 26)] for sample in range(1, count + 1)}
        observed = set()
        for report in (out / "full").glob("*/*.json"):
            if report.name.endswith((".task.json", ".output.json")):
                continue
            data = json.loads(report.read_text())
            if "result" in data:
                observed.add((data["variant"], data["dataset"], data["sampleNumber"]))
        metadata["resultProtocol"] = {"expectedCount": 84, "observedCount": len(observed), "missing": sorted(expected - observed), "unexpected": sorted(observed - expected)}
        complete = observed == expected and all(entry["returnCode"] == 0 for entry in metadata["passes"])
        if not complete:
            raise RuntimeError("Paired benchmark protocol incomplete; inspect driver logs and missing records")
    except Exception as error:
        failure = f"{type(error).__name__}: {error}"
        metadata["controllerError"] = failure
        print(failure, file=sys.stderr, flush=True)
    finally:
        metadata.update({"finishedAt": utc(), "wallSeconds": time.monotonic() - started, "complete": complete})
        write_json(out / "paired-ci-metadata.json", metadata)
        # Encoding happens only after every timed measurement. This marker is
        # machine-readable evidence for clients that can retrieve job logs.
        summarize = subprocess.run([sys.executable, str(harness / "summarize.py"), str(out)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        (out / "summary-generation.log").write_text(summarize.stdout)
        if summarize.returncode == 0:
            summary = json.loads((out / "full-summary.json").read_text())
            counters = []
            for report in sorted((out / "full").glob("*/*.json")):
                if report.name.endswith((".task.json", ".output.json")):
                    continue
                data = json.loads(report.read_text())
                if "result" not in data:
                    continue
                result = data["result"]
                diagnostics = (result.get("highDensity") or {}).get("diagnostics") or {}
                counters.append({"variant": data["variant"], "dataset": data["dataset"], "sampleNumber": data["sampleNumber"], "peakRssBytes": result.get("peakRssBytes"), "diagnostics": {key: value for key, value in diagnostics.items() if isinstance(value, (int, float)) and not isinstance(value, bool)}})
            payload = {"ci": metadata, "summary": summary, "perSampleDiagnostics": counters}
            write_json(out / "paired-ci-summary.json", payload)
            packed = gzip.compress(json.dumps(payload, separators=(",", ":")).encode(), compresslevel=9, mtime=0)
            print("HD_EXPERIMENT_SUMMARY_GZIP_BASE64=" + base64.b64encode(packed).decode(), flush=True)
        else:
            print("Summary generation failed; full artifacts retain available records", file=sys.stderr)
            complete = False
            metadata["complete"] = False
            metadata["summaryError"] = summarize.stdout
            write_json(out / "paired-ci-metadata.json", metadata)
    metadata["complete"] = complete and failure is None
    write_json(out / "paired-ci-metadata.json", metadata)
    return 0 if complete and failure is None else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--deps", required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--variant", choices=sorted(VARIANTS), required=True)
    sys.exit(main(parser.parse_args()))
