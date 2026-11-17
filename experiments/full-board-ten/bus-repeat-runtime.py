"""Install one byte-guarded Core copy in CI; restore original Core before assessment."""

import hashlib
import json
import os
from pathlib import Path
import sys


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def case_policy(task: dict) -> str:
    original_fields = {key: value for key, value in task.items()
                       if key not in {"dependencyOverrides", "busRepeatCandidate"}}
    return hashlib.sha256(json.dumps(original_fields, sort_keys=True).encode()).hexdigest()


def dependency_graph(root: Path) -> list[dict]:
    records = []
    for relative in ["runtime/node_modules", "autorouter-dependencies/node_modules"]:
        directory = root / relative
        for folder, directories, files in os.walk(directory, followlinks=False):
            for name in sorted(directories + files):
                path = Path(folder) / name
                record = {"path": str(path.relative_to(root))}
                if path.is_symlink():
                    record.update(kind="symlink", target=os.readlink(path))
                elif path.is_file():
                    record.update(kind="file", sha256=sha(path))
                elif path.is_dir():
                    record.update(kind="directory")
                else:
                    raise RuntimeError(f"Unexpected runtime dependency member: {path}")
                records.append(record)
    return sorted(records, key=lambda item: item["path"])


def verify(root: Path, candidate_alias: bool) -> dict:
    proof = json.loads((root / "bus-repeat-install-proof.json").read_text())
    for item in proof["immutableFiles"] + proof["candidateFiles"]:
        if sha(Path(item["path"])) != item["sha256"]:
            raise RuntimeError(f"Qualification file changed: {item['path']}")
    for item in proof["originalAliases"]:
        expected = proof["candidateFolder"] if candidate_alias and item["name"] == "@tscircuit/core" else item["target"]
        if str(Path(item["path"]).resolve()) != expected:
            raise RuntimeError(f"Unexpected package alias: {item['name']}")
    expected_graph = [dict(item) for item in proof["dependencyGraph"]]
    if candidate_alias:
        alias = next(item for item in expected_graph if item["path"] == "runtime/node_modules/@tscircuit/core")
        alias["target"] = proof["candidateFolder"]
    if dependency_graph(root) != expected_graph:
        raise RuntimeError("Installed runtime/autorouter dependency graph changed")
    for item in proof["resolutionAliases"]:
        path = Path(item["path"])
        if not path.is_symlink() or os.readlink(path) != item["target"]:
            raise RuntimeError(f"Resolution alias changed: {path}")
    task = json.loads(Path(proof["casePath"]).read_text())
    if case_policy(task) != proof["casePolicySha256"]:
        raise RuntimeError("Authentic case configuration changed")
    return {"originalPublishedFilesVerified": True, "candidateFilesVerified": True,
            "neutralHelperVerified": True, "dependencyGraphVerified": True, "assessmentUsesOriginalCore": not candidate_alias,
            "originalAutorouterSha256": proof["originalAutorouterSha256"],
            "candidateCoreSha256": proof["candidateCoreSha256"],
            "casePolicyVerified": True, "immutableFileCount": len(proof["immutableFiles"])}


