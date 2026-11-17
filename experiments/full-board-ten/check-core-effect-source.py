#!/usr/bin/env python3
"""Run real Core source validation, preserving both lanes and exact snapshots."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


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
    record = {"command": command, "exitCode": result.returncode, "logSha256": sha(log)}
    records[name] = record
    (proof / "checks.json").write_text(json.dumps(records, indent=2) + "\n")
    print(f"{name}: exit {result.returncode}", flush=True)
    print(result.stdout[-3500:], flush=True)
    return result


def preserve_snapshot(lane):
    assert snapshot.is_file(), f"Missing actual Core matcher snapshot: {lane}"
    destination = proof / lane / "tests/repros/__snapshots__" / snapshot.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(snapshot, destination)
    shutil.copyfile(test, destination.parent.parent / test.name)


def apply_candidate():
    assert sha(source / plan["source"]["path"]) == plan["source"]["beforeSha256"]
    subprocess.run(["git", "apply", str(controller / "core-reentrancy-production.patch")],
                   cwd=source, check=True)
    assert sha(source / plan["source"]["path"]) == plan["source"]["afterSha256"]
    test.write_text(final_test)


controller = Path(__file__).resolve().parent
source = Path(os.environ["CORE_SOURCE"]).resolve()
proof = Path(os.environ["CORE_PROOF"]).resolve()
proof.mkdir(exist_ok=True)
plan = json.loads((controller / "core-effect-source-plan.json").read_text())
test = source / plan["source"]["testPath"]
snapshot = test.parent / "__snapshots__" / f"{test.name.removesuffix('.test.tsx')}-pcb.snap.svg"
final_test = (controller / "core-reentrancy-repro.test.tsx").read_text()
assert sha(controller / "core-reentrancy-repro.test.tsx") == plan["source"]["testSha256"]
assert sha(controller / "core-reentrancy-production.patch") == plan["source"]["patchSha256"]
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip() == plan["source"]["baseCommit"]
assert subprocess.check_output(["bun", "--version"], text=True).strip() == plan["bunVersion"]
records = {}
operation = sys.argv[1]

if operation == "install":
    assert not subprocess.check_output(["git", "status", "--porcelain"], cwd=source, text=True).strip()
    assert sha(source / plan["source"]["path"]) == plan["source"]["beforeSha256"]
    lock = controller / "core-effect-source.bun.lock"
    assert sha(lock) == plan["lockSha256"]
    shutil.copyfile(lock, source / "bun.lock")
    result = execute("install", ["bun", "install", "--frozen-lockfile", "--backend", "copy"])
    assert result.returncode == 0, "Frozen Core dependency installation failed"
    assert sha(source / "bun.lock") == plan["lockSha256"]
    shutil.copyfile(lock, proof / "bun.lock")
    shutil.copyfile(source / "package.json", proof / "package.json")
    (proof / "source-plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    sys.exit(0)

assert sha(source / "bun.lock") == plan["lockSha256"]
if operation == "candidate":
    apply_candidate()
    validated = source.parent / ".core-pair-proof/candidate/tests/repros/__snapshots__" / snapshot.name
    assert validated.is_file()
    shutil.copyfile(validated, snapshot)
    sys.exit(0)

assert operation == "pair"
assert not test.exists() and not snapshot.exists()
baseline_test = final_test
for fragment in [
    "  let viasSeenByPour = 0\n",
    '  circuit.on("solver:started", ({ solverName }) => {\n    if (solverName === "CopperPourPipelineSolver") {\n      viasSeenByPour = circuit.db.pcb_via.list().length\n    }\n  })\n',
    "  expect(circuit.db.pcb_trace.list()).toHaveLength(1)\n",
    "  expect(circuit.db.pcb_via.list().length).toBeGreaterThan(1)\n",
    "  expect(viasSeenByPour).toBe(circuit.db.pcb_via.list().length)\n",
]:
    assert baseline_test.count(fragment) == 1
    baseline_test = baseline_test.replace(fragment, "")
test.write_text(baseline_test)
test_command = ["bun", "test", str(test.relative_to(source)), "--timeout", "30000"]
execute("base-green-repro-create", test_command)
preserve_snapshot("base")
execute("base-green-repro-repeat", test_command)
test.write_text(final_test)
failure = execute("base-regression", test_command)
assert failure.returncode == 1 and "expect(viasSeenByPour)" in failure.stdout, "Baseline must fail at the timing assertion"

for lane in ["base", "candidate"]:
    if lane == "candidate":
        apply_candidate()
        snapshot.unlink()
        execute("candidate-repro-create", test_command)
        preserve_snapshot("candidate")
        execute("candidate-repro-repeat", test_command)
    else:
        test.write_text(baseline_test)
    execute(f"{lane}-first-tests", ["bun", "test", *plan["firstTests"], "--timeout", "30000"])
    execute(f"{lane}-related-tests", ["bun", "test", *plan["relatedTests"], "--timeout", "30000"])
    execute(f"{lane}-typescript", ["bunx", "--no-install", "tsc", "--noEmit", "--pretty", "false"])
    if (source / "dist").is_dir():
        shutil.rmtree(source / "dist")
    build = execute(f"{lane}-build", ["bun", "run", "build"])
    if build.returncode == 0:
        shutil.copytree(source / "dist", proof / lane / "dist")
        execute(f"{lane}-dist-smoke", ["bun", "run", "smoke-test:dist"])
    execute(f"{lane}-class-exports", ["bun", "run", "check:class-exports"])

if (proof / "base/dist").is_dir() and (proof / "candidate/dist").is_dir():
    execute("production-build-equivalence", ["bun", str(controller / "audit-core-effect-build.mjs"), str(source), str(proof)])
execute("candidate-browser-build", ["bun", "run", "build:benchmarking"])
assert sha(source / "bun.lock") == plan["lockSha256"]
assert sha(source / plan["source"]["path"]) == plan["source"]["afterSha256"]
assert sha(test) == plan["source"]["testSha256"]
assert subprocess.check_output(["git", "diff", "--name-only"], cwd=source, text=True).splitlines() == plan["sourceChangesPermitted"]
failed = [name for name, check in records.items() if check["exitCode"] != 0 and name != "base-regression"]
(proof / "result.json").write_text(json.dumps({"passed": not failed, "failedChecks": failed,
    "sourceCommit": plan["source"]["baseCommit"], "patchSha256": plan["source"]["patchSha256"],
    "testSha256": plan["source"]["testSha256"], "sharedFrozenLockSha256": plan["lockSha256"],
    "actualCoreMatcherSnapshots": True, "baselineRegressionFailsAtOrderingAssertion": True,
    "snapshots": {lane: sha(proof / lane / "tests/repros/__snapshots__" / snapshot.name) for lane in ["base", "candidate"]},
    "checks": records}, indent=2) + "\n")
assert not failed, f"Source validation failures: {failed}"
