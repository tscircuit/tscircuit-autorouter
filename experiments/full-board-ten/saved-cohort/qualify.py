#!/usr/bin/env python3
"""Update and verify one reviewed Core snapshot without running board benchmarks."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


source, proof = [Path(value).resolve() for value in sys.argv[1:]]
controller = Path(__file__).resolve().parent
plan = json.loads((controller / "plan.json").read_text())
proof.mkdir(parents=True)
records = {}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=source, text=True).strip()


def run(name, command, update=False):
    environment = {**os.environ, "NO_COLOR": "1"}
    environment.pop("BUN_UPDATE_SNAPSHOTS", None)
    if update:
        environment["BUN_UPDATE_SNAPSHOTS"] = "1"
    result = subprocess.run(command, cwd=source, env=environment, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log = proof / f"{name}.log"
    log.write_text(result.stdout)
    records[name] = {"command": command, "exitCode": result.returncode, "snapshotUpdate": update, "logSha256": digest(log)}
    (proof / "commands.json").write_text(json.dumps(records, indent=2) + "\n")
    if result.returncode:
        raise RuntimeError(f"{name} failed; see retained log")


assert git("rev-parse", "HEAD") == plan["baseCommit"]
assert not git("status", "--porcelain")
assert subprocess.check_output(["bun", "--version"], text=True).strip() == plan["bunVersion"]
assert digest(source / plan["testPath"]) == plan["beforeSha256"]
assert digest(controller / "test.patch") == plan["patchSha256"]
for relative, checksum in plan["productionFiles"].items():
    assert digest(source / relative) == checksum, relative
manifest = (source / "package.json").read_bytes()
install_config = proof / "install.bunfig.toml"
install_config.write_text("[install.lockfile]\nsave = true\n")
run("install", ["bun", f"--config={install_config}", "install", "--ignore-scripts", "--backend", "copy"])
lock = source / "bun.lock"
lock_hash = digest(lock)
shutil.copyfile(lock, proof / "bun.lock")
assert (source / "package.json").read_bytes() == manifest
packages = []
for current, directories, files in os.walk(source / "node_modules", followlinks=False):
    if "package.json" not in files:
        continue
    path = Path(current) / "package.json"
    package = json.loads(path.read_text())
    packages.append({"path": str(path.relative_to(source)), "name": package.get("name"), "version": package.get("version"), "sha256": digest(path)})
(proof / "resolved-packages.json").write_text(json.dumps(sorted(packages, key=lambda row: row["path"]), indent=2) + "\n")
autorouter = source / "node_modules/@tscircuit/capacity-autorouter/package.json"
assert json.loads(autorouter.read_text())["version"] == plan["autorouterVersion"], "Resolved autorouter differs from reviewed current-Core graph"
run("apply-test", ["patch", "--batch", "--forward", "-p1", "-i", str(controller / "test.patch")])
assert digest(source / plan["testPath"]) == plan["afterSha256"]
command = ["bun", "test", plan["testPath"], "--timeout", "120000"]
run("snapshot-update", command, update=True)
snapshot = source / plan["snapshotPath"]
snapshot_hash = digest(snapshot)
shutil.copyfile(snapshot, proof / snapshot.name)
run("snapshot-check", command)
assert digest(snapshot) == snapshot_hash, "Normal test run changed snapshot"
run("typescript", ["bunx", "--no-install", "tsc", "--noEmit", "--pretty", "false"])
run("diff-check", ["git", "diff", "--check"])
changed = set(git("diff", "--name-only").splitlines())
assert changed == {plan["testPath"], plan["snapshotPath"]}, sorted(changed)
untracked = set(git("ls-files", "--others", "--exclude-standard").splitlines())
assert untracked <= {"bun.lock"}, sorted(untracked)
assert digest(source / plan["testPath"]) == plan["afterSha256"]
assert digest(lock) == lock_hash and (source / "package.json").read_bytes() == manifest
for relative, checksum in plan["productionFiles"].items():
    assert digest(source / relative) == checksum, relative
(proof / "actual.patch").write_bytes(subprocess.check_output(["git", "diff", "--", plan["testPath"], plan["snapshotPath"]], cwd=source))
(proof / "proof.json").write_text(json.dumps({"passed": True, "coreCommit": plan["baseCommit"], "bunVersion": plan["bunVersion"], "autorouterVersion": plan["autorouterVersion"], "testPatchSha256": plan["patchSha256"], "testSha256": plan["afterSha256"], "snapshotSha256": snapshot_hash, "snapshotPath": plan["snapshotPath"], "changedFiles": sorted(changed), "productionFilesUnchanged": plan["productionFiles"], "lockSha256": lock_hash, "manifestSha256": hashlib.sha256(manifest).hexdigest(), "packageInventorySha256": digest(proof / "resolved-packages.json"), "commands": records, "boardBenchmarksRun": 0}, indent=2) + "\n")
print("Single reviewed snapshot update, normal rerun, TypeScript and unchanged-production checks passed")
