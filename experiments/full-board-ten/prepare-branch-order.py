#!/usr/bin/env python3
"""Authenticate a paired native run and the reviewed branch-order overlay."""
import argparse
import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def verify_packages(manifest):
    for package in manifest["packages"]:
        folder = Path(package["entry"])
        for _ in Path(package["entryRelative"]).parts:
            folder = folder.parent
        assert sha(Path(package["entry"])) == package["entrySha256"]
        for row in package["publishedFiles"]:
            assert sha(folder / row["path"]) == row["sha256"], f"Package changed: {package['name']}/{row['path']}"
    for row in manifest["packageAliases"]:
        assert Path(row["alias"]).is_symlink() and Path(row["alias"]).resolve() == Path(row["target"]).resolve()
    # The published main and Eval both resolve the selected Core, without a custom module hook.
    selected = next(row for row in manifest["packages"] if row["name"] == "@tscircuit/core")
    for package in manifest["packages"]:
        if package["name"] in ["tscircuit", "@tscircuit/eval"]:
            expression = "console.log(Bun.resolveSync('@tscircuit/core', " + json.dumps(str(Path(package["entry"]).parent)) + "))"
            resolved = subprocess.check_output(["bun", "-e", expression], text=True).strip()
            assert Path(resolved).resolve() == Path(selected["entry"]).resolve()


def dependency_graph():
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
        alias_row["target"] = str(overlay)
    assert dependency_graph() == expected, "Dependency graph changed outside the Core alias"
    for row in guard["resolutionAliases"]:
        path = Path(row["path"])
        assert path.is_symlink() and os.readlink(path) == row["target"]
    for row in guard["immutableFiles"]:
        assert sha(Path(row["path"])) == row["sha256"], f"Neutral source/helper changed: {row['path']}"


parser = argparse.ArgumentParser()
parser.add_argument("root", type=Path)
parser.add_argument("operation", choices=["baseline", "source", "candidate", "restore"])
parser.add_argument("board", choices=["glider", "imx6", "icepi", "butterstick"])
parser.add_argument("cohort", choices=["original", "spaced"])
args = parser.parse_args()
root = args.root.resolve()
controller = Path(__file__).resolve().parent
plan = json.loads((controller / "branch-order-plan.json").read_text())
if plan["qualificationReady"] is not True:
    raise RuntimeError("Branch-order source and exact Core mapping are pending; controller held")
assert len(plan["source"]["candidateCommit"]) == 40
selected_cases = [case for case in plan["cases"] if case["board"] == args.board and case["cohort"] == args.cohort]
assert len(selected_cases) == 1, "Case is outside the reviewed single-case screen"
required_harness_files = {
    'autorouter-dependencies/bun.lock',
    'autorouter-dependencies/package.json',
    'bootstrap.py',
    'calibrate-assessment.tsx',
    'compare-branch-order.py',
    'createCoarseRoutingDiagnostics.ts',
    'createBranchOrderOverlay.ts',
    'branch-order-production.patch',
    'branch-order-source-mapping.json',
    'harness-provenance.json',
    'package.json',
    'prepare-cases.ts',
    'prepare-branch-order.py',
    'published-release-provenance.json',
    'release.json',
    'render-published.tsx',
    'run-one.ts',
    'runtime/bun.lock',
    'runtime/package.json',
    'source-provenance.json',
    'tsconfig.json',
}
assert set(plan["frozenHarnessFiles"]) == required_harness_files, "Incomplete reviewed harness manifest"
assert set(plan["frozenFiles"]) == {"experiments/full-board-ten/" + name for name in required_harness_files} | {plan["workflow"]}, "Incomplete reviewed controller manifest"
for name, digest in plan["frozenFiles"].items():
    assert sha(controller.parents[1] / name) == digest, f"Reviewed controller changed: {name}"
for name, digest in plan["frozenHarnessFiles"].items():
    assert sha(controller / name) == digest, f"Reviewed harness changed: {name}"
assert sha(controller / "createBranchOrderOverlay.ts") == plan["sourceMappingToolSha256"]
assert sha(controller / "branch-order-source-mapping.json") == plan["sourceMappingSha256"]
proof = root / "branch-order"
proof.mkdir(exist_ok=True)
manifest_path = root / "runtime-manifest.json"
published_path = root / "published-runtime-manifest.json"
candidate_path = root / "candidate-runtime-manifest.json"
original = root / "npm/core"
overlay = root / "npm/core-branch-order"
alias = root / "runtime/node_modules/@tscircuit/core"

