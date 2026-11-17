"""Verify the reviewed source against published Core, then run its small helper test."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request

root, source = map(lambda value: Path(value).resolve(), sys.argv[1:3])
controller = Path(__file__).resolve().parent
plan = json.loads((controller / 'bus-repeat-plan.json').read_text())
assert plan['frozen'], 'Source qualification plan is not frozen'
proof = root / 'bus-repeat-source'
proof.mkdir()
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert subprocess.check_output(['bun', '--version'], text=True).strip() == '1.4.3'
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip() == plan['source']['baseCommit']
assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=source, text=True).strip()
base = proof / 'base-source'
for relative, hashes in plan['source']['files'].items():
    assert sha(source / relative) == hashes['beforeSha256'], relative
    target = base / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / relative, target)
patch = controller / 'bus-repeat-production.patch'
assert sha(patch) == plan['source']['productionPatchSha256']
subprocess.run(['git', 'apply', '--check', str(patch)], cwd=source, check=True)
subprocess.run(['git', 'apply', str(patch)], cwd=source, check=True)
assert set(subprocess.check_output(['git', 'diff', '--name-only'], cwd=source, text=True).splitlines()) == set(plan['source']['files'])
for relative, hashes in plan['source']['files'].items():
    assert sha(source / relative) == hashes['afterSha256'], relative
test_source = controller / 'bus-repeat-source-test.ts'
assert sha(test_source) == plan['source']['testSha256']
source_test = source / plan['source']['testFile']
source_test.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(test_source, source_test)

# Tool tarballs are separately pinned and never installed in the package runtime.
tools = root / 'qualification-tools'
tool_proofs = []
for tool in plan['tools']:
    target = tools / ('typescript' if tool['name'] == 'typescript' else 'biome')
    target.mkdir(parents=True)
    archive = urllib.request.urlopen(tool['tarball']).read()
    algorithm, expected = tool['integrity'].split('-', 1)
    assert algorithm == 'sha512' and base64.b64encode(hashlib.sha512(archive).digest()).decode() == expected
    files = []
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as packet:
        for member in packet.getmembers():
            parts = Path(member.name).parts
            assert parts and parts[0] == 'package' and '..' not in parts
            path = target.joinpath(*parts[1:])
            assert path.resolve().is_relative_to(target)
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                assert member.isfile(), 'Tool archive contains a link or special member'
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(packet.extractfile(member).read())
                path.chmod(member.mode & 0o777)
                files.append({'path': str(path.relative_to(target)), 'sha256': sha(path)})
    package = json.loads((target / 'package.json').read_text())
    assert package['name'] == tool['name'] and package['version'] == tool['version']
    tool_proofs.append({**tool, 'archiveSha256': hashlib.sha256(archive).hexdigest(), 'files': files})
(proof / 'tool-packages.json').write_text(json.dumps(tool_proofs, indent=2) + '\n')
biome = tools / 'biome/biome'
assert '2.5.15' in subprocess.check_output([str(biome), '--version'], text=True)
formatted = subprocess.run([str(biome), 'format', *plan['source']['files'], plan['source']['testFile']], cwd=source,
                           text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
(proof / 'format.log').write_text(formatted.stdout)
assert formatted.returncode == 0, 'Exact Biome2.5.15 check failed'
subprocess.run(['bun', str(controller / 'createBusRepeatOverlay.ts'), str(base), str(source),
                str(root / 'npm/core/dist/index.js'), str(tools / 'typescript/lib/typescript.js'), str(proof)], check=True)
assert sha(proof / 'source-mapping.json') == plan['expectedSourceMappingSha256'], 'Source mapping proof changed'
mapping = json.loads((proof / 'source-mapping.json').read_text())
assert mapping['passed'] and mapping['candidateCoreSha256'] == plan['expectedCandidateCoreSha256']
anchor = json.loads((proof / 'overlay-spans.json').read_text())
original = (root / 'npm/core/dist/index.js').read_bytes()
candidate = original
for span in sorted(anchor['spans'], key=lambda row: row['byteOffset'], reverse=True):
    old, new = span['oldBlock'].encode(), span['newBlock'].encode()
    offset = span['byteOffset']
    assert original[offset:offset + len(old)] == old and original.count(old) == 1
    candidate = candidate[:offset] + new + candidate[offset + len(old):]
assert hashlib.sha256(candidate).hexdigest() == plan['expectedCandidateCoreSha256']

results = {}
core_manifest = json.loads((root / 'runtime-manifest.json').read_text())
core = next(package for package in core_manifest['packages'] if package['name'] == '@tscircuit/core')
tail = b'\nexport { routeGeneratedSignalSites };\n'
for lane, entry in [('base', original), ('candidate', candidate)]:
    package = proof / f'test-core-{lane}'
    for row in core['publishedFiles']:
        target = package / row['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        if row['path'] == core['entryRelative']:
            target.write_bytes(entry + tail)
        else:
            os.link(root / 'npm/core' / row['path'], target)
    (package / 'node_modules').symlink_to(root / 'runtime/node_modules')
    test = proof / f'{lane}.test.ts'
    original_import = 'from "../lib/route-generated-signal-sites"'
    source_text = test_source.read_text()
    assert source_text.count(original_import) == 1
    test.write_text(source_text.replace(original_import, 'from ' + json.dumps(str(package / core['entryRelative']))))
    environment = {**os.environ, 'NO_COLOR': '1'}
    environment.pop('BUN_UPDATE_SNAPSHOTS', None)
    command = ['bun', 'test', str(test), '--timeout', '60000']
    tested = subprocess.run(command, env=environment, cwd=proof, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log = proof / f'{lane}-test.log'
    log.write_text(tested.stdout)
    results[lane] = {'command': command, 'exitCode': tested.returncode, 'logSha256': sha(log),
                     'originalTestSha256': sha(test_source), 'adaptedTestSha256': sha(test), 'testExportTail': tail.decode(),
                     'testCoreEntrySha256': sha(package / core['entryRelative']), 'adaptation': 'Only the source helper import points at the actual bundled helper; type-only import is erased by Bun'}
    if lane == 'base':
        assert tested.returncode == 1 and 'expect(exhausted).toBe(1)' in tested.stdout and 'Expected: 1' in tested.stdout and 'Received: 0' in tested.stdout, 'Baseline must fail only at the reviewed exhaustion assertion'
    else:
        assert tested.returncode == 0, 'Candidate helper test failed'
for relative, hashes in plan['source']['files'].items():
    assert sha(source / relative) == hashes['afterSha256']
assert sha(test_source) == plan['source']['testSha256']
result = {'passed': True, 'productionPatchSha256': plan['source']['productionPatchSha256'], 'sourceMappingSha256': sha(proof / 'source-mapping.json'),
          'candidateCoreSha256': mapping['candidateCoreSha256'], 'formatVersion': '2.5.15', 'formatPassed': True, 'formatLogSha256': sha(proof / 'format.log'),
          'tests': results, 'runtimeAliasesChanged': False, 'toolsIsolatedFromRuntime': True, 'nativeBoardRouted': False}
(proof / 'source-gate.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
