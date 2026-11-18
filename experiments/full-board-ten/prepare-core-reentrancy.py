#!/usr/bin/env python3
"""Authenticate source qualification and map only the reviewed routing/pour changes."""
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
changes = {row["path"]: row for row in plan["runtimeChanges"]}
core = next(row for row in published["packages"] if row["name"] == "@tscircuit/core")

if args.operation == "source":
    verify_packages(published)
    verify_graph()
    qualification = plan["sourceQualification"]
    artifact = qualification["artifact"]
    assert artifact, "Actual source qualification artifact must be frozen"
    api = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{artifact['id']}"
    actual = json.loads(subprocess.check_output(["gh", "api", api]))
    for field in ["id", "name", "expired", "size_in_bytes", "digest", "workflow_run"]:
        assert actual[field] == artifact[field], f"Source artifact identity changed: {field}"
    source_run = json.loads(subprocess.check_output(["gh", "api", f"repos/tscircuit/tscircuit-autorouter/actions/runs/{actual['workflow_run']['id']}"]))
    assert source_run["status"] == "completed" and source_run["conclusion"] == "success"
    assert source_run["head_sha"] == actual["workflow_run"]["head_sha"]
    archive = subprocess.check_output(["gh", "api", api + "/zip"])
    assert len(archive) == artifact["size_in_bytes"]
    assert "sha256:" + hashlib.sha256(archive).hexdigest() == artifact["digest"]
    source_proof = proof / "actual-source-pair"
    source_proof.mkdir()
    with zipfile.ZipFile(io.BytesIO(archive)) as packet:
        names = packet.namelist()
        assert len(names) == len(set(names))
        assert set(names) == {row["name"] for row in qualification["files"]}
        for row in qualification["files"]:
            relative = Path(row["name"])
            assert not relative.is_absolute() and ".." not in relative.parts
            data = packet.read(row["name"])
            assert len(data) == row["bytes"] and hashlib.sha256(data).hexdigest() == row["sha256"]
            target = source_proof / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    assert sha(source_proof / "source-plan.json") == qualification["sourcePlanSha256"]
    assert sha(source_proof / "result.json") == qualification["resultSha256"]
    source_result = json.loads((source_proof / "result.json").read_text())
    assert source_result["passed"] is True
    assert source_result["baseCommit"] == plan["source"]["baseCommit"]
    assert source_result["candidateCommit"] == plan["source"]["candidateCommit"]
    for key in ["oneDependencyInstallation", "installedPackageMetadataAndAliasesUnchanged", "genericAsyncEffectStartupByteIdentical", "sevenTimingTestsByteIdentical", "baselineFailsOnlyAfterPreviewAndFinalRouteViaAssertions"]:
        assert source_result[key] is True, f"Required actual source evidence missing: {key}"
    assert sha(source_proof / "production.patch") == plan["source"]["patchSha256"]
    assert (source_proof / "production.patch").read_bytes() == (controller / "core-reentrancy-production.patch").read_bytes()
    for row in plan["source"]["files"]:
        for lane, checksum in [("base", "beforeSha256"), ("candidate", "afterSha256")]:
            assert sha(source_proof / "files" / lane / row["path"]) == row[checksum]
    test_source = controller / "core-reentrancy-repro.test.tsx"
    assert sha(test_source) == plan["source"]["testSha256"]
    assert sha(source_proof / "files/candidate" / plan["source"]["testPath"]) == plan["source"]["testSha256"]
    (proof / "source-artifact-proof.json").write_text(json.dumps({"artifact": actual, "sourceRun": {key: source_run[key] for key in ["id", "head_sha", "status", "conclusion"]}, "archiveDigestAndAllMembersVerified": True}, indent=2) + "\n")
    parser_module = root / "autorouter-dependencies/node_modules/typescript/lib/typescript.js"
    assert parser_module.is_file(), "Frozen autorouter dependency graph must provide the parser"
    subprocess.run(["bun", str(controller / "qualifyCoreReentrancy.mjs"), str(root), str(source_proof), str(parser_module)], check=True)
    actual_changes = json.loads((proof / "runtime-changes.json").read_text())
    assert len(actual_changes) == len(changes)
    for row in actual_changes:
        for key in ["path", "beforeSha256", "afterSha256"]:
            assert row[key] == changes[row["path"]][key], f"Frozen runtime mapping changed: {key}"
    shutil.copyfile(controller / "tsconfig.json", proof / "tsconfig.json")
    (proof / "package.json").write_text('{"name":"core-pour-qualification","private":true,"type":"module"}\n')
    (proof / "node_modules").symlink_to(root / "runtime/node_modules")
    tests = {}
    for lane in ["base", "candidate"]:
        package = proof / f"test-core-{lane}"
        export_tail = "\nexport { TscircuitAutorouter };\n"
        for row in core["publishedFiles"]:
            target = package / row["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            selected = original / row["path"]
            if lane == "candidate" and row["path"] in changes:
                selected = proof / "reviewed-overlay" / row["path"]
                assert sha(selected) == changes[row["path"]]["afterSha256"]
            if row["path"] == core["entryRelative"]:
                target.write_bytes(selected.read_bytes() + export_tail.encode())
                assert target.read_bytes() == selected.read_bytes() + export_tail.encode()
            elif selected != original / row["path"]:
                shutil.copyfile(selected, target)
            else:
                os.link(selected, target)
        (package / "node_modules").symlink_to(root / "runtime/node_modules")
        source_text = test_source.read_text()
        router_import = 'import { TscircuitAutorouter } from "lib/utils/autorouting/CapacityMeshAutorouter"'
        assert source_text.count(router_import) == 1
        source_text = source_text.replace(router_import, 'import { TscircuitAutorouter } from ' + json.dumps(str(package / core["entryRelative"])))
        fixture_import = 'import { getTestFixture } from "tests/fixtures/get-test-fixture"'
        assert source_text.count(fixture_import) == 1
        adaptation = '\n'.join([
            'import { afterEach } from "bun:test"',
            'import { RootCircuit } from ' + json.dumps(str(package / core["entryRelative"])),
            'import { writeFileSync } from "node:fs"',
            'import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"',
            'const events: unknown[] = []',
            'let capturedCircuit: RootCircuit',
            'const getTestFixture = () => {',
            '  globalThis.coreReentrancyWasmPolicy.beginRouting()',
            '  const circuit = new RootCircuit({ platform: { localCacheEngine: undefined } })',
            '  capturedCircuit = circuit',
            '  circuit.on("asyncEffect:start", (event) => events.push({ type: "asyncEffect:start", ...event }))',
            '  circuit.on("asyncEffect:end", (event) => events.push({ type: "asyncEffect:end", ...event }))',
            '  circuit.on("solver:started", (event) => {',
            '    if (/wasm|krt/i.test(event.solverName) || (/AutoroutingPipeline|AssignableAutorouting/.test(event.solverName) && event.solverName !== "AutoroutingPipelineSolver9_PreloadedTraceGraph")) throw new Error(`Forbidden routing strategy ${event.solverName}`)',
            '    if (event.solverParams?.options?.cacheProvider) throw new Error("Unexpected routing cache")',
            '    events.push({ type: "solver:started", solverName: event.solverName, vias: circuit.db.pcb_via.list().length })',
            '  })',
            '  return { circuit }',
            '}',
            'const saveSnapshot = (circuitJson: unknown[], options: unknown) => {',
            '  writeFileSync(' + json.dumps(str(proof / f"{lane}.circuit.json")) + ', JSON.stringify(circuitJson, null, 2))',
            '  writeFileSync(' + json.dumps(str(proof / f"{lane}.pcb.svg")) + ', convertCircuitJsonToPcbSvg(circuitJson, options))',
            '}',
            'afterEach(() => {',
            '  if (capturedCircuit) saveSnapshot(capturedCircuit.db.toArray(), { layer: "inner1", showPcbNotes: true })',
            '  writeFileSync(' + json.dumps(str(proof / f"{lane}.events.json")) + ', JSON.stringify(events, null, 2))',
            '  writeFileSync(' + json.dumps(str(proof / f"{lane}.wasm.json")) + ', JSON.stringify(globalThis.coreReentrancyWasmPolicy.usage, null, 2))',
            '})',
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
        tests[lane] = {"command": command, "exitCode": tested.returncode, "testSha256": sha(test), "logSha256": sha(log), "exportTail": export_tail, "adaptation": "Only internal router/fixture imports and snapshot persistence adapted; real held routing, preview assertions and final clearance assertions unchanged. Identical export-only tail is confined to both focused test packages."}
        assert json.loads((proof / f"{lane}.wasm.json").read_text())["routingOrUnknownAttempts"] == 0
        focused_circuit = json.loads((proof / f"{lane}.circuit.json").read_text())
        assert sum(row["type"] == "pcb_trace" for row in focused_circuit) == 1
        assert sum(row["type"] == "pcb_via" for row in focused_circuit) == 2
        focused_events = json.loads((proof / f"{lane}.events.json").read_text())
        pour_events = [row for row in focused_events if row["type"] == "solver:started" and row["solverName"] == "CopperPourPipelineSolver"]
        assert pour_events
        assert "7 expect() calls" in tested.stdout, "All held-preview and final routing assertions must run"
        if lane == "base":
            assert tested.returncode == 1 and 'expect(viasSeenByPour).toBe(circuit.db.pcb_via.list().length)' in tested.stdout and "timed out" not in tested.stdout.lower(), "Baseline must reach and fail the final stale-pour assertion"
            assert "Expected: 2" in tested.stdout and "Received: 1" in tested.stdout
            assert pour_events[-1]["vias"] == 1
        else:
            assert tested.returncode == 0, "Candidate public repro failed"
            assert pour_events[-1]["vias"] == 2
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
assert gate["genericSchedulingUnchanged"] and gate["sourceBuildToPublishedBaseEquivalence"]
assert gate["candidateMappingSemanticallyIdentical"] and gate["reproPair"]["passed"]
assert json.loads((proof / "audit-self-test.json").read_text())["selfTest"]["passed"]
tiny_audit = json.loads((proof / "tiny-via-pour-audit.json").read_text())
assert tiny_audit["baseline"]["physicalContactCount"] > 0
assert tiny_audit["comparison"]["candidatePhysicallyClear"]
verify_packages(published)
verify_graph()
overlay = root / "npm/core-reentrancy"
overlay.mkdir()
files = []
for row in core["publishedFiles"]:
    target = overlay / row["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if row["path"] in changes:
        change = changes[row["path"]]
        assert sha(original / row["path"]) == change["beforeSha256"]
        selected = proof / "reviewed-overlay" / row["path"]
        assert sha(selected) == change["afterSha256"]
        shutil.copyfile(selected, target)
        files.append({**row, "bytes": target.stat().st_size, "sha256": change["afterSha256"]})
    else:
        os.link(original / row["path"], target)
        files.append(row)
assert alias.is_symlink() and alias.resolve() == original
alias.unlink()
alias.symlink_to(overlay)
override = {"name": "@tscircuit/core", "kind": "reviewed-routing-pour-source", "sourcePatchSha256": plan["source"]["patchSha256"], "changedFiles": list(changes.values()), "unchangedRuntimeDependencies": True}
entry_sha = changes[core["entryRelative"]]["afterSha256"]
candidate = {**published, "sourceOverrides": True, "experiment": "core-pour-dependency", "dependencyOverrides": [override], "packages": [{**row, "entry": str(overlay / core["entryRelative"]), "entrySha256": entry_sha, "publishedFiles": files} if row["name"] == core["name"] else row for row in published["packages"]], "packageAliases": [{**row, "target": str(overlay)} if row["alias"] == str(alias) else row for row in published["packageAliases"]]}
manifest_path.write_text(json.dumps(candidate, indent=2) + "\n")
shutil.copyfile(manifest_path, root / "candidate-runtime-manifest.json")
verify_packages(candidate)
verify_graph(True)
task = json.loads(case_path.read_text())
assert task["sourceSha256"] == case["sourceSha256"]
assert [task["captureDeadlineMs"], task["hardDeadlineMs"], task["assessmentDeadlineMs"]] == [plan["limitsMs"][key] for key in ["capture", "hard", "assessment"]]
task.update(experiment="core-pour-dependency", dependencyOverrides=[override], restorePublishedCoreBeforeAssessment=str(root), runtimeChunkProof={"changedFiles": list(changes.values())})
(root / "cases" / f"candidate-{case_key}.json").write_text(json.dumps(task, indent=2) + "\n")
(proof / "overlay-proof.json").write_text(json.dumps({"onlyReviewedRoutingAndPourSpansChanged": True, "candidateManifestSha256": sha(manifest_path), "sourceGateSha256": sha(proof / "source-gate.json"), "changes": list(changes.values()), "allPackageFilesVerified": True}, indent=2) + "\n")
