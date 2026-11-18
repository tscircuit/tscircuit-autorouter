#!/usr/bin/env python3
"""Validate the real Core source pair with one dependency installation."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def execute(name, command):
    environment = dict(os.environ, NO_COLOR="1")
    environment.pop("BUN_UPDATE_SNAPSHOTS", None)
    environment.pop("BUN_FORCE_UPDATE_SNAPSHOTS", None)
    result = subprocess.run(command, cwd=source, env=environment, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log = proof / f"{name}.log"
    log.write_text(result.stdout)
    checks[name] = {"command": command, "exitCode": result.returncode,
                    "logSha256": sha(log)}
    (proof / "checks.json").write_text(json.dumps(checks, indent=2) + "\n")
    print(f"{name}: exit {result.returncode}", flush=True)
    print(result.stdout[-4500:], flush=True)
    return result


def dependency_graph():
    """Record installed package metadata and aliases without relying on bun pm."""
    records = []
    root = source / "node_modules"
    for folder, directories, files in os.walk(root, followlinks=False):
        for name in sorted(directories + files):
            path = Path(folder) / name
            relative = str(path.relative_to(root))
            if path.is_symlink():
                records.append({"path": relative, "target": os.readlink(path)})
            elif name == "package.json" and path.is_file():
                records.append({"path": relative, "sha256": sha(path)})
    return sorted(records, key=lambda row: row["path"])


def preserve_sources(lane):
    for relative in [*details["productionFiles"], details["testPath"]]:
        destination = proof / "files" / lane / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / relative, destination)


def preserve_snapshot(lane):
    assert snapshot.is_file(), f"Missing actual matcher snapshot: {lane}"
    destination = proof / lane / details["snapshotPath"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(snapshot, destination)
    shutil.copyfile(test, destination.parent.parent / test.name)


def check_timing_tests():
    for relative, digest in plan["timingTestSha256"].items():
        assert sha(source / relative) == digest, f"Unrelated timing test changed: {relative}"


def preserve_build(lane):
    destination = proof / lane / "dist"
    destination.mkdir(parents=True, exist_ok=True)
    for path in (source / "dist").iterdir():
        if path.is_file() and path.name.endswith((".js", ".d.ts", ".d.mts")):
            shutil.copyfile(path, destination / path.name)


controller = Path(__file__).resolve().parent
source = Path(os.environ["CORE_SOURCE"]).resolve()
candidate = Path(os.environ["CORE_CANDIDATE"]).resolve()
proof = Path(os.environ["CORE_PROOF"]).resolve()
proof.mkdir(parents=True, exist_ok=True)
plan = json.loads((controller / "core-pour-source-plan.json").read_text())
details = plan["source"]
test = source / details["testPath"]
snapshot = source / details["snapshotPath"]
checks = {}
for folder, commit in [(source, details["baseCommit"]), (candidate, details["candidateCommit"])]:
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=folder, text=True).strip() == commit
    assert not subprocess.check_output(["git", "status", "--porcelain"], cwd=folder, text=True).strip()
    assert sha(folder / "package.json") == details["packageSha256"]
assert subprocess.check_output(["bun", "--version"], text=True).strip() == plan["bunVersion"]
assert sha(test) == details["testBeforeSha256"]
assert sha(snapshot) == details["snapshotBeforeSha256"]
for relative, hashes in details["productionFiles"].items():
    assert sha(source / relative) == hashes["beforeSha256"]
    assert sha(candidate / relative) == hashes["afterSha256"]
assert sha(candidate / details["testPath"]) == details["testSha256"]
final_test = (candidate / details["testPath"]).read_text()
assert hashlib.sha256(final_test.encode()).hexdigest() == sha(controller / "core-pour-repro.test.tsx")
patch = controller / "core-pour-production.patch"
assert sha(patch) == details["patchSha256"]
candidate_changes = subprocess.check_output(["git", "diff", "--name-only", details["baseCommit"], details["candidateCommit"]], cwd=candidate, text=True).splitlines()
assert sorted(candidate_changes) == sorted([*details["productionFiles"], details["testPath"]])
shutil.copyfile(patch, proof / "production.patch")
shutil.copyfile(controller / "core-pour-source-plan.json", proof / "source-plan.json")
shutil.copyfile(source / "package.json", proof / "package.json")
shutil.copyfile(snapshot, proof / "original-repro-snapshot.svg")
preserve_sources("base")
check_timing_tests()

# Core disables lock saving; this install-only config records a new compatible
# lock without modifying the repository's config or manifest.
install_config = proof / "install.bunfig.toml"
install_config.write_text("[install.lockfile]\nsave = true\n")
installed = execute("install", ["bun", "install", f"--config={install_config}", "--backend", "copy"])
assert installed.returncode == 0, "Source dependency installation failed"
lock = source / "bun.lock"
assert lock.is_file(), "Fresh source dependency lock was not recorded"
lock_sha = sha(lock)
shutil.copyfile(lock, proof / "bun.lock")
graph = dependency_graph()
assert graph, "Installed dependency inventory is empty"
(proof / "dependency-graph.json.gz").write_bytes(gzip.compress(json.dumps(graph, sort_keys=True).encode()))
execute("tool-versions", ["bunx", "--no-install", "tsc", "--version"])

test_command = ["bun", "test", details["testPath"], "--timeout", "30000"]
test.write_text(final_test)
failure = execute("base-regression", test_command)
assert failure.returncode == 1, "Unfixed source must fail the final stale-pour assertion"
assert "expect(viasSeenByPour).toBe(circuit.db.pcb_via.list().length)" in failure.stdout
assert "Expected: 2" in failure.stdout and "Received: 1" in failure.stdout
assert "7 expect() calls" in failure.stdout, "All preview and final route/via assertions must execute"
assert "timed out" not in failure.stdout.lower(), "A timeout is not regression proof"

# Same held real router and six preceding assertions. Accept only its known
# stale-pour observation to save the BEFORE SVG; this copy never enters the PR.
bug_assertion = "expect(viasSeenByPour).toBe(circuit.db.pcb_via.list().length)"
assert final_test.count(bug_assertion) == 1
test.write_text(final_test.replace(bug_assertion, "expect(viasSeenByPour).toBe(1)"))
snapshot.unlink()
assert execute("base-repro-create", test_command).returncode == 0
preserve_snapshot("base")
base_snapshot_sha = sha(snapshot)
execute("base-repro-repeat", test_command)
assert sha(snapshot) == base_snapshot_sha

for lane in ["base", "candidate"]:
    if lane == "candidate":
        subprocess.run(["git", "apply", "--check", str(patch)], cwd=source, check=True)
        subprocess.run(["git", "apply", str(patch)], cwd=source, check=True)
        for relative, hashes in details["productionFiles"].items():
            assert sha(source / relative) == hashes["afterSha256"]
            assert (source / relative).read_bytes() == (candidate / relative).read_bytes()
        test.write_text(final_test)
        preserve_sources("candidate")
        snapshot.unlink()
        assert execute("candidate-repro-create", test_command).returncode == 0, "Localized fix failed real held-router regression"
        preserve_snapshot("candidate")
        candidate_snapshot_sha = sha(snapshot)
        execute("candidate-repro-repeat", test_command)
        assert sha(snapshot) == candidate_snapshot_sha
    check_timing_tests()
    execute(f"{lane}-unchanged-timing-tests", ["bun", "test", *plan["timingTests"], "--timeout", "30000"])
    execute(f"{lane}-related-tests", ["bun", "test", *plan["relatedTests"], "--timeout", "30000"])
    execute(f"{lane}-format", ["bunx", "--no-install", "biome", "format", *details["productionFiles"], details["testPath"]])
    execute(f"{lane}-typescript", ["bunx", "--no-install", "tsc", "--noEmit", "--pretty", "false"])
    if (source / "dist").is_dir():
        shutil.rmtree(source / "dist")
    if execute(f"{lane}-build", ["bun", "run", "build"]).returncode == 0:
        preserve_build(lane)
        execute(f"{lane}-dist-smoke", ["bun", "run", "smoke-test:dist"])
    execute(f"{lane}-class-exports", ["bun", "run", "check:class-exports"])
    assert sha(lock) == lock_sha
    assert dependency_graph() == graph, "Source lanes changed installed dependency graph"

queue_start = "  _queueAsyncEffect("
before_renderable = (proof / "files/base/lib/components/base-components/Renderable.ts").read_text()
after_renderable = (proof / "files/candidate/lib/components/base-components/Renderable.ts").read_text()
assert before_renderable[before_renderable.index(queue_start):] == after_renderable[after_renderable.index(queue_start):]
if (proof / "base/dist").is_dir() and (proof / "candidate/dist").is_dir():
    execute("production-build-equivalence", ["bun", str(controller / "audit-core-pour-build.mjs"), str(source), str(proof)])
assert sha(source / "package.json") == details["packageSha256"]
assert sha(test) == details["testSha256"]
check_timing_tests()
changed = subprocess.check_output(["git", "diff", "--name-only"], cwd=source, text=True).splitlines()
assert sorted(changed) == plan["sourceChangesPermitted"], f"Unexpected tracked source changes: {changed}"
failed = [name for name, result in checks.items() if result["exitCode"] != 0 and name != "base-regression"]
result = {"passed": not failed, "failedChecks": failed,
          "baseCommit": details["baseCommit"], "candidateCommit": details["candidateCommit"],
          "sourcePatchSha256": details["patchSha256"], "sourceTestSha256": details["testSha256"],
          "freshSharedLockSha256": lock_sha, "oneDependencyInstallation": True,
          "installedPackageMetadataAndAliasesUnchanged": True,
          "genericAsyncEffectStartupByteIdentical": True, "sevenTimingTestsByteIdentical": True,
          "baselineFailsOnlyAfterPreviewAndFinalRouteViaAssertions": True,
          "baselinePourObservedVias": 1, "baselineFinalTraceCount": 1, "baselineFinalViaCount": 2,
          "beforeSvgCaptureAcceptsOnlyKnownStaleViaObservation": True,
          "actualCoreMatcherSnapshots": True,
          "snapshots": {lane: sha(proof / lane / details["snapshotPath"]) for lane in ["base", "candidate"]},
          "checks": checks}
(proof / "result.json").write_text(json.dumps(result, indent=2) + "\n")
assert not failed, f"Source validation failed: {failed}"