if args.operation == "baseline":
    manifest = json.loads(manifest_path.read_text())
    assert not manifest["sourceOverrides"] and not manifest["dependencyOverrides"] and manifest["experiment"] == "published"
    versions = {row["name"]: row["version"] for row in manifest["packages"]}
    assert versions == {"tscircuit": "0.0.3236", "@tscircuit/core": "0.0.2418", "@tscircuit/eval": "0.0.1811", "@tscircuit/capacity-autorouter": "0.0.1129"}
    assert manifest["runner"]["architecture"] in ["arm64", "aarch64"] and manifest["runner"]["bun"] == "1.4.3"
    assert manifest["runner"]["cpuCount"] == 8 and manifest["runner"]["artificialMemoryLimitApplied"] is False
    verify_packages(manifest)
    manifest["routingSourceOverride"] = None
    dump(published_path, manifest)
    dump(manifest_path, manifest)
    core = next(row for row in manifest["packages"] if row["name"] == "@tscircuit/core")
    assert core["entrySha256"] == plan["runtime"]["publishedCoreSha256"]
    helper = root / "cases/assessment-core"
    helper_proof = json.loads((root / "cases/assessment-helper-proof.json").read_text())
    assert helper_proof["coreIdentity"]["entrySha256"] == core["entrySha256"]
    immutable = []
    for row in helper_proof["files"]:
        source = Path(core["entry"]).parent / row["name"]
        assert row["prefixExact"] and sha(source) == row["originalSha256"]
        assert (helper / row["name"]).read_bytes() == source.read_bytes() + row["appendedTail"].encode()
        immutable.append({"path": str(helper / row["name"]), "sha256": row["outputSha256"]})
    for relative in ["runtime/package.json", "runtime/bun.lock", "autorouter-dependencies/package.json", "autorouter-dependencies/bun.lock", "cases/assessment-core/package.json", "cases/find-floating-copper-assessment.mjs", "cases/assessment-helper-proof.json"]:
        immutable.append({"path": str(root / relative), "sha256": sha(root / relative)})
    for case_spec in selected_cases:
        board, cohort = case_spec["board"], case_spec["cohort"]
        path = root / f"cases/{board}-{cohort}.json"
        task = json.loads(path.read_text())
        assert task["id"] == board and task["cohort"] == cohort
        assert task["expectedRoutableNets"] == case_spec["expectedRoutableNets"] and not task["fanout"] and task["mode"] == "phased"
        assert task["planes"] == (cohort == "original")
        assert [task["captureDeadlineMs"], task["hardDeadlineMs"], task["assessmentDeadlineMs"]] == [900000, 960000, 180000]
        immutable += task["assessmentSourceFiles"] + task["implementationFiles"]
        immutable += [{"path": str(path), "sha256": sha(path)}, {"path": task["sourcePath"], "sha256": task["sourceSha256"]}]
        task.update(runtimeManifestPath=str(published_path), routingSourceOverride=None)
        dump(root / f"lanes/base/cases/{board}-{cohort}.json", task)
    aliases = []
    for folder in [root / "npm", root / "npm/autorouter", root / "cases", root / "sources/original", root / "sources/spaced", controller]:
        path = folder / "node_modules"
        assert path.is_symlink()
        aliases.append({"path": str(path), "target": os.readlink(path)})
    guard = {"dependencyGraph": dependency_graph(), "resolutionAliases": aliases, "immutableFiles": immutable}
    (proof / "runtime-guard.json.gz").write_bytes(gzip.compress(json.dumps(guard, sort_keys=True).encode(), mtime=0))
    dump(proof / "published-baseline-proof.json", {"allPublishedFilesVerified": True, "publishedManifestSha256": sha(published_path), "runtimeGuardSha256": sha(proof / "runtime-guard.json.gz"), "historicalBaselineIsReferenceOnly": True})
    raise SystemExit(0)

