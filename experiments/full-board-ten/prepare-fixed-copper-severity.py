#!/usr/bin/env python3
"""Authenticate one full native case and the reviewed fixed-copper severity messages."""
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
    # Resolve every consumer through normal package aliases, without importing a solver.
    selected_core = next(row for row in manifest["packages"] if row["name"] == "@tscircuit/core")
    selected_ar = next(row for row in manifest["packages"] if row["name"] == "@tscircuit/capacity-autorouter")
    selected_ar_root = Path(selected_ar["entry"]).parent.parent
    expected = {
        "@tscircuit/core": Path(selected_core["entry"]),
        "@tscircuit/capacity-autorouter": Path(selected_ar["entry"]),
        "@tscircuit/capacity-autorouter/package.json": selected_ar_root / "package.json",
        "@tscircuit/capacity-autorouter/runtime/bun": selected_ar_root / "dist/runtime/bun.js",
        "@tscircuit/capacity-autorouter/runtime/node": selected_ar_root / "dist/runtime/node.js",
    }
    for package in manifest["packages"]:
        if package["name"] in ["tscircuit", "@tscircuit/core", "@tscircuit/eval"]:
            expression = "console.log(JSON.stringify(" + json.dumps(list(expected)) + ".map(name => Bun.resolveSync(name, " + json.dumps(str(Path(package["entry"]).parent)) + "))))"
            resolved = json.loads(subprocess.check_output(["bun", "-e", expression], text=True))
            assert len(resolved) == len(expected)
            for actual, target in zip(resolved, expected.values()):
                assert Path(actual).resolve() == target.resolve(), f"Wrong dependency resolution from {package['name']}: {actual}"


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
        alias_row = next(row for row in expected if row["path"] == "runtime/node_modules/@tscircuit/capacity-autorouter")
        alias_row["target"] = str(overlay)
    assert dependency_graph() == expected, "Dependency graph changed outside the autorouter alias"
    if candidate:
        dependency_alias = overlay / "node_modules"
        assert dependency_alias.is_symlink() and dependency_alias.resolve() == (root / "autorouter-dependencies/node_modules").resolve()
    for row in guard["resolutionAliases"]:
        path = Path(row["path"])
        assert path.is_symlink() and os.readlink(path) == row["target"]
    for row in guard["immutableFiles"]:
        assert sha(Path(row["path"])) == row["sha256"], f"Neutral source/helper changed: {row['path']}"


parser = argparse.ArgumentParser()
parser.add_argument("root", type=Path)
parser.add_argument("operation", choices=["baseline", "source", "candidate", "restore"])
parser.add_argument("board", choices=["h616", "glider", "imx6", "icepi", "butterstick"])
parser.add_argument("cohort", choices=["original", "spaced"])
args = parser.parse_args()
root = args.root.resolve()
controller = Path(__file__).resolve().parent
plan = json.loads((controller / "fixed-copper-severity-plan.json").read_text())
if plan["qualificationReady"] is not True:
    raise RuntimeError("Reviewed source and exact autorouter mapping are pending; controller held")
assert len(plan["source"]["repositories"]) == 1
assert all(len(row["candidateCommit"]) == 40 for row in plan["source"]["repositories"])
selected_cases = [case for case in plan["cases"] if case["board"] == args.board and case["cohort"] == args.cohort]
assert len(selected_cases) == 1, "Case is outside the reviewed H616 spaced screen"
assert plan["cases"] == [{"board": "h616", "cohort": "spaced", "expectedRoutableNets": 121}]
assert set(plan["frozenFiles"]) == {"experiments/full-board-ten/" + name for name in plan["frozenHarnessFiles"]} | {plan["workflow"]}
for name, digest in plan["frozenFiles"].items():
    assert sha(controller.parents[1] / name) == digest, f"Reviewed controller changed: {name}"
assert sha(controller / "createFixedCopperSeverityOverlay.ts") == plan["sourceMappingToolSha256"]
assert sha(controller / "fixed-copper-severity-source-mapping.json") == plan["sourceMappingSha256"]
proof = root / "fixed-copper-severity"
proof.mkdir(exist_ok=True)
manifest_path = root / "runtime-manifest.json"
published_path = root / "published-runtime-manifest.json"
candidate_path = root / "candidate-runtime-manifest.json"
original = root / "npm/autorouter"
overlay = root / "npm/autorouter-fixed-copper-severity"
alias = root / "runtime/node_modules/@tscircuit/capacity-autorouter"

