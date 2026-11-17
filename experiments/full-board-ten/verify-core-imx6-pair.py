#!/usr/bin/env python3
"""Record one same-VM published/candidate original-iMX6 comparison."""

import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path


CONTROLLER = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("all_ten", CONTROLLER / "verify-core-publication-all-ten.py")
all_ten = importlib.util.module_from_spec(spec)
spec.loader.exec_module(all_ten)
read, digest, require = all_ten.read, all_ten.digest, all_ten.require
PLAN = read(CONTROLLER / "core-publication-all-ten-plan.json")
CASE = next(row for row in PLAN["cases"] if (row["board"], row["cohort"]) == ("imx6", "original"))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def inventory(root, lane):
    manifest = read(root / "runtime-manifest.json")
    task_name = "imx6-original.json" if lane == "published" else "candidate-imx6-original.json"
    task = read(root / "cases" / task_name)
    require(manifest["mainVersion"] == "0.0.3216", "Wrong main version")
    require(task["id"] == "imx6" and task["cohort"] == "original", "Wrong pair case")
    require(task["sourceSha256"] == CASE["sourceSha256"], "Source identity changed")
    files = {str(root / "runtime-manifest.json"): digest(root / "runtime-manifest.json"),
             str(root / "cases" / task_name): digest(root / "cases" / task_name),
             task["sourcePath"]: CASE["sourceSha256"]}
    for name, expected in PLAN["frozenHarnessFiles"].items():
        files[str(CONTROLLER / name)] = expected
    for kind in ("implementationFiles", "assessmentSourceFiles"):
        actual = {(str(Path(row["path"]).relative_to(root)), row["sha256"]) for row in task[kind]}
        require(actual == {(row["path"], row["sha256"]) for row in CASE[kind]}, f"Wrong {kind}")
        files.update({row["path"]: row["sha256"] for row in task[kind]})
    for key, expected in CASE["immutablePolicy"].items():
        if key in task:
            require(task[key] == expected, f"Changed task policy: {key}")
    for folder, field in (("runtime", "runtimeDependencyFiles"), ("autorouter-dependencies", "autorouterDependencyFiles")):
        for filename, key in (("package.json", "packageSha256"), ("bun.lock", "lockSha256")):
            files[str(root / folder / filename)] = manifest[field][key]
    for package in manifest["packages"]:
        folder = Path(package["entry"]).parent
        for _ in Path(package["entryRelative"]).parts[:-1]:
            folder = folder.parent
        files.update({str(folder / row["path"]): row["sha256"] for row in package["publishedFiles"]})
    helper = read(root / "cases/assessment-helper-proof.json")
    for row in helper["files"]:
        files[str(root / "cases/assessment-core" / row["name"])] = row["outputSha256"]
        files[str(root / "npm/core/dist" / row["name"])] = row["originalSha256"]
    for path, expected in files.items():
        require(digest(path) == expected, f"Inventory bytes changed: {path}")
    aliases = {row["alias"]: str(Path(row["alias"]).resolve()) for row in manifest["packageAliases"]}
    require(all(aliases[row["alias"]] == str(Path(row["target"]).resolve()) for row in manifest["packageAliases"]),
            "Runtime alias changed")
    if lane == "published":
        require(manifest["sourceOverrides"] is False and manifest["dependencyOverrides"] == [],
                "Control has a source override")
        require(task["experiment"] == "published" and task["dependencyOverrides"] == [], "Wrong control task")
        release = read(CONTROLLER / "release.json")
        require(manifest["additionalChangedPackages"] == [
            {key: row[key] for key in ("name", "version", "entrySha256")}
            for row in release["additionalChangedPackages"]],
                "Additional published package metadata changed")
        for expected in release["packages"]:
            actual = next(row for row in manifest["packages"] if row["name"] == expected["name"])
            for key in ("version", "integrity", "entryRelative", "entrySha256"):
                require(actual[key] == expected[key], f"Wrong published {expected['name']}/{key}")
    else:
        require(manifest["sourceOverrides"] is True and len(manifest["dependencyOverrides"]) == 1,
                "Wrong candidate override")
        core = next(row for row in manifest["packages"] if row["name"] == "@tscircuit/core")
        require(core["entrySha256"] == PLAN["primary"]["candidateEntrySha256"], "Candidate entry changed")
    return {"files": files, "aliases": aliases, "manifestSha256": digest(root / "runtime-manifest.json"),
            "entireTransitiveByteInventoryClaimed": False}