published = json.loads(published_path.read_text())
core = next(row for row in published["packages"] if row["name"] == "@tscircuit/core")
if args.operation == "source":
    verify_packages(published)
    verify_graph()
    source = root / "source-bus"
    assert subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip() == plan["source"]["baseCommit"]
    assert not subprocess.check_output(["git", "-C", str(source), "status", "--porcelain"], text=True).strip()
    base = proof / "source-base"
    for relative, row in plan["source"]["files"].items():
        if row["beforeSha256"] is None:
            assert not (source / relative).exists(), f"New source path already exists: {relative}"
        else:
            assert sha(source / relative) == row["beforeSha256"]
            target = base / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / relative, target)
    patch = controller / "branch-order-production.patch"
    assert sha(patch) == plan["source"]["patchSha256"]
    subprocess.run(["git", "apply", "--index", "--check", str(patch)], cwd=source, check=True)
    subprocess.run(["git", "apply", "--index", str(patch)], cwd=source, check=True)
    assert set(subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=source, text=True).splitlines()) == set(plan["source"]["files"])
    assert not subprocess.check_output(["git", "diff", "--name-only"], cwd=source, text=True).strip()
    assert not subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard"], cwd=source, text=True).strip()
    assert subprocess.check_output(["git", "write-tree", "--prefix=lib/"], cwd=source, text=True).strip() == plan["source"]["candidateLibTree"]
    for relative, row in plan["source"]["files"].items():
        assert sha(source / relative) == row["afterSha256"]
    compiler = root / "runtime/node_modules/typescript/lib/typescript.js"
    subprocess.run(["bun", str(controller / "createBranchOrderOverlay.ts"), str(base), str(source), core["entry"], str(compiler), str(proof), plan["source"]["candidateCommit"]], check=True)
    assert sha(proof / "source-mapping.json") == plan["sourceMappingSha256"], "Runner qualification differs from reviewed source proof"
    verify_packages(published)
    verify_graph()
    raise SystemExit(0)

if args.operation == "restore":
    active = json.loads(manifest_path.read_text())
    assert active == json.loads(candidate_path.read_text()), "Unexpected runtime before restore"
    verify_packages(active)
    verify_graph(True)
    assert alias.is_symlink() and alias.resolve() == overlay
    alias.unlink()
    alias.symlink_to(original)
    shutil.copyfile(published_path, manifest_path)
    verify_packages(published)
    verify_graph()
    dump(proof / "assessment-runtime-restored.json", {"publishedAliasesRestored": True, "allPublishedFilesVerified": True, "publishedManifestSha256": sha(published_path), "candidateManifestSha256": sha(candidate_path), "routingSourceOverride": None})
    raise SystemExit(0)

verify_packages(published)
verify_graph()
assert sha(proof / "source-mapping.json") == plan["sourceMappingSha256"]
mapping = json.loads((proof / "overlay-spans.json").read_text())
assert mapping["passed"] and mapping["schemaVersion"] == plan["overlay"]["schemaVersion"] == 2
assert mapping["sourceCandidateCommit"] == plan["source"]["candidateCommit"]
assert mapping["sourceFiles"] == plan["source"]["files"]
assert mapping["externalAliases"] == plan["externalAliases"]
assert [row["name"] for row in mapping["replacedDeclarations"]] == plan["overlay"]["replace"]
assert [row["name"] for row in mapping["insertedDeclarations"]] == plan["overlay"]["insert"]
assert [row["name"] for row in mapping["unchangedDeclarations"]] == plan["overlay"]["unchanged"]
expected_spans = [("replace", name) for name in plan["overlay"]["replace"]] + [("insert", name) for name in plan["overlay"]["insert"]]
assert sorted((row["kind"], row["name"]) for row in mapping["spans"]) == sorted(expected_spans)
assert len(expected_spans) > 0
before = Path(core["entry"]).read_bytes()
assert hashlib.sha256(before).hexdigest() == mapping["originalCoreSha256"] == plan["runtime"]["publishedCoreSha256"]
utf16 = before.decode().encode("utf-16-le")
marker = b"// node_modules/@tscircuit/bus-lanes-solver/dist/index.js"
module_start = before.index(marker)
module_end = before.index(b"\n// ", module_start + 3) + 1
assert before.count(marker) == 1 and hashlib.sha256(before[module_start:module_end]).hexdigest() == mapping["originalBusModuleSha256"]
ordered = sorted(mapping["spans"], key=lambda row: (row["byteOffset"], 0 if row["kind"] == "insert" else 1))
previous_end = module_start
expected_segments = []
previous_character_end = 0
for row in ordered:
    start = row["byteOffset"]
    old, new = row["oldBlock"].encode(), row["newBlock"].encode()
    assert row["kind"] in ["replace", "insert"] and module_start <= start <= module_end
    assert start >= previous_end and start + len(old) <= module_end
    assert start == len(utf16[:2 * row["characterOffset"]].decode("utf-16-le").encode())
    assert hashlib.sha256(old).hexdigest() == row["oldBlockSha256"]
    assert hashlib.sha256(new).hexdigest() == row["newBlockSha256"]
    if row["kind"] == "replace":
        assert old and before[start:start + len(old)] == old and before.count(old) == 1
    else:
        assert not old and new and row["name"] in plan["overlay"]["insert"]
    segment = utf16[2 * previous_character_end:2 * row["characterOffset"]].decode("utf-16-le").encode()
    expected_segments.append({"start": previous_character_end, "end": row["characterOffset"], "sha256": hashlib.sha256(segment).hexdigest()})
    previous_end = start + len(old)
    previous_character_end = row["characterOffset"] + len(row["oldBlock"].encode("utf-16-le")) // 2