def install(root: Path, board: str, cohort: str) -> dict:
    if (board, cohort) not in {("butterstick", "spaced")}:
        raise RuntimeError("Unexpected qualification case")
    controller = Path(__file__).resolve().parent
    anchor = json.loads((root / "bus-repeat-source/overlay-spans.json").read_text())
    plan = json.loads((controller / "bus-repeat-plan.json").read_text())
    source_gate = json.loads((root / "bus-repeat-source/source-gate.json").read_text())
    if not plan["frozen"] or not source_gate["passed"] or source_gate["candidateCoreSha256"] != plan["expectedCandidateCoreSha256"]:
        raise RuntimeError("Source/test/format gate has not passed")
    if sha(root / "bus-repeat-source/source-mapping.json") != plan["expectedSourceMappingSha256"]:
        raise RuntimeError("Source equivalence proof changed")
    release = json.loads((controller / "release.json").read_text())
    manifest_path = root / "runtime-manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest["mainVersion"] != "0.0.3230" or manifest["experiment"] != "published" or manifest["dependencyOverrides"] or manifest["sourceOverrides"]:
        raise RuntimeError("Expected fresh published3230 qualification runtime")
    if len(manifest["packages"]) != 4:
        raise RuntimeError("Expected the frozen four-package chain")
    immutable = []
    aliases = []
    for package in manifest["packages"]:
        expected = next(row for row in release["packages"] if row["name"] == package["name"])
        if package["version"] != expected["version"] or package["entrySha256"] != expected["entrySha256"]:
            raise RuntimeError("Published package identity changed")
        folder = root / "npm" / package["label"]
        if Path(package["entry"]) != folder / package["entryRelative"]:
            raise RuntimeError("Unexpected published package path")
        for item in package["publishedFiles"]:
            path = folder / item["path"]
            if sha(path) != item["sha256"]:
                raise RuntimeError(f"Published file changed: {path}")
            immutable.append({"path": str(path), "sha256": item["sha256"]})
        alias = root / "runtime/node_modules" / package["name"]
        if not alias.is_symlink() or alias.resolve() != folder:
            raise RuntimeError("Unexpected original package alias")
        aliases.append({"name": package["name"], "path": str(alias), "target": str(folder)})
    core = next(row for row in manifest["packages"] if row["name"] == "@tscircuit/core")
    autorouter = next(row for row in manifest["packages"] if row["name"] == "@tscircuit/capacity-autorouter")
    if core["entrySha256"] != anchor["originalCoreSha256"] or autorouter["entrySha256"] != plan["unchangedAutorouterSha256"]:
        raise RuntimeError("Unexpected frozen Core/autorouter bytes")
    helper = root / "cases/assessment-core"
    helper_proof = json.loads((root / "cases/assessment-helper-proof.json").read_text())
    if helper_proof["coreIdentity"]["entrySha256"] != core["entrySha256"]:
        raise RuntimeError("Neutral helper was not prepared from original Core")
    for item in helper_proof["files"]:
        original = Path(core["entry"]).parent / item["name"]
        expected = original.read_bytes() + item["appendedTail"].encode()
        if not item["prefixExact"] or sha(original) != item["originalSha256"] or (helper / item["name"]).read_bytes() != expected:
            raise RuntimeError("Neutral helper differs from the original published bytes and export tail")
        immutable.append({"path": str(helper / item["name"]), "sha256": item["outputSha256"]})
    for relative in ["runtime/package.json", "runtime/bun.lock", "autorouter-dependencies/package.json", "autorouter-dependencies/bun.lock", "cases/assessment-core/package.json", "cases/find-floating-copper-assessment.mjs", "cases/assessment-helper-proof.json"]:
        immutable.append({"path": str(root / relative), "sha256": sha(root / relative)})
    source = Path(core["entry"]).read_bytes()
    candidate = source
    for span in sorted(anchor["spans"], key=lambda span: span["byteOffset"], reverse=True):
        old, new = span["oldBlock"].encode(), span["newBlock"].encode()
        offset = span["byteOffset"]
        if source.count(old) != 1 or source[offset:offset + len(old)] != old:
            raise RuntimeError("Reviewed Bus declaration anchor changed")
        if hashlib.sha256(old).hexdigest() != span["oldBlockSha256"] or hashlib.sha256(new).hexdigest() != span["newBlockSha256"]:
            raise RuntimeError("Reviewed Bus declaration digest changed")
        candidate = candidate[:offset] + new + candidate[offset + len(old):]
    if hashlib.sha256(candidate).hexdigest() != anchor["candidateCoreSha256"]:
        raise RuntimeError("Unexpected candidate Core digest")
    original_folder = root / "npm/core"
    candidate_folder = root / "npm/core-bus-repeat"
    candidate_folder.mkdir()
    candidate_files = []
    for item in core["publishedFiles"]:
        original = original_folder / item["path"]
        destination = candidate_folder / item["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        if original == Path(core["entry"]):
            destination.write_bytes(candidate)
            expected_hash = anchor["candidateCoreSha256"]
        else:
            os.link(original, destination)
            expected_hash = item["sha256"]
        candidate_files.append({"path": str(destination), "sha256": expected_hash})
    original_manifest = root / "bus-repeat-original-runtime.json"
    original_manifest.write_bytes(manifest_bytes)
    immutable.append({"path": str(original_manifest), "sha256": sha(original_manifest)})
    case_path = root / "cases" / f"{board}-{cohort}.json"
    task = json.loads(case_path.read_text())
    if (task["captureDeadlineMs"], task["hardDeadlineMs"], task["assessmentDeadlineMs"]) != (900000, 960000, 180000):
        raise RuntimeError("Native case deadlines changed")
    graph = dependency_graph(root)
    resolution_aliases = []
    for folder in [root / "npm", root / "npm/autorouter", root / "cases", root / "sources/original", root / "sources/spaced", controller]:
        path = folder / "node_modules"
        if not path.is_symlink():
            raise RuntimeError(f"Expected resolution alias: {path}")
        resolution_aliases.append({"path": str(path), "target": os.readlink(path)})
    proof = {"dependencyGraph": graph, "resolutionAliases": resolution_aliases, "originalCoreEntry": core["entry"], "candidateFolder": str(candidate_folder),
             "candidateCoreSha256": anchor["candidateCoreSha256"],
             "originalAutorouterSha256": autorouter["entrySha256"],
             "immutableFiles": immutable, "candidateFiles": candidate_files, "originalAliases": aliases,
             "casePath": str(case_path), "casePolicySha256": case_policy(task), "anchor": anchor, "sourceGate": source_gate, "sourceMappingSha256": sha(root / "bus-repeat-source/source-mapping.json")}
    core["entry"] = str(candidate_folder / core["entryRelative"])
    core["entrySha256"] = proof["candidateCoreSha256"]
    manifest["sourceOverrides"] = True
    manifest["dependencyOverrides"] = [{"name": "@tscircuit/core", "from": "published0.0.2407", "to": "published0.0.2407-with-bus-repeat", "reason": "Skip repeated generated-site negotiation only after ordinary site choices naturally exhaust; unchanged provisional caps and layer retries"}]
    task["dependencyOverrides"] = manifest["dependencyOverrides"]
    task["busRepeatCandidate"] = {"originalCoreSha256": anchor["originalCoreSha256"], "candidateCoreSha256": proof["candidateCoreSha256"]}
    manifest["busRepeatCandidate"] = task["busRepeatCandidate"]
    case_path.write_text(json.dumps(task, indent=2) + "\n")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    immutable.append({"path": str(manifest_path), "sha256": sha(manifest_path)})
    (root / "bus-repeat-install-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
    alias = root / "runtime/node_modules/@tscircuit/core"
    alias.unlink()
    alias.symlink_to(candidate_folder)
    return verify(root, candidate_alias=True)


if __name__ == "__main__":
    mode, root_arg, *case = sys.argv[1:]
    root = Path(root_arg).resolve()
    if mode == "install":
        result = install(root, *case)
    elif mode == "restore":
        verify(root, candidate_alias=True)
        alias = root / "runtime/node_modules/@tscircuit/core"
        alias.unlink()
        alias.symlink_to(root / "npm/core")
        result = verify(root, candidate_alias=False)
        (root / "bus-repeat-assessment-proof.json").write_text(json.dumps(result, indent=2) + "\n")
    elif mode == "verify":
        result = verify(root, candidate_alias=False)
        (root / "bus-repeat-post-proof.json").write_text(json.dumps(result, indent=2) + "\n")
    else:
        raise ValueError("Expected install, restore, or verify mode")
    print("BUS_REPEAT_RUNTIME_PROOF " + json.dumps({"stage": mode, **result}, separators=(",", ":")))