def snapshot(root, lane, point):
    evidence = inventory(root, lane)
    if point == "after":
        before = read(root / "imx6-pair" / f"{lane}-before.json")
        require(evidence == before["inventory"], f"{lane} post-run inventory changed")
    write(root / "imx6-pair" / f"{lane}-{point}.json",
          {"lane": lane, "point": point, "recordedAt": datetime.now(timezone.utc).isoformat(),
           "postRunFilesystemInventoryVerified": point == "after", "inventory": evidence})


def verify_control(root):
    folder = root / "paired-control/imx6/original"
    run = all_ten.load_run(folder)
    task = read(root / "cases/imx6-original.json")
    manifest = read(root / "published-runtime-manifest.json")
    progress, result, process = (run[key] for key in ("progress", "result", "process"))
    for record in (task, progress, result, process):
        require(record["id"] == "imx6" and record["cohort"] == "original", "Control identity differs")
        require(record["experiment"] == "published" and record["dependencyOverrides"] == [], "Control overridden")
    for key, expected in CASE["immutablePolicy"].items():
        require(progress[key] == expected, f"Control policy changed: {key}")
    require(progress["sourceSha256"] == task["sourceSha256"], "Control source changed")
    for kind in ("implementationFiles", "assessmentSourceFiles"):
        require(progress[kind] == task[kind], f"Control {kind} changed")
    for key in ("renderExitCode", "hardTimedOut", "executionMode", "memoryCap", "captureDeadlineMs", "hardDeadlineMs"):
        require(result[key] == process[key], f"Control outcome mismatch: {key}")
    require(result["memoryCap"] is None and result["completeSourceCounts"] and result["routingPolicyObserved"],
            "Control source or execution policy changed")
    require(result["auditExitCode"] == 0 and result["auditTimedOut"] is False and result["assessmentReady"],
            "Control neutral assessment unavailable")
    require(progress["forbiddenRoutingSolverSelections"] == [] and progress["wasmUsage"]["routingOrUnknownAttempts"] == 0,
            "Control forbidden routing implementation")
    require(result["wasmUsage"] == progress["wasmUsage"], "Control WASM records differ")
    require(progress["runtime"]["routingSourceOverride"] is False and progress["runtime"]["cacheEngine"] is False,
            "Control runtime policy changed")
    expected = {row["name"]: (row["version"], row["entrySha256"]) for row in manifest["packages"]}
    actual = {row["name"]: (row["version"], row["entrySha256"]) for row in progress["runtime"]["packages"]}
    require(actual == expected, "Control observed runtime changed")
    return folder


def verify_pair(root):
    snapshot(root, "candidate", "after")
    control_folder = verify_control(root)
    control_after = read(root / "imx6-pair/published-after.json")
    require(control_after["postRunFilesystemInventoryVerified"], "Control post-run inventory missing")
    report = all_ten.verify(root, "imx6", "original", PLAN, comparison_folder=control_folder)
    report.update(comparison="same-VM published3216 then qualified candidate; fresh processes",
                  postRunFilesystemInventoryVerified=True, candidateRebuilt=False,
                  runOrder=["published", "candidate"], nativeRuns=2,
                  historicalFrontierUsedAsGate=False,
                  singlePairDoesNotEstablishTimingCausality=True)
    for lane, folder in (("published", control_folder), ("candidate", root / "results/imx6/original")):
        run = all_ten.load_run(folder)
        report[lane + "Timing"] = {"processWallMs": run["process"]["renderWallMs"],
                                  "lastProgressElapsedMs": run["progress"]["elapsedMs"],
                                  "phases": run["progress"]["phases"], "solvers": run["progress"]["solvers"]}
    write(root / "imx6-pair/comparison.json", report)
    print(json.dumps({key: report[key] for key in ("passed", "status", "connectedBefore", "connectedAfter",
          "frontierChanged", "missingBaselineCaptures", "additionalCaptures", "physicalDifference")}, sort_keys=True))
    return report["passed"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("operation", choices=["published-before", "published-after", "candidate-before", "verify"])
    args = parser.parse_args()
    root = args.root.resolve()
    if args.operation == "verify":
        try:
            passed = verify_pair(root)
        except (ValueError, KeyError, OSError, TypeError, StopIteration) as error:
            write(root / "imx6-pair/comparison.json", {"passed": False, "status": "qualification_error", "error": str(error)})
            raise
        raise SystemExit(0 if passed else 1)
    lane, point = args.operation.split("-")
    snapshot(root, lane, point)


if __name__ == "__main__":
    main()
