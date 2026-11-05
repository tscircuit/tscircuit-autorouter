"""Exact source arms and reproducible planned scheduling; no solver mode injection."""
import hashlib
import json
import os
from pathlib import Path
import random
import re
import subprocess

BASELINE = "637b6c581128238f6c61227a1c15be423d24baca"
LOCK_SHA256 = "261a3861619cd4aa6265d2c9b75825a49196002d59ad665dddd69c67378ed1ee"
ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,47}$")
SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
REMOVED_ENV_PREFIXES = ("HD_", "TSCIRCUIT_HD_", "AUTOROUTER_EXPERIMENT_")
REMOVED_ENV_NAMES = {
    "BENCHMARK_ARGS_JSON", "BENCHMARK_DATASET", "BENCHMARK_TASK_TIMEOUT_MS",
    "BENCHMARK_TASK_TIMEOUT_PER_EFFORT_MS", "BENCHMARK_HEARTBEAT_INTERVAL_MS",
    "BENCHMARK_TERMINATE_TIMEOUT_MS",
}


def canonical_sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def load_config(path):
    config = json.loads(Path(path).read_text())
    if config.get("schemaVersion") != 1 or config.get("baselineArm") != "control":
        raise ValueError("Expected schemaVersion1 and baselineArm control")
    arms = config.get("arms")
    if not isinstance(arms, list) or not 2 <= len(arms) <= 8:
        raise ValueError("A matrix requires2..8 exact source arms")
    ids = []
    for arm in arms:
        if not isinstance(arm, dict) or not ID_PATTERN.fullmatch(arm.get("id", "")):
            raise ValueError("Invalid safe arm ID")
        if not SHA_PATTERN.fullmatch(arm.get("commit", "")):
            raise ValueError("Every arm requires an exact40-character source commit")
        if not isinstance(arm.get("role"), str) or not arm["role"].strip():
            raise ValueError("Every arm requires a descriptive source mode/role")
        if set(arm) - {"id", "commit", "role", "description"}:
            raise ValueError("Arm configuration permits source commits only; environment/constructor overrides are forbidden")
        ids.append(arm["id"])
    if len(set(ids)) != len(ids) or "control" not in ids:
        raise ValueError("Arm IDs must be unique and include control")
    baseline = next(arm for arm in arms if arm["id"] == "control")
    if baseline["commit"] != BASELINE:
        raise ValueError("Control must use the exact historical baseline")
    contrasts = config.get("contrasts")
    if not isinstance(contrasts, list) or not contrasts:
        raise ValueError("Explicit named contrasts are required")
    names = []
    pairs = []
    for contrast in contrasts:
        if set(contrast) != {"id", "before", "after"} or not ID_PATTERN.fullmatch(contrast["id"]):
            raise ValueError("Each contrast requires a safe id, before and after")
        if contrast["before"] not in ids or contrast["after"] not in ids or contrast["before"] == contrast["after"]:
            raise ValueError("Contrast endpoints must name two distinct configured arms")
        names.append(contrast["id"])
        pairs.append((contrast["before"], contrast["after"]))
    if len(set(names)) != len(names) or len(set(pairs)) != len(pairs):
        raise ValueError("Duplicate contrast IDs or endpoint pairs")
    if config.get("dependencyLockSha256") != LOCK_SHA256:
        raise ValueError("The archived exact dependency lock is mandatory")
    if not isinstance(config.get("orderSeed"), int) or isinstance(config["orderSeed"], bool):
        raise ValueError("An explicit integer orderSeed is required")
    if set(config) - {"schemaVersion", "baselineArm", "arms", "contrasts", "dependencyLockSha256", "orderSeed", "name"}:
        raise ValueError("Unsupported matrix configuration keys")
    return config


def planned_order(samples, arms, seed):
    if len(set(samples)) != len(samples) or len(set(arms)) != len(arms):
        raise ValueError("Duplicate sample keys or arm IDs")
    rng = random.Random(seed)
    boards, rotated_arms = list(samples), list(arms)
    rng.shuffle(boards)
    rng.shuffle(rotated_arms)
    planned = []
    for i, (dataset, sample) in enumerate(boards):
        offset = i % len(arms)
        ordered = rotated_arms[offset:] + rotated_arms[:offset]
        for arm in ordered:
            planned.append((arm, dataset, sample))
    return planned


def validate_cpu_ids(cpus, concurrency, allowed):
    if len(set(cpus)) != len(cpus) or any(cpu < 0 for cpu in cpus):
        raise ValueError("CPU IDs must be distinct and nonnegative")
    if len(cpus) != concurrency or not set(cpus).issubset(allowed):
        raise ValueError("Exactly one allowed CPU is required per sample lane")
    if not 1 <= concurrency <= 6:
        raise ValueError("The refinement protocol permits at most6 sample lanes")


def source_hashes(checkout):
    def tree(paths):
        data = subprocess.check_output(["git", "-C", str(checkout), "ls-tree", "-rz", "HEAD", "--", *paths])
        if not data:
            raise ValueError(f"Missing required source paths: {paths}")
        return hashlib.sha256(data).hexdigest()
    return {
        "solverSourceTreeSha256": tree(["lib"]),
        "benchmarkSourceTreeSha256": tree(["scripts/benchmark"]),
        "routingSourceTreeSha256": tree(["lib", "scripts/benchmark", "tsconfig.json", "package.json"]),
        "sourceHashMethod": "SHA256 of git ls-tree -rz HEAD entries (path,mode,blob ID); lib hash excludes benchmark,docs,tests and workflow files",
    }


def sanitized_child_environment(environment=None):
    environment = dict(os.environ if environment is None else environment)
    removed = sorted(key for key in environment if key in REMOVED_ENV_NAMES or key.startswith(REMOVED_ENV_PREFIXES))
    for key in removed:
        del environment[key]
    for key in ("BUN_OPTIONS", "NODE_OPTIONS"):
        if environment.get(key):
            raise ValueError(f"Unexpected runtime option override {key}; refusing benchmark")
    return environment, removed
