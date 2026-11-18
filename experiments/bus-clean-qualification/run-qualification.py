#!/usr/bin/env python3
"""Compile both authenticated Bus trees with one clean declared dependency graph."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import time

ASSETS = Path(__file__).resolve().parent
PLAN = json.loads((ASSETS / "qualification-plan.json").read_text())
UPSTREAM = Path(sys.argv[1]).resolve()
WORK = Path(sys.argv[2]).resolve()
RESULTS = Path(sys.argv[3]).resolve()
RESULTS.mkdir(parents=True, exist_ok=True)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(name, value):
    (RESULTS / name).write_text(json.dumps(value, indent=2) + "\n")


def capture(command, cwd):
    return subprocess.check_output(command, cwd=cwd, text=True).strip()


def run(label, command, cwd, timeout):
    log = RESULTS / (label + ".log")
    started = time.monotonic()
    timed_out = False
    with log.open("wb") as output:
        process = subprocess.Popen(
            command, cwd=cwd, stdout=output, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
            code = 124
    result = {
        "command": command, "exitCode": code, "timedOut": timed_out,
        "elapsedSeconds": time.monotonic() - started, "log": log.name,
        "logSha256": sha(log.read_bytes()),
    }
    write(label + ".json", result)
    print(json.dumps({"stage": label, **result}), flush=True)
    print("\n".join(log.read_text(errors="replace").splitlines()[-60:]), flush=True)
    return result


def dependency_fingerprint(root):
    digest = hashlib.sha256()
    count = size = 0
    packages = []
    for folder, directories, files in os.walk(root, followlinks=False):
        directories.sort()
        for name in sorted(files + [d for d in directories if (Path(folder) / d).is_symlink()]):
            path = Path(folder) / name
            relative = str(path.relative_to(root))
            if path.is_symlink():
                assert path.resolve().is_relative_to(root.resolve()), "Dependency link escapes authenticated tree: " + relative
                record = {"path": relative, "symlink": os.readlink(path)}
            else:
                file_hash = hashlib.sha256()
                with path.open("rb") as source:
                    while chunk := source.read(1024 * 1024):
                        file_hash.update(chunk)
                byte_count = path.stat().st_size
                size += byte_count
                record = {"path": relative, "bytes": byte_count, "mode": path.stat().st_mode & 0o777, "sha256": file_hash.hexdigest()}
                if name == "package.json":
                    try:
                        package = json.loads(path.read_text())
                        if package.get("name") and package.get("version"):
                            packages.append({"path": relative, "name": package["name"], "version": package["version"], "sha256": file_hash.hexdigest()})
                    except (ValueError, UnicodeError):
                        pass
            digest.update((json.dumps(record, sort_keys=True) + "\n").encode())
            count += 1
    return {"sha256": digest.hexdigest(), "entries": count, "regularFileBytes": size, "packageMetadata": packages}


def verify_source(source, expected):
    assert capture(["git", "write-tree"], source) == expected["tree"]
    subprocess.run(["git", "diff", "--quiet"], cwd=source, check=True)
    assert sha((source / "package.json").read_bytes()) == PLAN["packageSha256"]


def main():
    assert not WORK.exists(), "Qualification workspace must be fresh"
    WORK.mkdir()
    assert capture(["git", "rev-parse", "HEAD"], UPSTREAM) == PLAN["upstreamCommit"]
    assert capture(["bun", "--version"], WORK) == PLAN["bunVersion"]
    node = capture(["node", "--version"], WORK)
    assert node.startswith("v" + str(PLAN["nodeMajor"]) + ".")
    write("environment.json", {
        "bun": PLAN["bunVersion"], "node": node,
        "npm": capture(["npm", "--version"], WORK),
        "platform": platform.platform(), "architecture": platform.machine(),
        "cpuCount": os.cpu_count(), "runnerName": os.environ.get("RUNNER_NAME"),
        "runnerEnvironment": os.environ.get("RUNNER_ENVIRONMENT"),
        "controllerCommit": os.environ.get("GITHUB_SHA"),
        "planSha256": sha((ASSETS / "qualification-plan.json").read_bytes()),
        "routingBenchmarksExecuted": False,
    })
    sources = {}
    for lane, expected in PLAN["source"].items():
        source = WORK / lane
        subprocess.run(["git", "worktree", "add", "--detach", str(source), PLAN["upstreamCommit"]], cwd=UPSTREAM, check=True)
        compressed = (ASSETS / expected["patch"]).read_bytes()
        assert sha(compressed) == expected["compressedPatchSha256"]
        patch = gzip.decompress(compressed)
        assert sha(patch) == expected["patchSha256"]
        subprocess.run(["git", "apply", "--index", "--binary", "-"], input=patch, cwd=source, check=True)
        verify_source(source, expected)
        sources[lane] = source
    write("source-trees.json", PLAN["source"])
    dependencies = WORK / "dependencies"
    dependencies.mkdir()
    shutil.copyfile(sources["base"] / "package.json", dependencies / "package.json")
    # Change lock persistence only; do not change dependency declarations or overrides.
    config = WORK / "install-bunfig.toml"
    config.write_text("[install]\nsaveTextLockfile = true\n[install.lockfile]\nsave = true\n")
    os.environ["BUN_INSTALL_CACHE_DIR"] = str(WORK / "bun-cache")
    resolution = run("dependency-resolution", ["bun", "install", "--config", str(config), "--lockfile-only", "--save-text-lockfile"], dependencies, 900)
    assert resolution["exitCode"] == 0
    lock = (dependencies / "bun.lock").read_bytes()
    shutil.copyfile(dependencies / "bun.lock", RESULTS / "resolved.bun.lock")
    shutil.copyfile(dependencies / "package.json", RESULTS / "declared-package.json")
    assert sha((dependencies / "package.json").read_bytes()) == PLAN["packageSha256"]
    install = run("dependency-install", ["bun", "install", "--config", str(config), "--frozen-lockfile", "--backend=hardlink"], dependencies, 1200)
    assert install["exitCode"] == 0
    assert lock == (dependencies / "bun.lock").read_bytes()
    assert sha((dependencies / "package.json").read_bytes()) == PLAN["packageSha256"]
    # Use the declared TypeScript parser: Bun1.3.2 does not expose Bun.JSON5.
    resolved = json.loads(capture([
        "node", "-e",
        "const ts=require('typescript');if(ts.version!=='5.9.3')throw Error('Wrong TypeScript');const r=ts.parseConfigFileTextToJson('bun.lock',require('fs').readFileSync('bun.lock','utf8'));if(r.error)throw Error(ts.flattenDiagnosticMessageText(r.error.messageText,'\\n'));console.log(JSON.stringify(r.config))",
    ], dependencies))
    assert resolved["workspaces"][""]["devDependencies"] == PLAN["declaredPackage"]["devDependencies"]
    git_pins = []
    for name, spec in PLAN["declaredPackage"]["devDependencies"].items():
        if spec.startswith("github:"):
            resolved_spec = resolved["packages"][name][0]
            repository, commit = spec.removeprefix("github:").split("#")
            resolved_repository, abbreviated = resolved_spec.split("@github:", 1)[1].split("#")
            assert repository == resolved_repository and len(abbreviated) >= 7 and commit.startswith(abbreviated), resolved_spec
            git_source = WORK / ("git-pin-" + commit)
            subprocess.run(["git", "init", "--bare", str(git_source)], check=True)
            fetched = run("git-pin-" + commit, ["git", "fetch", "--depth=1", "https://github.com/" + repository + ".git", commit], git_source, 300)
            assert fetched["exitCode"] == 0
            assert capture(["git", "rev-parse", "FETCH_HEAD"], git_source) == commit
            checked_files = []
            for relative in ["package.json", "lib/index.ts"]:
                expected = subprocess.check_output(["git", "show", commit + ":" + relative], cwd=git_source)
                actual = (dependencies / "node_modules" / name / relative).read_bytes()
                assert expected == actual, name + "/" + relative
                checked_files.append({"path": relative, "sha256": sha(actual)})
            git_pins.append({"name": name, "declared": spec, "resolved": resolved_spec, "verifiedFullCommit": commit, "checkedSourceFiles": checked_files})
    shared_modules = dependencies / "node_modules"
    initial = dependency_fingerprint(shared_modules)
    write("dependency-files-before.json", initial)
    write("dependency-snapshot.json", {
        "lockSha256": sha(lock), "packageSha256": PLAN["packageSha256"],
        "sameActualNodeModulesForBothLanes": True,
        "modulesPath": str(shared_modules), "declaredGitPinsVerifiedInResolvedRecords": git_pins,
        "installConfig": config.read_text(), "cleanCachePath": os.environ["BUN_INSTALL_CACHE_DIR"],
    })
    lanes = {}
    for lane, source in sources.items():
        (source / "node_modules").symlink_to(shared_modules, target_is_directory=True)
        assert (source / "node_modules").resolve() == shared_modules
        outcomes = {}
        for stage in PLAN["stages"]:
            outcomes[stage["name"]] = run(lane + "-" + stage["name"], stage["command"], source, stage["timeoutSeconds"])
        verify_source(source, PLAN["source"][lane])
        after = dependency_fingerprint(shared_modules)
        write("dependency-files-after-" + lane + ".json", after)
        unchanged = initial == after and lock == (dependencies / "bun.lock").read_bytes() and sha((dependencies / "package.json").read_bytes()) == PLAN["packageSha256"]
        dist = [{"path": str(p.relative_to(source)), "bytes": p.stat().st_size, "sha256": sha(p.read_bytes())} for p in sorted((source / "dist").rglob("*")) if p.is_file()]
        lanes[lane] = {"source": PLAN["source"][lane], "stages": outcomes, "dependenciesUnchanged": unchanged, "distFiles": dist}
        write("qualification-results.json", {"lanes": lanes, "complete": False, "routingBenchmarksExecuted": False})
        assert unchanged, "Dependency bytes changed during validation; paired qualification is invalid"
    passed = all(stage["exitCode"] == 0 for lane in lanes.values() for stage in lane["stages"].values())
    write("qualification-results.json", {"lanes": lanes, "complete": True, "passed": passed, "routingBenchmarksExecuted": False})
    return 0 if passed else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        for source, target in [("bun.lock", "last-seen.bun.lock"), ("package.json", "last-seen-package.json")]:
            path = WORK / "dependencies" / source
            if path.is_file():
                shutil.copyfile(path, RESULTS / target)
        write("qualification-error.json", {"error": str(error), "type": type(error).__name__})
        raise