expected_segments.append({"start": previous_character_end, "end": len(utf16) // 2, "sha256": hashlib.sha256(utf16[2 * previous_character_end:].decode("utf-16-le").encode()).hexdigest()})
assert mapping["unchangedSegments"] == expected_segments
# Reconstruct only the reviewed spans and preserve every outside byte.
after = before
for row in sorted(mapping["spans"], key=lambda row: (row["byteOffset"], 1 if row["kind"] == "replace" else 0), reverse=True):
    start = row["byteOffset"]
    old, new = row["oldBlock"].encode(), row["newBlock"].encode()
    assert after[start:start + len(old)] == old
    after = after[:start] + new + after[start + len(old):]
assert hashlib.sha256(after).hexdigest() == mapping["candidateCoreSha256"] == plan["runtime"]["candidateCoreSha256"]
overlay.mkdir()
files = []
for row in core["publishedFiles"]:
    target = overlay / row["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if row["path"] == core["entryRelative"]:
        target.write_bytes(after)
        files.append({**row, "bytes": len(after), "sha256": mapping["candidateCoreSha256"]})
    else:
        os.link(original / row["path"], target)
        files.append(row)
assert alias.is_symlink() and alias.resolve() == original
alias.unlink()
alias.symlink_to(overlay)
changed_declarations = plan["overlay"]["replace"] + plan["overlay"]["insert"]
override = {"kind": "qualified-embedded-source-overlay", "package": "@tscircuit/core", "embeddedPackage": "@tscircuit/bus-lanes-solver", "embeddedBaseVersion": "0.0.62", "sourceBaseCommit": plan["source"]["baseCommit"], "sourceCandidateCommit": plan["source"]["candidateCommit"], "sourcePatchSha256": plan["source"]["patchSha256"], "publishedCoreSha256": mapping["originalCoreSha256"], "candidateCoreSha256": mapping["candidateCoreSha256"], "changedDeclarations": changed_declarations, "sourceMappingSha256": plan["sourceMappingSha256"], "autorouterSourceOverride": False, "unchangedRuntimeDependencies": True}
candidate = copy.deepcopy(published)
candidate.update(sourceOverrides=True, experiment=plan["experiment"], dependencyOverrides=[override], routingSourceOverride=override)
for row in candidate["packages"]:
    if row["name"] == "@tscircuit/core":
        row.update(entry=str(overlay / core["entryRelative"]), entrySha256=mapping["candidateCoreSha256"], publishedFiles=files)
        row["entryProvenance"] = "Source overlay; package metadata remains the authenticated published Core metadata"
for row in candidate["packageAliases"]:
    if row["alias"] == str(alias):
        row["target"] = str(overlay)
dump(candidate_path, candidate)
dump(manifest_path, candidate)
verify_packages(candidate)
verify_graph(True)
for case_spec in selected_cases:
    board, cohort = case_spec["board"], case_spec["cohort"]
    task = json.loads((root / f"lanes/base/cases/{board}-{cohort}.json").read_text())
    task.update(experiment=plan["experiment"], dependencyOverrides=[override], routingSourceOverride=override, runtimeManifestPath=str(candidate_path), restorePublishedCoreBeforeAssessment=str(root))
    dump(root / f"lanes/candidate/cases/{board}-{cohort}.json", task)
dump(proof / "overlay-proof.json", {"schemaVersion": 2, "onlyReviewedEmbeddedDeclarationsChanged": True, "sourceMappingSha256": sha(proof / "source-mapping.json"), "routingSourceOverride": override, "publishedCoreSha256": mapping["originalCoreSha256"], "candidateCoreSha256": mapping["candidateCoreSha256"], "candidateManifestSha256": sha(candidate_path), "publishedManifestSha256": sha(published_path), "allPackageFilesVerified": True, "unchangedDependencyGraphExceptCoreAlias": True, "mainAndEvalResolveSelectedCore": True, "publishedAssessmentHelperPreserved": True, "replacedDeclarations": plan["overlay"]["replace"], "insertedDeclarations": plan["overlay"]["insert"], "changedDeclarations": changed_declarations})
