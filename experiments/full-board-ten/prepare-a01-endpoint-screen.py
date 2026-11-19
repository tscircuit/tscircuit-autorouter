"""Authenticate the exact published H616 phase input without changing geometry."""

import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile


CONTROLLER = Path(__file__).resolve().parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verified_plan():
    plan = json.loads((CONTROLLER / "a01-endpoint-screen-plan.json").read_text())
    if plan["qualificationReady"] is not True:
        raise RuntimeError("HELD: H616 A01 endpoint screen is not qualified for execution")
    if plan["routingSourceOverrides"] is not True or plan["sourceOverrides"] is not True or plan["dependencyOverrides"] or plan["publishedRuntimeGraphUnchanged"] is not True:
        raise RuntimeError("Only the declared direct-entry candidate source change is allowed")
    if plan["captureDeadlineMs"] != 900000 or plan["hardDeadlineSeconds"] != 960:
        raise RuntimeError("Unexpected diagnostic deadline")
    for relative, expected in plan["frozenFiles"].items():
        data = (CONTROLLER.parents[1] / relative).read_bytes()
        if len(data) != expected["bytes"] or sha(data) != expected["sha256"]:
            raise RuntimeError(f"Frozen controller file changed: {relative}")
    baseline = (CONTROLLER / "baseline-run-plan.json").read_bytes()
    if len(baseline) != plan["frozenBaselinePlan"]["bytes"] or sha(baseline) != plan["frozenBaselinePlan"]["sha256"]:
        raise RuntimeError("Frozen published baseline plan changed")
    return plan


def verify_runtime(plan, output):
    manifest_path = output.parent / "runtime-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    release = json.loads((CONTROLLER / "release.json").read_text())
    if manifest["mainVersion"] != plan["mainVersion"] or manifest["experiment"] != "published":
        raise RuntimeError("Wrong published runtime")
    if manifest["sourceOverrides"] or manifest["dependencyOverrides"] or manifest.get("routingSourceOverride"):
        raise RuntimeError("Runtime has an override")
    if len(manifest["packages"]) != len(release["packages"]):
        raise RuntimeError("Published package membership changed")
    entries = []
    for expected in release["packages"]:
        package = next(item for item in manifest["packages"] if item["name"] == expected["name"])
        for key in ["name", "version", "entryRelative", "entrySha256", "integrity", "tarball"]:
            if package[key] != expected[key]:
                raise RuntimeError(f"Published package changed: {expected['name']}/{key}")
        entry = Path(package["entry"])
        if sha(entry.read_bytes()) != expected["entrySha256"]:
            raise RuntimeError(f"Published entry changed: {expected['name']}")
        entries.append({"name": package["name"], "version": package["version"], "entrySha256": package["entrySha256"]})
    for name, folder in [("runtimeDependencyFiles", "runtime"), ("autorouterDependencyFiles", "autorouter-dependencies")]:
        for key, filename in [("packageSha256", "package.json"), ("lockSha256", "bun.lock")]:
            expected = sha((CONTROLLER / folder / filename).read_bytes())
            if manifest[name][key] != expected or sha((output.parent / folder / filename).read_bytes()) != expected:
                raise RuntimeError(f"Published dependency graph changed: {folder}/{filename}")
    if manifest["runner"]["architecture"] not in ["aarch64", "arm64"] or manifest["runner"]["bun"] != "1.4.3" or manifest["runner"]["cpuCount"] != 8 or manifest["runner"]["artificialMemoryLimitApplied"] is not False:
        raise RuntimeError("Unexpected diagnostic platform")
    for alias in manifest["packageAliases"]:
        if Path(alias["alias"]).resolve() != Path(alias["target"]).resolve():
            raise RuntimeError("Published package alias changed")
    if (output.parent / "npm/node_modules").resolve() != (output.parent / "runtime/node_modules").resolve() or (output.parent / "npm/autorouter/node_modules").resolve() != (output.parent / "autorouter-dependencies/node_modules").resolve():
        raise RuntimeError("Published dependency resolution changed")
    return {"manifestSha256": sha(manifest_path.read_bytes()), "packages": entries, "sourceOverrides": False}


