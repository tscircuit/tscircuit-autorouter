"""Authenticate the exact published iMX6 phase input without changing geometry."""

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
    plan = json.loads((CONTROLLER / "hd-capture-plan.json").read_text())
    if plan["qualificationReady"] is not True:
        raise RuntimeError("HELD: iMX6 diagnostic is not qualified for execution")
    if plan["routingSourceOverrides"] or plan["sourceOverrides"] or plan["dependencyOverrides"]:
        raise RuntimeError("Published diagnostic cannot override routing or dependencies")
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
    return {"manifestSha256": sha(manifest_path.read_bytes()), "packages": entries, "sourceOverrides": False}


def main():
    plan = verified_plan()
    if sys.argv[1:] == ["--verify-plan"]:
        print(json.dumps({"qualifiedPlan": True, "mainVersion": plan["mainVersion"]}))
        return
    board, output_name = sys.argv[1:]
    if board != "imx6":
        raise RuntimeError("This diagnostic is only for iMX6")
    output = Path(output_name).resolve()
    if output.exists():
        raise RuntimeError("Refuse to overwrite a diagnostic capture")
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
    if counts != case["nativeCounts"]:
        raise RuntimeError("Native geometry membership changed")
    output.mkdir(parents=True)
    for name, content in retained.items():
        (output / name).write_bytes(content)
    (output / "input-proof.json").write_text(json.dumps({
        "board": board, "scope": plan["purpose"], "artifact": metadata,
        "archiveSha256": archive_sha, "files": case["files"], "phase": phase,
        "sourceSha256": progress["sourceSha256"],
        "nativeCounts": counts, "runtime": runtime_proof, "noInputTransformations": True,
    }, indent=2) + "\n")
    print(json.dumps({"board": board, "inputVerified": True, "phaseInputSha256": phase["inputSha256"]}))


if __name__ == "__main__":
    main()
