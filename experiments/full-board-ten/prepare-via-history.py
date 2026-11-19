"""Authenticate the prior successful cramped-guard H616 phase without changing geometry."""

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
    plan = json.loads((CONTROLLER / "via-history-plan.json").read_text())
    if plan["qualificationReady"] is not True:
        raise RuntimeError("HELD: H616 via-history capture is not qualified for execution")
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
    if mapping["schemaVersion"] != 2 or mapping["passed"] is not True or mapping["sourceFrozen"] is not True or mapping["source"] != candidate["source"]:
        raise RuntimeError("Unqualified source mapping identity")
    source_proof = []
    repositories = mapping["source"]["repositories"]
    folders = {"tscircuit/tiny-hypergraph": "tiny"}
    if len(repositories) != 1 or {item["repository"] for item in repositories} != set(folders):
        raise RuntimeError("Unexpected candidate repositories")
    for source in repositories:
        folder = folders[source["repository"]]
        base_checkout = output.parent / "sources" / (folder + "-base")
        head = subprocess.check_output(["git", "-C", str(base_checkout), "rev-parse", "HEAD"], text=True).strip()
        if head != source["publishedBaseCommit"] or not source["candidateCommit"]:
            raise RuntimeError("Unreviewed source commit")
        patch_path = CONTROLLER / source["productionPatchFile"]
        if patch_path.name != source["productionPatchFile"] or sha(patch_path.read_bytes()) != source["productionPatchSha256"]:
            raise RuntimeError("Frozen candidate patch changed")
        derived_root = output.parent / "sources" / (folder + "-cramped-port-candidate")
        for entry in source["changedFiles"]:
            relative = Path(entry["relative"])
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError("Invalid source path")
            if sha((base_checkout / relative).read_bytes()) != entry["beforeSha256"]:
                raise RuntimeError("Published source file changed")
        if not derived_root.exists():
            for entry in source["changedFiles"]:
                derived_file = derived_root / entry["relative"]
                derived_file.parent.mkdir(parents=True, exist_ok=True)
                derived_file.write_bytes((base_checkout / entry["relative"]).read_bytes())
            subprocess.run(["patch", "--batch", "--forward", "--fuzz=0", "-p1", "-i", str(patch_path)], cwd=derived_root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for entry in source["changedFiles"]:
            if sha((derived_root / entry["relative"]).read_bytes()) != entry["afterSha256"]:
                raise RuntimeError("Reviewed candidate source file changed")
        source_proof.append({"source": source, "publishedCheckoutCommit": head, "derivedFromBaseAndFrozenPatch": True, "remoteCandidateFetched": False})
    published = output.parent / "npm/autorouter/dist/index.js"
    original = published.read_bytes()
    if sha(original) != mapping["originalAutorouterSha256"]:
        raise RuntimeError("Wrong published autorouter mapping input")
    if sha(published.with_name("index.js.map").read_bytes()) != mapping["sourceMapSha256"]:
        raise RuntimeError("Published source map changed")
    spans = mapping["spans"]
    if len(spans) != 1 or sum(span["kind"] == "replace" for span in spans) != 1 or sum(span["kind"] == "insert" for span in spans) != 0:
        raise RuntimeError("Unexpected Tiny cramped-port source span scope")
    chunks, unchanged, cursor, candidate_cursor = [], [], 0, 0
    for span in spans:
        start, end = span["startByte"], span["endByte"]
        if not cursor <= start <= end <= len(original):
            raise RuntimeError("Source spans overlap or are unordered")
        if (span["kind"] == "insert") != (start == end):
            raise RuntimeError("Invalid explicit insertion span")
        if span["kind"] == "replace" and span["compiledBaseEquivalent"] is not True:
            raise RuntimeError("Published base compilation is not qualified")
        old, new = span["originalText"].encode(), span["replacementText"].encode()
        if original[start:end] != old or sha(old) != span["originalSha256"] or sha(new) != span["replacementSha256"]:
            raise RuntimeError("Source replacement text changed")
        untouched = original[cursor:start]
        if untouched:
            unchanged.append({"startByte": cursor, "endByte": start, "candidateStartByte": candidate_cursor, "candidateEndByte": candidate_cursor + len(untouched), "sha256": sha(untouched)})
        chunks.extend([untouched, new])
        candidate_cursor += len(untouched) + len(new)
        cursor = end
    untouched = original[cursor:]
    if untouched:
        unchanged.append({"startByte": cursor, "endByte": len(original), "candidateStartByte": candidate_cursor, "candidateEndByte": candidate_cursor + len(untouched), "sha256": sha(untouched)})
    chunks.append(untouched)
    if unchanged != mapping["unchangedSegments"] or mapping["qualification"]["allOutsideBytesUnchanged"] is not True:
        raise RuntimeError("Bytes outside the reviewed source spans differ")
    replaced = b"".join(chunks)
    if sha(replaced) != mapping["candidateAutorouterSha256"] or sha(replaced) != candidate["candidateAutorouterSha256"]:
        raise RuntimeError("Candidate autorouter digest mismatch")
    if candidate["siblingEntryRelative"] != "dist/cramped-port-capacity-candidate.js":
        raise RuntimeError("Unexpected sibling entry location")
    sibling = published.with_name("cramped-port-capacity-candidate.js")
    if sibling.exists() and sibling.read_bytes() != replaced:
        raise RuntimeError("Refuse to overwrite a different candidate")
    if not sibling.exists():
        sibling.write_bytes(replaced)
    after = verify_runtime(plan, output)
    if before != after:
        raise RuntimeError("Published graph changed during direct-entry preparation")
    proof = {"schemaVersion": 2, "mappingSha256": sha(mapping_bytes), "source": mapping["source"], "sourceProofs": source_proof, "originalAutorouterSha256": sha(original), "candidateAutorouterSha256": sha(replaced), "candidateEntry": str(sibling), "replacementCount": 1, "insertionCount": 0, "unchangedSegments": unchanged, "publishedRuntimeUnchanged": True, "packageAliasesUnchanged": True, "runtimeProof": after, "candidateNotUsedByAssessment": True}
    (output / "overlay-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
    return proof


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
    srj = json.loads(gzip.decompress(retained['phase-4-input.srj.json.gz']))
    counts = {'connections': len(srj['connections']), 'terminals': sum(len(c['pointsToConnect']) for c in srj['connections']), 'obstacles': len(srj['obstacles']), 'traces': len(srj['traces']), 'layerCount': srj['layerCount']}
    if counts != case['nativeCounts'] or sha(gzip.decompress(retained['phase-4-output.srj.json.gz'])) != plan['expectedOutputSha256']:
        raise RuntimeError('Wrong native input or output')
    process = json.loads(retained['process.json'])
    previous = json.loads(summary['candidate-runtime-manifest.json'])
    overlay = json.loads(summary['cramped-guard/overlay-proof.json'])
    mapping = plan['sourceCandidate']
    if process['routingSourceOverride'] != previous['routingSourceOverride'] or process['hardTimedOut'] or process['renderExitCode'] != 0:
        raise RuntimeError('Earlier execution identity changed')
    if overlay['sourceMappingSha256'] != mapping['mappingSha256'] or overlay['candidateAutorouterSha256'] != mapping['candidateAutorouterSha256']:
        raise RuntimeError('Earlier guard mapping differs')
    if previous['mainVersion'] != plan['mainVersion'] or previous['experiment'] != 'cramped-guard' or previous['dependencyOverrides'] != [previous['routingSourceOverride']]:
        raise RuntimeError('Earlier graph had another override')
    release = json.loads((CONTROLLER / 'release.json').read_text())
    if len(previous['packages']) != len(release['packages']):
        raise RuntimeError('Earlier package membership differs')
    for expected in release['packages']:
        package = next(item for item in previous['packages'] if item['name'] == expected['name'])
        for key in ['name', 'version', 'entryRelative', 'integrity', 'tarball']:
            if package[key] != expected[key]:
                raise RuntimeError('Earlier package identity differs')
        expected_entry = mapping['candidateAutorouterSha256'] if expected['name'] == '@tscircuit/capacity-autorouter' else expected['entrySha256']
        if package['entrySha256'] != expected_entry:
            raise RuntimeError('Earlier runtime entry differs')
    current = json.loads((output.parent / 'runtime-manifest.json').read_text())
    for key in ['runtimeDependencyFiles', 'autorouterDependencyFiles']:
        if previous[key] != current[key]:
            raise RuntimeError('Earlier dependency graph differs')
    for key in ['architecture', 'cpuCount', 'bun', 'artificialMemoryLimitApplied']:
        if previous['runner'][key] != current['runner'][key]:
            raise RuntimeError('Earlier runner policy differs')
    (output / 'input-proof.json').write_text(json.dumps({'phase': phase, 'sourceSha256': case['sourceSha256'], 'nativeCounts': counts, 'runtime': runtime, 'inputSha256': plan['inputSha256'], 'expectedOutputSha256': plan['expectedOutputSha256'], 'earlierGuardRuntimeMatches': True, 'noInputTransformations': True, 'scope': plan['purpose']}, indent=2) + '\n')


def main():
    plan = verified_plan()
    if sys.argv[1:] == ['--verify-plan']:
        print(json.dumps({'qualifiedPlan': True, 'purpose': plan['purpose']}))
        return
    action, directory = sys.argv[1:]
    output = Path(directory).resolve()
    if action == '--prepare-overlay':
        prepare_overlay(plan, output)
    elif action == '--verify-runtime':
        verify_runtime(plan, output)
    elif action == '--prepare-input':
        prepare_input(plan, output)
    else:
        raise RuntimeError('Unknown action')


if __name__ == '__main__':
    main()