if args.operation == "baseline":
    manifest = json.loads(manifest_path.read_text())
    assert not manifest["sourceOverrides"] and not manifest["dependencyOverrides"] and manifest["experiment"] == "published"
    versions = {row["name"]: row["version"] for row in manifest["packages"]}
    assert versions == {"tscircuit": "0.0.3243", "@tscircuit/core": "0.0.2425", "@tscircuit/eval": "0.0.1818", "@tscircuit/capacity-autorouter": "0.0.1133"}
    assert manifest["runner"]["architecture"] in ["arm64", "aarch64"] and manifest["runner"]["bun"] == "1.4.3"
    assert manifest["runner"]["cpuCount"] == 8 and manifest["runner"]["artificialMemoryLimitApplied"] is False
    verify_packages(manifest)
    manifest["routingSourceOverride"] = None
    dump(published_path, manifest)
    dump(manifest_path, manifest)
    core = next(row for row in manifest["packages"] if row["name"] == "@tscircuit/core")
    assert core["entrySha256"] == plan["runtime"]["publishedCoreSha256"]
    autorouter = next(row for row in manifest["packages"] if row["name"] == "@tscircuit/capacity-autorouter")
    assert autorouter["entrySha256"] == plan["runtime"]["publishedAutorouterSha256"]
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
autorouter = next(row for row in published["packages"] if row["name"] == "@tscircuit/capacity-autorouter")
assert core["entrySha256"] == plan["runtime"]["publishedCoreSha256"]
if args.operation == "source":
    verify_packages(published)
    verify_graph()
    mapping = json.loads((controller / "fixed-copper-severity-source-mapping.json").read_text())
    assert mapping["schemaVersion"] == 2 and mapping["passed"] and mapping["sourceFrozen"]
    assert mapping["source"] == plan["source"]
    source_paths = {"tscircuit/tscircuit-autorouter": root / "source-autorouter"}
    assert {row["repository"] for row in mapping["source"]["repositories"]} == set(source_paths)
    for repository in mapping["source"]["repositories"]:
        source = source_paths[repository["repository"]]
        assert subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip() == repository["publishedBaseCommit"]
        assert not subprocess.check_output(["git", "-C", str(source), "status", "--porcelain"], text=True).strip()
        files = repository["changedFiles"]
        for row in files:
            assert sha(source / row["relative"]) == row["beforeSha256"]
        patch = controller / repository["productionPatchFile"]
        assert sha(patch) == repository["productionPatchSha256"]
        subprocess.run(["git", "apply", "--index", "--check", str(patch)], cwd=source, check=True)
        subprocess.run(["git", "apply", "--index", str(patch)], cwd=source, check=True)
        assert set(subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=source, text=True).splitlines()) == {row["relative"] for row in files}
        assert not subprocess.check_output(["git", "diff", "--name-only"], cwd=source, text=True).strip()
        assert not subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard"], cwd=source, text=True).strip()
        for row in files:
            assert sha(source / row["relative"]) == row["afterSha256"]
    source_map = original / "dist/index.js.map"
    assert sha(source_map) == plan["overlay"]["publishedSourceMapSha256"]
    shutil.copyfile(controller / "fixed-copper-severity-source-mapping.json", proof / "source-mapping.json")
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
mapping = json.loads((proof / "source-mapping.json").read_text())
assert mapping["passed"] and mapping["sourceFrozen"] and mapping["schemaVersion"] == 2
assert mapping["source"] == plan["source"]
assert len(mapping["spans"]) == len(plan["overlay"]["replace"]) + len(plan["overlay"]["insert"])
assert [(row["kind"], row["name"]) for row in mapping["spans"] if row["kind"] == "replace"] == [("replace", name) for name in plan["overlay"]["replace"]]
assert [(row["kind"], row["name"]) for row in mapping["spans"] if row["kind"] == "insert"] == [("insert", name) for name in plan["overlay"]["insert"]]
assert plan["overlay"]["replace"] and all(row["kind"] in ["replace", "insert"] for row in mapping["spans"])
before = Path(autorouter["entry"]).read_bytes()
assert hashlib.sha256(before).hexdigest() == mapping["originalAutorouterSha256"] == plan["runtime"]["publishedAutorouterSha256"]
parts = []
cursor = 0
for row in mapping["spans"]:
    start, end = row["startByte"], row["endByte"]
    old, new = row["originalText"].encode(), row["replacementText"].encode()
    assert 0 <= cursor <= start <= end <= len(before) and before[start:end] == old
    assert hashlib.sha256(old).hexdigest() == row["originalSha256"]
    assert hashlib.sha256(new).hexdigest() == row["replacementSha256"]
    if row["kind"] == "replace":
        assert old and row["compiledBaseEquivalent"] is True
    else:
        assert row["kind"] == "insert" and start == end and not old
    parts += [before[cursor:start], new]
    cursor = end