def prepare_overlay(plan, output):
    before = verify_runtime(plan, output)
    candidate = plan["sourceCandidate"]
    mapping_bytes = (CONTROLLER / candidate["mappingFile"]).read_bytes()
    if sha(mapping_bytes) != candidate["mappingSha256"]:
        raise RuntimeError("Frozen source mapping changed")
    mapping = json.loads(mapping_bytes)
    if mapping["schemaVersion"] != 1:
        raise RuntimeError("Unexpected source mapping schema")
    source = mapping["source"]
    if source["repository"] != candidate["repository"] or source["relative"] != candidate["sourceFile"]:
        raise RuntimeError("Source mapping repository/file mismatch")
    base_checkout = output.parent / "sources/a01-base"
    head = subprocess.check_output(["git", "-C", str(base_checkout), "rev-parse", "HEAD"], text=True).strip()
    if head != candidate["baseCommit"] or source["baseCommit"] != head:
        raise RuntimeError("Wrong published A01 source commit")
    base_file = base_checkout / candidate["sourceFile"]
    if sha(base_file.read_bytes()) != source["baseSha256"] or source["baseSha256"] != candidate["baseSourceSha256"]:
        raise RuntimeError("Published A01 source file changed")
    if source["candidateCommit"] != candidate["candidateCommit"] or source["candidateSha256"] != candidate["candidateSourceSha256"]:
        raise RuntimeError("Unreviewed candidate source identity")
    patch_path = CONTROLLER / candidate["productionPatchFile"]
    if sha(patch_path.read_bytes()) != candidate["productionPatchSha256"]:
        raise RuntimeError("Frozen candidate source patch changed")
    derived_root = output.parent / "sources/a01-candidate"
    derived_file = derived_root / candidate["sourceFile"]
    if not derived_file.exists():
        derived_file.parent.mkdir(parents=True, exist_ok=True)
        derived_file.write_bytes(base_file.read_bytes())
        subprocess.run(["patch", "--batch", "--forward", "--fuzz=0", "-p1", "-i", str(patch_path)], cwd=derived_root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if sha(derived_file.read_bytes()) != candidate["candidateSourceSha256"]:
        raise RuntimeError("Reviewed A01 source file changed")
    source_proof = {"base": {"commit": head, "sourceSha256": source["baseSha256"]}, "candidate": {"reviewedLocalCommit": source["candidateCommit"], "sourceSha256": source["candidateSha256"], "derivedFromBaseAndFrozenPatch": True, "patchSha256": candidate["productionPatchSha256"], "remoteCandidateFetched": False}}
    published = output.parent / "npm/autorouter/dist/index.js"
    original = published.read_bytes()
    if sha(original) != mapping["originalAutorouterSha256"]:
        raise RuntimeError("Wrong published mapping prefix")
    if sha(published.with_name("index.js.map").read_bytes()) != mapping["sourceMapSha256"]:
        raise RuntimeError("Published source map changed")
    span = mapping["span"]
    start, end = span["startByte"], span["endByte"]
    if not 0 <= start < end <= len(original):
        raise RuntimeError("Invalid single-method span")
    old, new = span["oldText"].encode(), span["newText"].encode()
    if original[start:end] != old or sha(old) != span["oldSha256"] or sha(new) != span["newSha256"]:
        raise RuntimeError("Single-method replacement text changed")
    if sha(original[:start]) != mapping["unchangedPrefixSha256"] or sha(original[end:]) != mapping["unchangedSuffixSha256"]:
        raise RuntimeError("Bytes outside the method differ")
    replaced = original[:start] + new + original[end:]
    if sha(replaced) != mapping["candidateAutorouterSha256"] or sha(replaced) != candidate["candidateAutorouterSha256"]:
        raise RuntimeError("Candidate autorouter digest mismatch")
    if candidate["siblingEntryRelative"] != "dist/a01-endpoint-candidate.js":
        raise RuntimeError("Unexpected sibling entry location")
    sibling = published.with_name("a01-endpoint-candidate.js")
    if sibling.exists() and sibling.read_bytes() != replaced:
        raise RuntimeError("Refuse to overwrite a different candidate")
    if not sibling.exists():
        sibling.write_bytes(replaced)
    after = verify_runtime(plan, output)
    if before != after:
        raise RuntimeError("Published graph changed during direct-entry preparation")
    proof = {"schemaVersion": 1, "mappingSha256": sha(mapping_bytes), "source": source_proof, "originalAutorouterSha256": sha(original), "candidateAutorouterSha256": sha(replaced), "candidateEntry": str(sibling), "singleMethodSpan": {"startByte": start, "endByte": end, "oldSha256": span["oldSha256"], "newSha256": span["newSha256"]}, "unchangedPrefixSha256": mapping["unchangedPrefixSha256"], "unchangedSuffixSha256": mapping["unchangedSuffixSha256"], "publishedRuntimeUnchanged": True, "packageAliasesUnchanged": True, "runtimeProof": after, "candidateNotUsedByAssessment": True}
    (output / "overlay-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
    return proof


def main():
    plan = verified_plan()
    if sys.argv[1:] == ["--verify-plan"]:
        print(json.dumps({"qualifiedPlan": True, "mainVersion": plan["mainVersion"]}))
        return
    if len(sys.argv) == 3 and sys.argv[1] == "--prepare-overlay":
        print(json.dumps(prepare_overlay(plan, Path(sys.argv[2]).resolve())))
        return
    if len(sys.argv) == 3 and sys.argv[1] == "--verify-runtime":
        print(json.dumps(verify_runtime(plan, Path(sys.argv[2]).resolve())))
        return
    board, output_name = sys.argv[1:]
    if board != "h616":
        raise RuntimeError("This diagnostic is only for H616")
    output = Path(output_name).resolve()
    if output.exists():
        raise RuntimeError("Refuse to overwrite a point screen input")
    runtime_proof = verify_runtime(plan, output)
    case = plan["cases"][board]
    artifact = case["artifact"]
    endpoint = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{artifact['id']}"
    metadata = json.loads(subprocess.check_output(["gh", "api", endpoint]))
    for field in ["id", "name", "size_in_bytes", "digest", "workflow_run"]:
        if metadata[field] != artifact[field]:
            raise RuntimeError(f"Artifact metadata changed: {field}")
    archive = subprocess.check_output(["gh", "api", endpoint + "/zip"])
    archive_sha = sha(archive)
    if len(archive) != artifact["size_in_bytes"] or "sha256:" + archive_sha != artifact["digest"]:
        raise RuntimeError("Artifact ZIP identity mismatch")
    retained = {}
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        for name, expected in case["files"].items():
            content = bundle.read(name)
            if len(content) != expected["bytes"] or sha(content) != expected["sha256"]:
                raise RuntimeError(f"Authenticated artifact member changed: {name}")
            if "payloadSha256" in expected:
                raw = gzip.decompress(content)
                if len(raw) != expected["payloadBytes"] or sha(raw) != expected["payloadSha256"]:
                    raise RuntimeError(f"Native SRJ payload changed: {name}")
            retained[name] = content
    progress = json.loads(retained["progress.json"])
    phase = next(item for item in progress["phases"] if item["index"] == case["phaseIndex"])
    if (progress["id"], progress["cohort"], progress["sourceSha256"]) != (board, case["cohort"], case["sourceSha256"]):
        raise RuntimeError("Native board source identity mismatch")
    if phase["name"] != case["phase"] or phase["inputSha256"] != case["files"]["phase-4-input.srj.json.gz"]["payloadSha256"]:
        raise RuntimeError("Native phase identity mismatch")
    srj = json.loads(gzip.decompress(retained["phase-4-input.srj.json.gz"]))
    counts = {"connections": len(srj["connections"]), "terminals": sum(len(item["pointsToConnect"]) for item in srj["connections"]), "obstacles": len(srj["obstacles"]), "traces": len(srj["traces"]), "layerCount": srj["layerCount"]}
    if counts != case["nativeCounts"] or sum(item["name"] == case["targetRoot"] for item in srj["connections"]) != 1:
        raise RuntimeError("Native geometry or target membership changed")
    output.mkdir(parents=True)
    for name, content in retained.items():
        (output / name).write_bytes(content)
    (output / "input-proof.json").write_text(json.dumps({
        "board": board, "scope": plan["purpose"], "artifact": metadata,
        "archiveSha256": archive_sha, "files": case["files"], "phase": phase,
        "targetRoot": case["targetRoot"], "primaryTargetConnection": case["primaryTargetConnection"],
        "fallbackTargetNode": case["fallbackTargetNode"], "sourceSha256": progress["sourceSha256"],
        "nativeCounts": counts, "runtime": runtime_proof, "noInputTransformations": True,
    }, indent=2) + "\n")
    print(json.dumps({"board": board, "inputVerified": True, "phaseInputSha256": phase["inputSha256"]}))


if __name__ == "__main__":
    main()
