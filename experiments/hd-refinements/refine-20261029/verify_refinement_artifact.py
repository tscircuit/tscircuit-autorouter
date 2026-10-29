#!/usr/bin/env python3
"""Verify downloaded refinement evidence without changing the frozen harness.

Only independently hash-checked local helpers are imported. Missing archived
protocol/.gitignore is reported separately from executable measurement evidence;
it is never recreated or described as archived-byte verification.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import importlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
DATASETS = {"srj18": 16, "srj24": 26}
GIB = 1024 ** 3
HASH = re.compile(r"^[0-9a-f]{64}$")
RULE = re.compile(r"clearance|gap|tracewidth|diameter", re.IGNORECASE)
SOURCE_METHOD = "Exact JSON.stringify of loaded source SRJ after metadata migration and effort override, before runTask/timed solve; scenario hash also includes scenarioName. No configuration fields removed or normalized."
KNOWN_NONEXECUTING_OMISSIONS = {".gitignore"}
CONFIRMATION_TEMPLATE = ROOT / "confirmation/combined-confirmation.json.in"
CONFIRMATION_TEMPLATE_SHA256 = "611973ae75130fb4dded3a17e8ef3d744270e0a344e9cbad65ca993fe2bf9c95"
LEGAL_CONFIRMATION_TEMPLATE = ROOT / "confirmation-legal-only/legalization-final-confirmation.json.in"
LEGAL_CONFIRMATION_TEMPLATE_SHA256 = "59fc336f47993d670c15d94a65321bcf8e144c9b80ab1b316a1d1391e22417e6"
REFINEMENT_TEMPLATE = ROOT / "refine-20261029/full.json.in"
REFINEMENT_TEMPLATE_SHA256 = "49f02e7157657859dce2f377080dabd134c66706a601997dd02feb181856da76"


class VerificationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def sha(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def valid_scalar(value):
    return value is None or isinstance(value, (str, bool)) or finite(value)


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def local_helpers(frozen_path):
    """Authenticate every local frozen file before executing any helper code."""
    frozen_path = Path(frozen_path).resolve()
    frozen = read(frozen_path)
    require(frozen.get("status") == "FROZEN", "Trusted manifest is not FROZEN")
    harness = frozen_path.parent / "harness"
    expected = {name[len("harness/"):]: value for name, value in frozen["files"].items() if name.startswith("harness/")}
    require(expected and all(HASH.fullmatch(value) for value in expected.values()), "Malformed frozen harness manifest")
    for name, value in expected.items():
        path = harness / name
        require(path.is_file() and sha(path) == value, f"Trusted local frozen helper differs: {name}")
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(harness))
    modules = {}
    for name in ["arm_profiles", "cpu_resources", "multiarm_ci", "multiarm_summary", "summarize"]:
        module = importlib.import_module(name)
        require(Path(module.__file__).resolve().parent == harness, f"Unexpected helper module origin: {name}")
        modules[name] = module
    require(modules["multiarm_ci"].WORKER_SHA256 == frozen["commonWorkerSha256"], "Frozen observer manifest/controller mismatch")
    return frozen, harness, expected, modules


def checked_zip_entries(archive):
    """Validate all names and file types before extracting a single member."""
    entries, seen = [], set()
    for member in archive.infolist():
        name = member.filename
        require(name and "\\" not in name and "\x00" not in name, f"Ambiguous ZIP member: {name!r}")
        require(not name.startswith("/") and not re.match(r"^[A-Za-z]:", name), f"Absolute ZIP member: {name!r}")
        parts = name.rstrip("/").split("/")
        require(all(part not in {"", ".", ".."} for part in parts), f"Unsafe ZIP member: {name!r}")
        normalized = "/".join(parts)
        require(normalized not in seen, f"Duplicate ZIP member: {normalized}")
        seen.add(normalized)
        mode = member.external_attr >> 16
        kind = stat.S_IFMT(mode)
        require(kind in (0, stat.S_IFREG, stat.S_IFDIR), f"ZIP symlink or special file: {name!r}")
        require(not member.is_dir() or kind in (0, stat.S_IFDIR), f"ZIP directory/file type mismatch: {name!r}")
        require(member.is_dir() or kind in (0, stat.S_IFREG), f"ZIP file/directory type mismatch: {name!r}")
        require(not member.flag_bits & 1, f"Encrypted ZIP member: {name!r}")
        entries.append((member, PurePosixPath(normalized)))
    roots = [path.parent for member, path in entries if not member.is_dir() and path.name == "multiarm-ci-metadata.json"]
    require(len(roots) == 1, "Expected exactly one artifact metadata root")
    prefix = roots[0]
    require(all(path == prefix or prefix in path.parents or member.is_dir() and path in prefix.parents for member, path in entries), "ZIP contains files outside its unique artifact root")
    return entries, prefix


def preserve_zip(source, out):
    destination = out / "artifact.zip"
    if source.resolve() == destination.resolve():
        return destination
    if destination.exists() and sha(destination) != sha(source):
        prior = out / f"artifact-previous-{sha(destination)}.zip"
        if not prior.exists():
            shutil.copyfile(destination, prior)
    if not destination.exists() or sha(destination) != sha(source):
        shutil.copyfile(source, destination)
    return destination


def extract_archive(archive, out):
    destination = out / "artifact"
    with zipfile.ZipFile(archive) as source:
        entries, prefix = checked_zip_entries(source)
        staging = Path(tempfile.mkdtemp(prefix=".artifact-extract-", dir=out))
        try:
            for member, path in entries:
                if member.is_dir() and path in prefix.parents:
                    continue
                relative = path.relative_to(prefix)
                if not relative.parts:
                    continue
                target = staging.joinpath(*relative.parts)
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with source.open(member) as incoming, target.open("xb") as outgoing:
                        shutil.copyfileobj(incoming, outgoing)
            if destination.exists() or destination.is_symlink():
                require(not destination.is_symlink(), "Existing artifact directory is a symlink")
                stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
                destination.rename(out / f"artifact-previous-{stamp}")
            staging.rename(destination)
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise
    return destination, str(prefix), len(entries)


def approved_configuration(path, modules, harness):
    config = modules["arm_profiles"].load_config(path)
    profile = {"portfolio-source-ablation": "portfolio", "legalization-source-ablation": "legalization", "combined-refinement-confirmation": "confirmation", "legalization-final-confirmation": "legal-confirmation", "legalization-regression-refinement-20261029": "legal-v3"}.get(config.get("name"))
    require(profile is not None, "Unknown approved matrix profile")
    if profile == "confirmation":
        require(sha(CONFIRMATION_TEMPLATE) == CONFIRMATION_TEMPLATE_SHA256, "Confirmation template differs from its predeclared byte hash")
        template = read(CONFIRMATION_TEMPLATE)
    elif profile == "legal-v3":
        require(sha(REFINEMENT_TEMPLATE) == REFINEMENT_TEMPLATE_SHA256, "Refinement template differs from its predeclared byte hash")
        template = read(REFINEMENT_TEMPLATE)
    elif profile == "legal-confirmation":
        require(sha(LEGAL_CONFIRMATION_TEMPLATE) == LEGAL_CONFIRMATION_TEMPLATE_SHA256, "Legal-only confirmation template differs from its predeclared byte hash")
        template = read(LEGAL_CONFIRMATION_TEMPLATE)
    else:
        template = read(harness / "configs" / f"{profile}.json.in")
    require([arm["id"] for arm in config["arms"]] == [arm["id"] for arm in template["arms"]], "Approved arms differ from prespecified matrix")
    require(config["contrasts"] == template["contrasts"], "Approved contrasts differ from prespecified matrix")
    require(len(config["arms"]) == {"portfolio": 4, "legalization": 5, "confirmation": 4, "legal-confirmation": 3, "legal-v3": 4}[profile], "Unexpected source-arm count for the approved profile")
    for arm, declared in zip(config["arms"], template["arms"]):
        require({key: value for key, value in arm.items() if key != "commit"} == {key: value for key, value in declared.items() if key != "commit"}, f"Approved arm role/mode differs: {arm['id']}")
        if modules["arm_profiles"].SHA_PATTERN.fullmatch(declared["commit"]):
            require(arm["commit"] == declared["commit"], f"Historical source ref changed: {arm['id']}")
    if profile in {"confirmation", "legal-confirmation", "legal-v3"}:
        layout = copy.deepcopy(config)
        for arm, declared in zip(layout["arms"], template["arms"]):
            arm["commit"] = declared["commit"]
        require(layout == template, "Confirmation settings, roles, order, seed or contrasts differ from the predeclared template")
        require(len({arm["commit"] for arm in config["arms"]}) == len(config["arms"]), "Confirmation requires distinct exact source commits")
    return config, profile


def protocol_check(artifact, ci, harness, expected):
    require(ci.get("protocolSha256") == expected, "Controller protocol hash inventory differs from frozen harness")
    observed = {str(path.relative_to(artifact / "protocol")) for path in (artifact / "protocol").rglob("*") if path.is_file()}
    missing = sorted(set(expected) - observed)
    unexpected = sorted(observed - set(expected))
    mismatched = sorted(name for name in set(expected) & observed if sha(artifact / "protocol" / name) != expected[name])
    return {"expectedCount": len(expected), "archivedCount": len(observed),
            "missingProtocolFiles": missing, "unexpectedProtocolFiles": unexpected,
            "mismatchedProtocolFiles": mismatched,
            "knownNonexecutingProtocolOmissions": [name for name in missing if name in KNOWN_NONEXECUTING_OMISSIONS],
            "criticalMissingProtocolFiles": [name for name in missing if name not in KNOWN_NONEXECUTING_OMISSIONS],
            "archiveComplete": not missing and not unexpected and not mismatched,
            "measurementFilesAuthenticated": not unexpected and not mismatched and not any(name not in KNOWN_NONEXECUTING_OMISSIONS for name in missing),
            "localFrozenFilesVerified": len(expected)}


def resource_check(ci, modules):
    profiles, cpus, controller = (modules[name] for name in ["arm_profiles", "cpu_resources", "multiarm_ci"])
    allowed = ci["allowedCpus"]
    require(isinstance(allowed, list) and all(type(cpu) is int for cpu in allowed) and allowed == sorted(set(allowed)), "Malformed recorded allowed CPU affinity")
    capacity = cpus.get_cpu_capacity(allowed, ci.get("cpuMax"))
    require(ci.get("cpuCapacity") == capacity and capacity["effectiveCpuCount"] >= 3, "CPU observations do not support recorded capacity")
    lanes = 6 if capacity["effectiveCpuCount"] >= 6 else 3
    require(ci.get("concurrency") == lanes and ci.get("sampleCpus") == allowed[:lanes], "Recorded lanes do not match capacity-gated affinity policy")
    profiles.validate_cpu_ids(ci["sampleCpus"], lanes, allowed)
    memory = ci["memory"]
    require(all(type(memory.get(name)) is int and memory[name] > 0 for name in ["MemTotal", "MemAvailable", "effectiveLimitBytes"]), "Missing observed RAM capacity")
    require(memory["MemAvailable"] <= memory["MemTotal"], "Available RAM exceeds physical RAM")
    effective = min(memory["MemTotal"], int(ci["memoryMax"])) if ci.get("memoryMax") and str(ci["memoryMax"]).isdigit() else memory["MemTotal"]
    require(memory["effectiveLimitBytes"] == effective, "Recorded effective RAM differs from host/cgroup observations")
    policy = controller.select_memory_profile(effective, memory["MemAvailable"])
    require(all(memory.get(key) == value for key, value in policy.items()), "Memory48/64-GiB capacity gate does not verify")
    invocation = ci["driverInvocation"]
    expected = {"returnCode": 0, "concurrency": lanes, "sampleCpus": ci["sampleCpus"],
                "reservationBudgetGiB": policy["reservationBudgetGiB"], "observedRssGuardGiB": policy["observedRssGuardGiB"],
                "memoryProfile": policy["profile"], "allowHeavyOverlap": True}
    require(all(invocation.get(key) == value for key, value in expected.items()), "Controller driver invocation contradicts recorded resource policy")
    return {"concurrency": lanes, "sampleCpus": ci["sampleCpus"], "cpuCapacity": capacity, "memoryPolicy": policy}


def driver_check(driver, ci, config, harness, modules):
    profiles, controller = modules["arm_profiles"], modules["multiarm_ci"]
    require(driver.get("armConfig") == config and driver.get("armConfigSha256") == profiles.canonical_sha(config), "Driver matrix/config fingerprint differs")
    require(driver.get("bunVersion") == "1.4.3" and driver.get("dependencyLockSha256") == profiles.LOCK_SHA256, "Driver runtime/dependency resolution differs")
    require(driver.get("cpuCapacity") == ci["cpuCapacity"] and driver.get("cpuset") == ci["allowedCpus"], "Driver/controller CPU observations differ")
    require(driver.get("cpuMax") == ci.get("cpuMax") and driver.get("memoryMax") == ci.get("memoryMax"), "Driver/controller cgroup observations differ")
    require(driver.get("effectiveMemoryLimitBytes") == ci["memory"]["effectiveLimitBytes"] and driver.get("physicalMemoryBytes") == ci["memory"]["MemTotal"], "Driver/controller RAM observations differ")
    expected_count = len(config["arms"]) * 42
    require(driver.get("interrupted") is False and driver.get("completedThisInvocation") == driver.get("plannedThisInvocation") == expected_count, "Driver was interrupted or did not freshly measure every arm/sample")
    budget, guard = (ci["memory"][key] for key in ["reservationBudgetGiB", "observedRssGuardGiB"])
    expected_args = {"mode": "full", "datasets": "srj18,srj24", "samples": "all", "concurrency": ci["concurrency"],
                     "cpus": ",".join(map(str, ci["sampleCpus"])), "timeout": 360, "startup_timeout": 120,
                     "reservation_budget_gib": budget, "memory_guard_gib": guard, "allow_heavy_overlap": True,
                     "save_output": False, "max_memory_bypasses": 8}
    require(all(driver.get("args", {}).get(key) == value for key, value in expected_args.items()), "Driver arguments differ from declared benchmark/resource settings")
    policy = driver["memoryReservationPolicy"]
    require(policy.get("budgetBytes") == budget * GIB and policy.get("allowHeavyOverlap") is True and policy.get("sha256") == sha(harness / "memory-reservations.json") and policy.get("maxQueueBypasses") == 8, "Driver memory admission policy differs")
    arm_ids = {arm["id"] for arm in config["arms"]}
    require(set(driver.get("variants", {})) == set(ci.get("sourceArms", {})) == arm_ids, "Missing or unexpected source-arm provenance")
    for arm in config["arms"]:
        source, measured = ci["sourceArms"][arm["id"]], driver["variants"][arm["id"]]
        require(all(source.get(key) == value for key, value in arm.items()), f"Controller source ref/mode mismatch: {arm['id']}")
        require(measured.get("commit") == arm["commit"] and measured.get("role") == arm["role"] and measured.get("dirtyStatus") == "", f"Dirty or wrong source checkout: {arm['id']}")
        for name in ["solverSourceTreeSha256", "benchmarkSourceTreeSha256", "routingSourceTreeSha256"]:
            require(isinstance(source.get(name), str) and HASH.fullmatch(source[name]) and measured.get(name) == source[name], f"Source tree identity differs: {arm['id']}/{name}")
    samples = [(dataset, number) for dataset, size in DATASETS.items() for number in range(1, size + 1)]
    queue = profiles.planned_order(samples, [arm["id"] for arm in config["arms"]], config["orderSeed"])
    require(driver.get("plannedQueueSha256") == profiles.canonical_sha(queue), "Planned queue fingerprint differs")
    require(driver.get("plannedQueue") == [{"arm": arm, "dataset": dataset, "sampleNumber": number} for arm, dataset, number in queue], "Planned queue differs from prespecified seeded rotation")
    for name, filename in [("runnerSha256", "run_matrix.py"), ("workerSha256", "worker.ts"), ("problemContextSha256", "problem_context.ts"), ("memorySchedulerSha256", "memory_scheduler.py"), ("cpuResourcesSha256", "cpu_resources.py")]:
        require(driver.get(name) == sha(harness / filename), f"Driver component fingerprint differs: {filename}")
    require(driver.get("workerSha256") == controller.WORKER_SHA256, "Wrong common observer version")
    require(ci.get("childEnvironmentPolicy", {}).get("injectedSolverVariables") == driver.get("childEnvironmentPolicy", {}).get("injectedSolverVariables") == {}, "Solver environment modes were injected")
    require(ci["childEnvironmentPolicy"].get("removedVariableNames") == driver["childEnvironmentPolicy"].get("removedVariableNames"), "Controller/driver child environment policies differ")
    fingerprint = {key: driver[key] for key in ["runnerSha256", "workerSha256", "problemContextSha256", "memorySchedulerSha256", "cpuResourcesSha256", "memoryReservationPolicy", "cpuCapacity", "armConfigSha256", "dependencyLockSha256", "plannedQueueSha256", "childEnvironmentPolicy"]}
    fingerprint["settings"] = {key: driver["args"][key] for key in ["concurrency", "cpus", "timeout", "startup_timeout", "memory_guard_gib", "mode", "save_output"]}
    fingerprint["sourceArms"] = {arm: {key: value for key, value in record.items() if key in {"commit", "role"} or key.endswith("SourceTreeSha256")} for arm, record in driver["variants"].items()}
    require(driver.get("measurementProtocolSha256") == profiles.canonical_sha(fingerprint), "Independent measurement fingerprint differs")
    return {"measurementProtocolSha256": driver["measurementProtocolSha256"], "plannedQueueSha256": driver["plannedQueueSha256"]}


def source_context_check(reports):
    checked = []
    for key, report in sorted(reports.items()):
        context = report["result"].get("sourceProblem") or {}
        require(context.get("schemaVersion") == 1, f"Missing full source-problem context schema: {key}")
        require(all(isinstance(context.get(name), str) and HASH.fullmatch(context[name]) for name in ["srjSha256", "scenarioSha256"]), f"Invalid source-problem hashes: {key}")
        require(isinstance(context.get("scenarioName"), str) and context["scenarioName"].strip(), f"Missing source scenario name: {key}")
        require(context.get("dataset") == key[1] and context.get("sampleNumber") == key[2], f"Source problem board label differs: {key}")
        require(type(context.get("bytes")) is int and context["bytes"] > 0 and finite(context.get("captureMs")) and context["captureMs"] >= 0, f"Invalid source-problem observation sizes/timing: {key}")
        declarations = context.get("clearanceRuleDeclarations")
        require(isinstance(declarations, dict) and all(isinstance(name, str) and RULE.search(name) and valid_scalar(value) for name, value in declarations.items()), f"Invalid source clearance-rule declarations: {key}")
        require(context.get("method") == SOURCE_METHOD, f"Unexpected source-problem hash method: {key}")
        checked.append(list(key))
    return {"verifiedFullContexts": len(checked), "records": checked,
            "limitation": "Original loaded SRJ bytes are not saved by this observer. Its pre-solve digest/rule declarations are authenticated observer evidence; they cannot be independently rehashed from this archive."}


def hd_input_check(artifact, reports):
    checked, without, cache = [], [], {}
    for key, report in sorted(reports.items()):
        captured = report["result"].get("hdInput")
        if not captured:
            without.append(list(key))
            continue
        raw_path = captured.get("path")
        require(isinstance(raw_path, str) and raw_path and "\\" not in raw_path, f"Invalid remote raw HD path: {key}")
        remote = PurePosixPath(raw_path)
        require(".." not in remote.parts and remote.parent.name == "hd-inputs", f"Raw HD path is outside captured input namespace: {key}")
        filename = remote.name
        require(HASH.fullmatch(str(captured.get("sha256", ""))), f"Invalid raw constructor hash: {key}")
        require(filename == f"{key[1]}-{key[2]:03d}-{captured['sha256']}.json", f"Raw constructor filename/identity differs: {key}")
        local = artifact / "hd-inputs" / filename
        require(local.is_file(), f"Captured raw HD file missing from archive: {key}/{filename}")
        if filename not in cache:
            raw = local.read_bytes()
            packed = json.loads(raw)
            require(isinstance(packed, dict), f"Raw constructor is not an object: {filename}")
            context = {"fieldNames": sorted(packed, key=lambda name: name.encode("utf-16-be", errors="surrogatepass")),
                       "clearanceRuleDeclarations": {name: value for name, value in packed.items() if RULE.search(name) and valid_scalar(value)}}
            cache[filename] = {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "context": context}
        actual = cache[filename]
        require(actual["sha256"] == captured["sha256"] and actual["bytes"] == captured.get("bytes"), f"Original raw HD bytes/hash differ: {key}")
        require(captured.get("rawConstructorContext") == actual["context"], f"Raw constructor field/rule context differs from original bytes: {key}")
        checked.append(list(key))
    return {"verifiedCapturedRecords": len(checked), "uniqueRawFilesVerified": len(cache), "records": checked, "withoutHdInput": without, "method": "Original file bytes, never normalized JSON. Remote absolute paths are mapped only to extracted hd-inputs/<validated basename>."}


def summarize_difference(before, after, path=""):
    if type(before) is not type(after):
        return path or "<root>"
    if isinstance(before, dict):
        if set(before) != set(after):
            return (path + ".keys").lstrip(".")
        for key in before:
            changed = summarize_difference(before[key], after[key], f"{path}.{key}".lstrip("."))
            if changed:
                return changed
    elif isinstance(before, list):
        if len(before) != len(after):
            return f"{path}.length"
        for number, (left, right) in enumerate(zip(before, after)):
            changed = summarize_difference(left, right, f"{path}[{number}]")
            if changed:
                return changed
    elif before != after:
        return path or "<root>"
    return None


def verify(archive, out, approved_config, expected_digest, run, head, frozen_manifest=None):
    archive, out = Path(archive).resolve(), Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    result = {"schemaVersion": 1, "verified": False, "archiveComplete": False,
              "measurementProtocolAuthenticated": False, "independentSummaryMatches": False,
              "run": str(run), "head": head, "checks": [], "errors": [], "archiveErrors": [],
              "missingProtocolFiles": [], "knownNonexecutingProtocolOmissions": []}

    def section(name, action):
        try:
            detail = action()
            result["checks"].append({"name": name, "passed": True, "details": detail})
            return detail
        except Exception as error:
            message = f"{name}: {type(error).__name__}: {error}"
            result["checks"].append({"name": name, "passed": False, "error": message})
            result["errors"].append(message)
            return None

    try:
        require(re.fullmatch(r"(?:sha256:)?[0-9a-f]{64}", expected_digest), "Expected a SHA256 artifact digest")
        require(re.fullmatch(r"[0-9a-f]{40}", head) and str(run).isdigit(), "Expected exact head SHA and numeric run ID")
        saved = preserve_zip(archive, out)
        result["artifactZipSha256"] = sha(saved)
        result["expectedArtifactZipSha256"] = expected_digest.removeprefix("sha256:")
        require(result["artifactZipSha256"] == result["expectedArtifactZipSha256"], "ZIP digest differs from GitHub artifact digest")
        artifact, prefix, members = extract_archive(saved, out)
        result.update(artifactRoot=str(artifact), zipRootPrefix=prefix, zipMemberCount=members)
        frozen_path = Path(frozen_manifest or ROOT / "FROZEN_MANIFEST.json").resolve()
        frozen, harness, expected_protocol, modules = local_helpers(frozen_path)
        result["frozenManifestSha256"] = sha(frozen_path)
        config, profile = approved_configuration(approved_config, modules, harness)
        result.update(profile=profile, expectedRecords=len(config["arms"]) * 42, approvedConfigSha256=canonical_hash(config))
        if profile in {"confirmation", "legal-confirmation", "legal-v3"}:
            result.update(approvedTemplateSha256=CONFIRMATION_TEMPLATE_SHA256 if profile == "confirmation" else REFINEMENT_TEMPLATE_SHA256 if profile == "legal-v3" else LEGAL_CONFIRMATION_TEMPLATE_SHA256,
                          coordinatorArm="fixed-full" if profile == "confirmation" else "refined-full" if profile == "legal-v3" else "final-full")
        payload = read(artifact / "multiarm-ci-summary.json")
        ci, stored = payload["ci"], payload["summary"]
        driver = read(artifact / "metadata.json")

        def metadata_check():
            require(read(artifact / "multiarm-ci-metadata.json") == ci, "Archived controller metadata differs from its summary payload")
            require(read(artifact / "multiarm-summary.json") == stored, "Archived standalone summary differs from its payload")
            if (out / "multiarm-ci-summary.json").exists():
                require(read(out / "multiarm-ci-summary.json") == payload, "Decoded job-log payload differs from downloaded ZIP payload")
            require(not payload.get("_synthetic"), "Synthetic payload marker cannot authenticate measured evidence")
            require(ci.get("schemaVersion") == stored.get("schemaVersion") == 2, "Unexpected refinement schema")
            require(ci.get("config") == stored.get("configuration") == read(artifact / "matrix-config.json") == config, "Exact approved source-arm config differs")
            require(ci.get("armConfigSha256") == stored.get("configSha256") == canonical_hash(config), "Approved config digest differs")
            require(str(ci.get("ci", {}).get("GITHUB_RUN_ID")) == str(run), "CI run ID differs from requested run")
            refined_arm = {"portfolio": "refined-lazy", "legalization": "selective", "confirmation": "fixed-full", "legal-confirmation": "final-full", "legal-v3": "refined-full"}[profile]
            require(next(arm["commit"] for arm in config["arms"] if arm["id"] == refined_arm) == head, "Refined source commit differs from requested head")
            require(ci.get("sourceArms", {}).get(refined_arm, {}).get("commit") == head, "Measured refined source differs from requested head")
            require(ci.get("datasets") == DATASETS and ci.get("pipeline") == 9 and ci.get("effort") == 1 and ci.get("sampleTimeoutSeconds") == 360 and ci.get("routingThreadsPerSample") == 1, "Benchmark pipeline/dataset/effort/timeout/thread scope differs")
            require(ci.get("runtime", {}).get("bun") == "1.4.3" and all(isinstance(ci["runtime"].get(name), str) and ci["runtime"][name] for name in ["python", "system", "architecture"]), "Missing or unexpected measured runtime")
            require(ci.get("observer", {}).get("workerSha256") == frozen["commonWorkerSha256"] and ci["observer"].get("problemContextSha256") == expected_protocol["problem_context.ts"], "Observer differs from frozen refinement version")
            require(ci.get("controllerSha256") == expected_protocol["multiarm_ci.py"], "Controller differs from frozen bytes")
            return {"run": str(run), "head": head, "observer": ci["observer"], "runtime": ci["runtime"]}

        section("metadataAndApprovedRefs", metadata_check)
        protocol = section("frozenProtocolBytes", lambda: protocol_check(artifact, ci, harness, expected_protocol))
        if protocol is not None:
            result.update({key: protocol[key] for key in ["missingProtocolFiles", "knownNonexecutingProtocolOmissions"]})
            if not protocol["archiveComplete"]:
                result["archiveErrors"].append("Archived frozen protocol is incomplete or differs; see frozenProtocolBytes details")
            if not protocol["measurementFilesAuthenticated"]:
                result["errors"].append("Critical frozen measurement protocol files are missing, unexpected or differ")

        def dependencies_check():
            profiles, controller = modules["arm_profiles"], modules["multiarm_ci"]
            lock, manifest = sha(artifact / "dependencies/bun.lock"), sha(artifact / "dependencies/package.json")
            require(lock == profiles.LOCK_SHA256 == ci["dependencies"].get("lockSha256"), "Actual archived dependency lock bytes differ")
            require(manifest == controller.ARCHIVE_MANIFEST_SHA256 == ci["dependencies"].get("archiveManifestSha256"), "Actual archived generating manifest bytes differ")
            require(sha(artifact / "dependencies/resolved-packages.txt") == ci["dependencies"].get("resolvedPackagesSha256"), "Resolved package listing bytes differ")
            require(ci["dependencies"].get("sameResolvedTreeForAllArms") is True and ci["dependencies"].get("frozenLockfile") is True, "A uniform frozen dependency tree was not recorded")
            manifests = ci["dependencies"].get("armManifestSha256") or {}
            require(set(manifests) == {arm["id"] for arm in config["arms"]} and all(isinstance(value, str) and HASH.fullmatch(value) for value in manifests.values()), "Per-arm source package manifest provenance is incomplete")
            return {"lockSha256": lock, "archiveManifestSha256": manifest}

        section("exactDependencies", dependencies_check)
        resources = section("observedResourcePolicy", lambda: resource_check(ci, modules))
        if resources:
            result["resources"] = resources
        section("sourceDriverAndFingerprint", lambda: driver_check(driver, ci, config, harness, modules))

        def records_check():
            actual = modules["multiarm_ci"].verify_records(artifact, config, ci)
            result["recordProtocol"] = actual
            require(actual == ci.get("resultProtocol"), "Independent raw-record controller proof differs from stored proof")
            require(actual.get("complete") is True and actual["expectedCount"] == actual["observedCount"] == len(config["arms"]) * 42, "Raw record protocol is incomplete")
            require(ci.get("complete") is True, "Controller did not complete the benchmark protocol")
            return actual

        section("uniqueRawRecordProtocol", records_check)
        reports = modules["summarize"].read_reports(artifact, "full")
        result["fullRecords"] = len(reports)

        def affinity_check():
            for key, report in reports.items():
                slot = report.get("slot")
                require(type(slot) is int and 0 <= slot < ci["concurrency"] and report.get("cpu") == ci["sampleCpus"][slot], f"Pinned CPU/slot mapping differs: {key}")
                require(report.get("measurementProvenance", {}).get("runnerSha256") == expected_protocol["run_matrix.py"], f"Raw driver hash differs: {key}")
            return {"verifiedRecords": len(reports)}

        section("perRecordAffinity", affinity_check)
        section("fullSourceProblemContexts", lambda: source_context_check(reports))
        hd = section("originalRawConstructorFiles", lambda: hd_input_check(artifact, reports))
        if hd:
            result["rawConstructorFiles"] = {key: hd[key] for key in ["verifiedCapturedRecords", "uniqueRawFilesVerified"]}

        def recompute():
            rebuilt = modules["multiarm_summary"].build(artifact, config)
            write(out / "independent-multiarm-summary.json", rebuilt)
            normalized_local, normalized_stored = copy.deepcopy(rebuilt), copy.deepcopy(stored)
            normalized_local.pop("root", None)
            normalized_stored.pop("root", None)
            difference = summarize_difference(normalized_local, normalized_stored)
            require(difference is None, f"Independent raw-record summary differs at {difference}")
            require(rebuilt["resultProtocol"]["complete"] is True and rebuilt["resultCount"] == len(config["arms"]) * 42, "Independently rebuilt corpus is incomplete")
            result["independentSummaryMatches"] = True
            return {"resultCount": rebuilt["resultCount"], "normalizedFields": ["top-level root only"], "complete": True}

        section("independentSummaryRebuild", recompute)
        result["measurementProtocolAuthenticated"] = not result["errors"]
        result["archiveComplete"] = bool(protocol and protocol["archiveComplete"] and not result["archiveErrors"] and not result["errors"])
    except Exception as error:
        result["errors"].append(f"artifactSetup: {type(error).__name__}: {error}")
    result["verified"] = result["archiveComplete"] and result["measurementProtocolAuthenticated"] and result["independentSummaryMatches"]
    result["evidenceStatus"] = "fully-verified" if result["verified"] else "authenticated-measurements-with-archive-omission" if result["measurementProtocolAuthenticated"] and result["independentSummaryMatches"] else "incomplete-or-failed-verification"
    result["verifierSha256"] = sha(Path(__file__))
    result["verifiedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    target = out / "artifact-verification.json"
    if target.exists():
        history = out / "verification-history"
        history.mkdir(exist_ok=True)
        shutil.copyfile(target, history / f"artifact-verification-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json")
    write(target, result)
    lines = [f"Status: {result['evidenceStatus']}",
             f"Archive complete: {result['archiveComplete']}",
             f"Measurement protocol authenticated: {result['measurementProtocolAuthenticated']}",
             f"Independent summary matches: {result['independentSummaryMatches']}",
             f"Raw records: {result.get('fullRecords', 'unavailable')}/{result.get('expectedRecords', 'unavailable')}",
             f"Missing frozen protocol files: {', '.join(result['missingProtocolFiles']) or 'none'}"]
    lines += [f"Archive limitation: {message}" for message in result["archiveErrors"]]
    lines += [f"Error: {message}" for message in result["errors"]]
    (out / "artifact-verification.txt").write_text("\n".join(lines) + "\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--approved-config", type=Path, required=True)
    parser.add_argument("--digest", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--frozen-manifest", type=Path, default=ROOT / "FROZEN_MANIFEST.json")
    args = parser.parse_args()
    verification = verify(args.archive, args.out, args.approved_config, args.digest, args.run, args.head, args.frozen_manifest)
    print((args.out / "artifact-verification.txt").read_text(), end="")
    sys.exit(0 if verification["verified"] else 1)
