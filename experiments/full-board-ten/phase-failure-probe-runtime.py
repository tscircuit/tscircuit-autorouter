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
                       if key not in {"dependencyOverrides", "corePhaseFailureProbe"}}
    return hashlib.sha256(json.dumps(original_fields, sort_keys=True).encode()).hexdigest()


def verify(root: Path, candidate_alias: bool) -> dict:
    proof = json.loads((root / "phase-failure-probe-install-proof.json").read_text())
    for item in proof["immutableFiles"] + proof["candidateFiles"]:
        if sha(Path(item["path"])) != item["sha256"]:
            raise RuntimeError(f"Qualification file changed: {item['path']}")
    for item in proof["originalAliases"]:
        expected = proof["candidateFolder"] if candidate_alias and item["name"] == "@tscircuit/core" else item["target"]
        if str(Path(item["path"]).resolve()) != expected:
            raise RuntimeError(f"Unexpected package alias: {item['name']}")
    task = json.loads(Path(proof["casePath"]).read_text())
    if case_policy(task) != proof["casePolicySha256"]:
        raise RuntimeError("Authentic case configuration changed")
    return {"originalPublishedFilesVerified": True, "candidateFilesVerified": True,
            "neutralHelperVerified": True, "assessmentUsesOriginalCore": not candidate_alias,
            "originalAutorouterSha256": proof["originalAutorouterSha256"],
            "candidateCoreSha256": proof["candidateCoreSha256"],
            "casePolicyVerified": True, "immutableFileCount": len(proof["immutableFiles"])}


def install(root: Path, board: str, cohort: str) -> dict:
    if (board, cohort) not in {("icepi", "original"), ("butterstick", "original")}:
        raise RuntimeError("Unexpected qualification case")
    controller = Path(__file__).resolve().parent
    anchor = json.loads((controller / "phase-failure-probe-anchor.json").read_text())
    release = json.loads((controller / "release.json").read_text())
    manifest_path = root / "runtime-manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest["mainVersion"] != "0.0.3203" or manifest["experiment"] != "phase-failure-probe-diagnostic" or manifest["dependencyOverrides"] or manifest["sourceOverrides"]:
        raise RuntimeError("Expected fresh published3203 qualification runtime")
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
    if core["entrySha256"] != anchor["originalCoreSHA256"] or autorouter["entrySha256"] != anchor["unchangedAutorouterSHA256"]:
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
    for replacement in anchor["replacements"]:
        old, new = replacement["old"].encode(), replacement["new"].encode()
        if source.count(old) != 1 or source.index(old) != replacement["byteOffset"] or candidate.count(old) != 1:
            raise RuntimeError(f"Phase failure probe anchor changed: {replacement['name']}")
        if hashlib.sha256(old).hexdigest() != replacement["oldSHA256"] or hashlib.sha256(new).hexdigest() != replacement["newSHA256"]:
            raise RuntimeError("Phase failure probe replacement proof changed")
        candidate = candidate.replace(old, new, 1)
    if hashlib.sha256(candidate).hexdigest() != anchor["expectedCandidateCoreSHA256"]:
        raise RuntimeError("Unexpected candidate Core digest")
    original_folder = root / "npm/core"
    candidate_folder = root / "npm/core-phase-failure-probe"
    candidate_folder.mkdir()
    candidate_files = []
    for item in core["publishedFiles"]:
        original = original_folder / item["path"]
        destination = candidate_folder / item["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        if original == Path(core["entry"]):
            destination.write_bytes(candidate)
            expected_hash = anchor["expectedCandidateCoreSHA256"]
        else:
            os.link(original, destination)
            expected_hash = item["sha256"]
        candidate_files.append({"path": str(destination), "sha256": expected_hash})
    original_manifest = root / "phase-failure-probe-original-runtime.json"
    original_manifest.write_bytes(manifest_bytes)
    immutable.append({"path": str(original_manifest), "sha256": sha(original_manifest)})
    case_path = root / "cases" / f"{board}-{cohort}.json"
    task = json.loads(case_path.read_text())
    if (task["captureDeadlineMs"], task["hardDeadlineMs"], task["assessmentDeadlineMs"]) != (900000, 960000, 180000):
        raise RuntimeError("Native case deadlines changed")
    proof = {"originalCoreEntry": core["entry"], "candidateFolder": str(candidate_folder),
             "candidateCoreSha256": anchor["expectedCandidateCoreSHA256"],
             "originalAutorouterSha256": autorouter["entrySha256"],
             "immutableFiles": immutable, "candidateFiles": candidate_files, "originalAliases": aliases,
             "casePath": str(case_path), "casePolicySha256": case_policy(task), "anchor": anchor}
    core["entry"] = str(candidate_folder / core["entryRelative"])
    core["entrySha256"] = proof["candidateCoreSha256"]
    manifest["sourceOverrides"] = True
    manifest["dependencyOverrides"] = [{"name": "@tscircuit/core", "from": "published0.0.2396", "to": "published0.0.2396-with-phase-failure-probe", "reason": "Diagnostic only: attempt independent ordinary phases after a reported failure before any accepted output; preserve failures and final publication policy"}]
    task["dependencyOverrides"] = manifest["dependencyOverrides"]
    task["corePhaseFailureProbe"] = {"originalCoreSha256": anchor["originalCoreSHA256"], "candidateCoreSha256": proof["candidateCoreSha256"]}
    manifest["corePhaseFailureProbe"] = task["corePhaseFailureProbe"]
    case_path.write_text(json.dumps(task, indent=2) + "\n")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    immutable.append({"path": str(manifest_path), "sha256": sha(manifest_path)})
    (root / "phase-failure-probe-install-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
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
        (root / "phase-failure-probe-assessment-proof.json").write_text(json.dumps(result, indent=2) + "\n")
    elif mode == "verify":
        result = verify(root, candidate_alias=False)
        (root / "phase-failure-probe-post-proof.json").write_text(json.dumps(result, indent=2) + "\n")
    else:
        raise ValueError("Expected install, restore, or verify mode")
    print("PHASE_FAILURE_PROBE_RUNTIME_PROOF " + json.dumps({"stage": mode, **result}, separators=(",", ":")))
