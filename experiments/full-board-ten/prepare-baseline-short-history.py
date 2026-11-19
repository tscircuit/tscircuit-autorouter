"""Authenticate the published H616 phase before passive selected via observation."""

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
    plan = json.loads((CONTROLLER / "baseline-short-history-plan.json").read_text())
    if plan["qualificationReady"] is not True:
        raise RuntimeError("HELD: H616 via-history capture is not qualified for execution")
    if plan["routingSourceOverrides"] or plan["sourceOverrides"] or plan["dependencyOverrides"] or plan["publishedRuntimeGraphUnchanged"] is not True:
        raise RuntimeError("Published-only diagnostic forbids source/runtime overrides")
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


def retained_artifact(reference, output):
    artifact = reference['artifact']
    endpoint = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{artifact['id']}"
    metadata = json.loads(subprocess.check_output(['gh', 'api', endpoint]))
    for field in ['id', 'name', 'size_in_bytes', 'digest', 'workflow_run']:
        if metadata[field] != artifact[field]:
            raise RuntimeError(f'Reference artifact identity changed: {field}')
    archive = subprocess.check_output(['gh', 'api', endpoint + '/zip'])
    if len(archive) != artifact['size_in_bytes'] or 'sha256:' + sha(archive) != artifact['digest']:
        raise RuntimeError('Reference archive digest changed')
    retained = {}
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        for name, expected in reference['files'].items():
            data = bundle.read(name)
            if len(data) != expected['bytes'] or sha(data) != expected['sha256']:
                raise RuntimeError(f'Reference member changed: {name}')
            if 'payloadSha256' in expected:
                raw = gzip.decompress(data)
                if len(raw) != expected['payloadBytes'] or sha(raw) != expected['payloadSha256']:
                    raise RuntimeError(f'Reference payload changed: {name}')
            retained[name] = data
    output.mkdir(parents=True)
    for name, data in retained.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (output / 'archive-proof.json').write_text(json.dumps({'artifact': metadata, 'archiveSha256': sha(archive), 'files': reference['files']}, indent=2) + '\n')
    return retained


def prepare_input(plan, output):
    if output.exists():
        raise RuntimeError('Refuse to overwrite a diagnostic input')
    runtime = verify_runtime(plan, output)
    case = plan['case']
    retained = retained_artifact(case, output)
    summary = retained_artifact(plan['referenceRuntime'], output / 'reference-runtime')
    progress = json.loads(retained['progress.json'])
    phase = next(item for item in progress['phases'] if item['index'] == case['phaseIndex'])
    if (progress['id'], progress['cohort'], progress['sourceSha256']) != (case['board'], case['cohort'], case['sourceSha256']):
        raise RuntimeError('Wrong native board identity')
    if phase['name'] != case['phase'] or phase['status'] != 'completed' or phase['inputSha256'] != plan['inputSha256']:
        raise RuntimeError('Wrong completed phase')
    srj = json.loads(gzip.decompress(retained['phase-3-input.srj.json.gz']))
    counts = {'connections': len(srj['connections']), 'terminals': sum(len(c['pointsToConnect']) for c in srj['connections']), 'obstacles': len(srj['obstacles']), 'traces': len(srj['traces']), 'layerCount': srj['layerCount']}
    if counts != case['nativeCounts'] or sha(gzip.decompress(retained['phase-3-output.srj.json.gz'])) != plan['expectedOutputSha256']:
        raise RuntimeError('Wrong native input or output')
    if srj['traces']:
        raise RuntimeError('The frozen event projection requires zero input preloads')
    process = json.loads(retained['process.json'])
    previous = json.loads(summary['.full-board-run/runtime-manifest.json'])
    if process['hardTimedOut'] or process['renderExitCode'] != 0:
        raise RuntimeError('Earlier execution identity changed')
    if previous['mainVersion'] != plan['mainVersion'] or previous['experiment'] != 'published' or previous['sourceOverrides'] or previous['dependencyOverrides'] or previous.get('routingSourceOverride'):
        raise RuntimeError('Earlier graph had an override')
    release = json.loads((CONTROLLER / 'release.json').read_text())
    if len(previous['packages']) != len(release['packages']):
        raise RuntimeError('Earlier package membership differs')
    for expected in release['packages']:
        package = next(item for item in previous['packages'] if item['name'] == expected['name'])
        for key in ['name', 'version', 'entryRelative', 'integrity', 'tarball', 'entrySha256']:
            if package[key] != expected[key]:
                raise RuntimeError('Earlier package identity differs')
    current = json.loads((output.parent / 'runtime-manifest.json').read_text())
    for key in ['runtimeDependencyFiles', 'autorouterDependencyFiles']:
        if previous[key] != current[key]:
            raise RuntimeError('Earlier dependency graph differs')
    for key in ['architecture', 'cpuCount', 'bun', 'artificialMemoryLimitApplied']:
        if previous['runner'][key] != current['runner'][key]:
            raise RuntimeError('Earlier runner policy differs')
    (output / 'input-proof.json').write_text(json.dumps({'phase': phase, 'sourceSha256': case['sourceSha256'], 'nativeCounts': counts, 'runtime': runtime, 'inputSha256': plan['inputSha256'], 'expectedOutputSha256': plan['expectedOutputSha256'], 'earlierPublishedRuntimeMatches': True, 'noInputTransformations': True, 'scope': plan['purpose']}, indent=2) + '\n')


def main():
    plan = verified_plan()
    if sys.argv[1:] == ['--verify-plan']:
        print(json.dumps({'qualifiedPlan': True, 'purpose': plan['purpose']}))
        return
    action, directory = sys.argv[1:]
    output = Path(directory).resolve()
    if action == '--verify-runtime':
        verify_runtime(plan, output)
    elif action == '--prepare-input':
        prepare_input(plan, output)
    else:
        raise RuntimeError('Unknown action')


if __name__ == '__main__':
    main()
