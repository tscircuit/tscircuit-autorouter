#!/usr/bin/env python3
"""Authenticate the saved control and change only the reviewed Renderable chunk."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_packages(manifest):
    for package in manifest["packages"]:
        folder = Path(package["entry"])
        for _ in Path(package["entryRelative"]).parts:
            folder = folder.parent
        for row in package["publishedFiles"]:
            if sha(folder / row["path"]) != row["sha256"]:
                raise RuntimeError(f"Runtime package changed: {package['name']}/{row['path']}")
    for row in manifest["packageAliases"]:
        if Path(row["alias"]).resolve() != Path(row["target"]).resolve():
            raise RuntimeError(f"Runtime alias changed: {row['alias']}")


def dependency_graph(root):
    records = []
    for relative in ["runtime/node_modules", "autorouter-dependencies/node_modules"]:
        for folder, directories, files in os.walk(root / relative, followlinks=False):
            for name in sorted(directories + files):
                path = Path(folder) / name
                row = {"path": str(path.relative_to(root))}
                if path.is_symlink():
                    row.update(kind="symlink", target=os.readlink(path))
                elif path.is_file():
                    row.update(kind="file", sha256=sha(path))
                elif path.is_dir():
                    row.update(kind="directory")
                else:
                    raise RuntimeError(f"Unexpected dependency member: {path}")
                records.append(row)
    return sorted(records, key=lambda row: row["path"])


def verify_graph(candidate=False):
    guard = json.loads(gzip.decompress((proof / "runtime-guard.json.gz").read_bytes()))
    expected = guard["dependencyGraph"]
    if candidate:
        alias_row = next(row for row in expected if row["path"] == "runtime/node_modules/@tscircuit/core")
        alias_row["target"] = str(root / "npm/core-reentrancy")
    assert dependency_graph(root) == expected, "Runtime dependency graph changed"
    for row in guard["resolutionAliases"]:
        path = Path(row["path"])
        assert path.is_symlink() and os.readlink(path) == row["target"], "Resolution alias changed"
    for row in guard["immutableFiles"]:
        assert sha(Path(row["path"])) == row["sha256"], f"Neutral source/helper changed: {row['path']}"


parser = argparse.ArgumentParser()
parser.add_argument("root", type=Path)
parser.add_argument("operation", choices=["baseline", "source", "candidate", "restore"])
parser.add_argument("board")
parser.add_argument("cohort", choices=["original", "spaced"])
args = parser.parse_args()
root = args.root.resolve()
controller = Path(__file__).resolve().parent
plan = json.loads((controller / "core-reentrancy-plan.json").read_text())
case_key = f"{args.board}-{args.cohort}"
case = next(row for row in plan["cases"] if row["key"] == case_key)
case_path = root / "cases" / f"{case_key}.json"
assert sha(controller / plan["audit"]["path"]) == plan["audit"]["sha256"]
for name, digest in plan["frozenHarnessFiles"].items():
    assert sha(controller / name) == digest, f"Reviewed harness changed: {name}"
proof = root / "core-reentrancy"
proof.mkdir(exist_ok=True)
manifest_path = root / "runtime-manifest.json"
published_path = root / "published-runtime-manifest.json"

if args.operation == "baseline":
    manifest = json.loads(manifest_path.read_text())
    assert not manifest["sourceOverrides"] and not manifest["dependencyOverrides"]
    verify_packages(manifest)
    shutil.copyfile(manifest_path, published_path)
    core = next(row for row in manifest["packages"] if row["name"] == "@tscircuit/core")
    helper = root / "cases/assessment-core"
    helper_proof = json.loads((root / "cases/assessment-helper-proof.json").read_text())
    assert helper_proof["coreIdentity"]["entrySha256"] == core["entrySha256"]
    immutable = []
    for row in helper_proof["files"]:
        original = Path(core["entry"]).parent / row["name"]
        assert row["prefixExact"] and sha(original) == row["originalSha256"]
        assert (helper / row["name"]).read_bytes() == original.read_bytes() + row["appendedTail"].encode()
        immutable.append({"path": str(helper / row["name"]), "sha256": row["outputSha256"]})
    for relative in ["runtime/package.json", "runtime/bun.lock", "autorouter-dependencies/package.json", "autorouter-dependencies/bun.lock", str(case_path.relative_to(root)), "cases/assessment-core/package.json", "cases/find-floating-copper-assessment.mjs", "cases/assessment-helper-proof.json"]:
        immutable.append({"path": str(root / relative), "sha256": sha(root / relative)})
    task = json.loads(case_path.read_text())
    assert task["sourceSha256"] == case["sourceSha256"]
    assert [task["expectedComponents"], task["expectedPads"], task["expectedNets"], task["expectedRoutableNets"]] == [case["components"], case["pads"], case["nets"], case["requestedNets"]]
    assert [task["captureDeadlineMs"], task["hardDeadlineMs"], task["assessmentDeadlineMs"]] == [plan["limitsMs"][key] for key in ["capture", "hard", "assessment"]]
    immutable += task["assessmentSourceFiles"] + task["implementationFiles"]
    immutable.append({"path": task["sourcePath"], "sha256": task["sourceSha256"]})
    aliases = []
    for folder in [root / "npm", root / "npm/autorouter", root / "cases", root / "sources/original", root / "sources/spaced", controller]:
        path = folder / "node_modules"
        assert path.is_symlink()
        aliases.append({"path": str(path), "target": os.readlink(path)})
    guard = {"dependencyGraph": dependency_graph(root), "resolutionAliases": aliases, "immutableFiles": immutable}
    (proof / "runtime-guard.json.gz").write_bytes(gzip.compress(json.dumps(guard, sort_keys=True).encode()))
    artifact = case["baselineArtifact"]
    api = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{artifact['id']}"
    actual = json.loads(subprocess.check_output(["gh", "api", api]))
    for field in ["id", "name", "size_in_bytes", "digest", "workflow_run"]:
        assert actual[field] == artifact[field], f"Baseline identity changed: {field}"
    archive = subprocess.check_output(["gh", "api", api + "/zip"])
    assert len(archive) == artifact["size_in_bytes"]
    assert "sha256:" + hashlib.sha256(archive).hexdigest() == artifact["digest"]
    destination = root / "published-baseline"
    destination.mkdir()
    with zipfile.ZipFile(io.BytesIO(archive)) as packet:
        names = packet.namelist()
        assert len(names) == len(set(names))
        assert set(names) == {row["name"] for row in case["baselineFiles"]}, "Baseline archive member set changed"
        for row in case["baselineFiles"]:
            assert len(Path(row["name"]).parts) == 1 and row["name"] not in [".", ".."]
            assert names.count(row["name"]) == 1
            data = packet.read(row["name"])
            assert len(data) == row["bytes"] and hashlib.sha256(data).hexdigest() == row["sha256"]
            (destination / row["name"]).write_bytes(data)
    (destination / "archive-proof.json").write_text(json.dumps({"artifact": actual, "archiveDigestAndSizeVerified": True}, indent=2) + "\n")
    raise SystemExit(0)

published = json.loads(published_path.read_text())
original = root / "npm/core"
alias = root / "runtime/node_modules/@tscircuit/core"
change = plan["runtimeChange"]
core = next(row for row in published["packages"] if row["name"] == "@tscircuit/core")

if args.operation == "source":
    verify_packages(published)
    verify_graph()
    source = root / "source-core"
    assert subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip() == plan["source"]["baseCommit"]
    source_file = source / plan["source"]["path"]
    assert sha(source_file) == plan["source"]["beforeSha256"]
    publication_policy = source / plan["publicationPolicySource"]["path"]
    assert sha(publication_policy) == plan["publicationPolicySource"]["sha256"]
    shutil.copyfile(publication_policy, proof / "Group.source.ts")
    shutil.copyfile(source_file, proof / "Renderable.base.ts")
    patch = controller / "core-reentrancy-production.patch"
    assert sha(patch) == plan["source"]["patchSha256"]
    subprocess.run(["git", "apply", "--check", str(patch)], cwd=source, check=True)
    subprocess.run(["git", "apply", str(patch)], cwd=source, check=True)
    assert sha(source_file) == plan["source"]["afterSha256"]
    shutil.copyfile(source_file, proof / "Renderable.candidate.ts")
    subprocess.run(["bun", str(controller / "qualifyCoreReentrancy.mjs"), str(root)], check=True)
    test_source = controller / "core-reentrancy-repro.test.tsx"
    assert sha(test_source) == plan["source"]["testSha256"]
    shutil.copyfile(controller / "tsconfig.json", proof / "tsconfig.json")
    (proof / "package.json").write_text('{"name":"core-reentrancy-qualification","private":true,"type":"module"}\n')
    (proof / "node_modules").symlink_to(root / "runtime/node_modules")
    tests = {}
    for lane in ["base", "candidate"]:
        package = proof / f"test-core-{lane}"
        for row in core["publishedFiles"]:
            target = package / row["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            if lane == "candidate" and row["path"] == change["path"]:
                before = (original / row["path"]).read_bytes()
                assert hashlib.sha256(before).hexdigest() == change["beforeSha256"]
                assert before.count(change["before"].encode()) == 1
                target.write_bytes(before.replace(change["before"].encode(), change["after"].encode()))
                assert sha(target) == change["afterSha256"]
            else:
                os.link(original / row["path"], target)
        (package / "node_modules").symlink_to(root / "runtime/node_modules")
        source_text = test_source.read_text()
        fixture_import = 'import { getTestFixture } from "tests/fixtures/get-test-fixture"'
        assert source_text.count(fixture_import) == 1
        adaptation = '\n'.join([
            'import { RootCircuit } from ' + json.dumps(str(package / core["entryRelative"])),
            'import { writeFileSync } from "node:fs"',
            'import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"',
            'const events: unknown[] = []',
            'const getTestFixture = () => {',
            '  globalThis.coreReentrancyWasmPolicy.beginRouting()',
            '  const circuit = new RootCircuit({ platform: { localCacheEngine: undefined } })',
            '  circuit.on("asyncEffect:start", (event) => events.push({ type: "asyncEffect:start", ...event }))',
            '  circuit.on("asyncEffect:end", (event) => events.push({ type: "asyncEffect:end", ...event }))',
            '  circuit.on("solver:started", (event) => {',
            '    if (/wasm|krt/i.test(event.solverName) || (/AutoroutingPipeline|AssignableAutorouting/.test(event.solverName) && event.solverName !== "AutoroutingPipelineSolver9_PreloadedTraceGraph")) throw new Error(`Forbidden routing strategy ${event.solverName}`)',
            '    if (event.solverParams?.options?.cacheProvider) throw new Error("Unexpected routing cache")',
            '    events.push({ type: "solver:started", solverName: event.solverName, vias: circuit.db.pcb_via.list().length })',
            '  })',
            '  return { circuit }',
            '}',
            'const saveSnapshot = (circuitJson: any[], options: any) => {',
            '  writeFileSync(' + json.dumps(str(proof / f"{lane}.circuit.json")) + ', JSON.stringify(circuitJson, null, 2))',
            '  writeFileSync(' + json.dumps(str(proof / f"{lane}.pcb.svg")) + ', convertCircuitJsonToPcbSvg(circuitJson, options))',
            '  writeFileSync(' + json.dumps(str(proof / f"{lane}.events.json")) + ', JSON.stringify(events, null, 2))',
            '  writeFileSync(' + json.dumps(str(proof / f"{lane}.wasm.json")) + ', JSON.stringify(globalThis.coreReentrancyWasmPolicy.usage, null, 2))',
            '}',
        ])
        source_text = source_text.replace(fixture_import, adaptation)
        snapshot = 'await expect(circuit.getCircuitJson()).toMatchPcbSnapshot(import.meta.path, {'
        assert source_text.count(snapshot) == 1
        source_text = source_text.replace(snapshot, 'await saveSnapshot(circuit.getCircuitJson(), {')
        test = proof / f"{lane}.test.tsx"
        test.write_text(source_text)
        environment = {**os.environ, "NO_COLOR": "1"}
        environment.pop("BUN_UPDATE_SNAPSHOTS", None)
        command = ["bun", "test", "--preload", str(controller / "core-reentrancy-wasm-preload.ts"), str(test), "--timeout", "60000"]
        tested = subprocess.run(command, cwd=proof, env=environment, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        log = proof / f"{lane}-test.log"
        log.write_text(tested.stdout)
        tests[lane] = {"command": command, "exitCode": tested.returncode, "testSha256": sha(test), "logSha256": sha(log), "adaptation": "Only fixture import and snapshot writer replaced; authored board, event listener and all three assertions unchanged"}
        assert json.loads((proof / f"{lane}.wasm.json").read_text())["routingOrUnknownAttempts"] == 0
        if lane == "base":
            assert tested.returncode == 1 and 'expect(viasSeenByPour).toBe(circuit.db.pcb_via.list().length)' in tested.stdout and '3 expect() calls' in tested.stdout, "Baseline must fail only the stale-pour assertion"
        else:
            assert tested.returncode == 0 and '3 expect() calls' in tested.stdout, "Candidate public repro failed"
    gate_path = proof / "source-gate.json"
    gate = json.loads(gate_path.read_text())
    gate["reproPair"] = {"passed": True, "sourceTestSha256": sha(test_source), "tests": tests}
    gate_path.write_text(json.dumps(gate, indent=2) + "\n")
    verify_packages(published)
    verify_graph()
    raise SystemExit(0)

if args.operation == "restore":
    active = json.loads(manifest_path.read_text())
    verify_packages(active)
    verify_graph(active["sourceOverrides"])
    assert alias.is_symlink() and alias.resolve() in [original, root / "npm/core-reentrancy"]
    alias.unlink()
    alias.symlink_to(original)
    shutil.copyfile(published_path, manifest_path)
    verify_packages(published)
    verify_graph()
    (proof / "assessment-runtime-restored.json").write_text(json.dumps({"publishedAliasesRestored": True, "allPublishedFilesVerified": True, "publishedManifestSha256": sha(published_path), "activeCandidateManifestSha256": sha(root / "candidate-runtime-manifest.json")}, indent=2) + "\n")
    raise SystemExit(0)

assert plan["frozen"], "Root must freeze the reviewed qualification plan"
gate = json.loads((proof / "source-gate.json").read_text())
assert gate["assertionsPassed"] and gate["sourceMethodBodyEquality"] == ["_queueAsyncEffect"]
assert gate["reproPair"]["passed"]
assert json.loads((proof / "audit-self-test.json").read_text())["selfTest"]["passed"]
tiny_audit = json.loads((proof / "tiny-via-pour-audit.json").read_text())
assert tiny_audit["baseline"]["physicalContactCount"] > 0
assert tiny_audit["comparison"]["candidatePhysicallyClear"]
assert gate["candidateChunkSha256"] == change["afterSha256"]
verify_packages(published)
verify_graph()
assert core["entrySha256"] == change["unchangedCoreEntrySha256"]
before = (original / change["path"]).read_bytes()
assert sha(original / change["path"]) == change["beforeSha256"]
assert before.count(change["before"].encode()) == change["count"]
after = before.replace(change["before"].encode(), change["after"].encode())
assert hashlib.sha256(after).hexdigest() == change["afterSha256"]
overlay = root / "npm/core-reentrancy"
overlay.mkdir()
files = []
for row in core["publishedFiles"]:
    target = overlay / row["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if row["path"] == change["path"]:
        target.write_bytes(after)
        files.append({**row, "bytes": len(after), "sha256": change["afterSha256"]})
    else:
        os.link(original / row["path"], target)
        files.append(row)
assert alias.is_symlink() and alias.resolve() == original
alias.unlink()
alias.symlink_to(overlay)
override = {"name": "@tscircuit/core", "kind": "reviewed-source-chunk", "sourcePatchSha256": plan["source"]["patchSha256"], "changedFile": change, "unchangedRuntimeDependencies": True}
candidate = {**published, "sourceOverrides": True, "experiment": "core-render-reentrancy", "dependencyOverrides": [override], "packages": [{**row, "entry": str(overlay / core["entryRelative"]), "publishedFiles": files} if row["name"] == core["name"] else row for row in published["packages"]], "packageAliases": [{**row, "target": str(overlay)} if row["alias"] == str(alias) else row for row in published["packageAliases"]]}
manifest_path.write_text(json.dumps(candidate, indent=2) + "\n")
shutil.copyfile(manifest_path, root / "candidate-runtime-manifest.json")
verify_packages(candidate)
verify_graph(True)
task = json.loads(case_path.read_text())
assert task["sourceSha256"] == case["sourceSha256"]
assert [task["captureDeadlineMs"], task["hardDeadlineMs"], task["assessmentDeadlineMs"]] == [plan["limitsMs"][key] for key in ["capture", "hard", "assessment"]]
task.update(experiment="core-render-reentrancy", dependencyOverrides=[override], restorePublishedCoreBeforeAssessment=str(root), runtimeChunkProof=change)
(root / "cases" / f"candidate-{case_key}.json").write_text(json.dumps(task, indent=2) + "\n")
(proof / "overlay-proof.json").write_text(json.dumps({"onlyRenderableChunkChanged": True, "candidateManifestSha256": sha(manifest_path), "sourceGateSha256": sha(proof / "source-gate.json"), "change": change, "allPackageFilesVerified": True}, indent=2) + "\n")