parts.append(before[cursor:])
after = b"".join(parts)
assert mapping["qualification"]["allOutsideBytesUnchanged"]
for row in mapping["unchangedSegments"]:
    original_segment = before[row["startByte"]:row["endByte"]]
    assert original_segment == after[row["candidateStartByte"]:row["candidateEndByte"]]
    assert hashlib.sha256(original_segment).hexdigest() == row["sha256"]
assert hashlib.sha256(after).hexdigest() == mapping["candidateAutorouterSha256"] == plan["runtime"]["candidateAutorouterSha256"]
overlay.mkdir()
files = []
for row in autorouter["publishedFiles"]:
    target = overlay / row["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if row["path"] == autorouter["entryRelative"]:
        target.write_bytes(after)
        files.append({**row, "bytes": len(after), "sha256": mapping["candidateAutorouterSha256"]})
    else:
        os.link(original / row["path"], target)
        files.append(row)
(overlay / "node_modules").symlink_to(root / "autorouter-dependencies/node_modules")
assert alias.is_symlink() and alias.resolve() == original
alias.unlink()
alias.symlink_to(overlay)
changed_declarations = plan["overlay"]["replace"] + plan["overlay"]["insert"]
override = {"kind": "qualified-source-overlay", "package": "@tscircuit/capacity-autorouter", "source": mapping["source"], "publishedAutorouterSha256": mapping["originalAutorouterSha256"], "candidateAutorouterSha256": mapping["candidateAutorouterSha256"], "publishedCoreSha256": plan["runtime"]["publishedCoreSha256"], "changedDeclarations": changed_declarations, "sourceMappingSha256": plan["sourceMappingSha256"], "autorouterSourceOverride": True, "coreSourceOverride": False, "unchangedRuntimeDependencies": True}
candidate = copy.deepcopy(published)
candidate.update(sourceOverrides=True, experiment=plan["experiment"], dependencyOverrides=[override], routingSourceOverride=override)
for row in candidate["packages"]:
    if row["name"] == "@tscircuit/capacity-autorouter":
        row.update(entry=str(overlay / autorouter["entryRelative"]), entrySha256=mapping["candidateAutorouterSha256"], publishedFiles=files)
        row["entryProvenance"] = "Source overlay; package metadata remains the authenticated published autorouter metadata"
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
dump(proof / "overlay-proof.json", {"schemaVersion": 2, "onlyReviewedEmbeddedDeclarationsChanged": True, "sourceMappingSha256": sha(proof / "source-mapping.json"), "routingSourceOverride": override, "publishedAutorouterSha256": mapping["originalAutorouterSha256"], "candidateAutorouterSha256": mapping["candidateAutorouterSha256"], "publishedCoreSha256": plan["runtime"]["publishedCoreSha256"], "candidateManifestSha256": sha(candidate_path), "publishedManifestSha256": sha(published_path), "allPackageFilesVerified": True, "unchangedDependencyGraphExceptAutorouterAlias": True, "mainCoreAndEvalResolveSelectedAutorouter": True, "publishedCoreUnchanged": True, "autorouterDependencyLinkPreserved": True, "publishedAssessmentHelperPreserved": True, "replacedDeclarations": plan["overlay"]["replace"], "insertedDeclarations": plan["overlay"]["insert"], "changedDeclarations": changed_declarations})
