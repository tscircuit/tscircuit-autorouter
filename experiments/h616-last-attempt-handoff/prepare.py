import argparse
import gzip
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

controller = Path(__file__).resolve().parent
shared = controller.parent / 'dataset18-recovery-handoff-3208'
spec = importlib.util.spec_from_file_location('paired_graph_helpers', shared / 'prepare-pair.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
digest, inventory, copy_graph = helpers.digest, helpers.inventory, helpers.copy_graph
parser = argparse.ArgumentParser()
parser.add_argument('--workspace', required=True, type=Path)
parser.add_argument('--runtime-root', required=True, type=Path)
parser.add_argument('--verify-only', action='store_true')
args = parser.parse_args()
workspace, runtime = args.workspace.resolve(), args.runtime_root.resolve()
experiment = json.loads((controller / 'experiment.json').read_text())
native = json.loads((controller / 'native-files.json').read_text())
assert experiment['frozen'] and experiment['bunVersion'] == '1.4.3'
assert subprocess.check_output(['bun', '--version'], text=True).strip() == experiment['bunVersion']
assert not os.environ.get('BUN_UPDATE_SNAPSHOTS') and not os.environ.get('UPDATE_SNAPSHOTS')
proof_dir = runtime / 'h616-proof'
folders = {lane: workspace / f'same-machine-{lane}' for lane in ['base', 'pr']}
test_path = experiment['test']['path']

if args.verify_only:
    proof = json.loads((proof_dir / 'provenance.json').read_text())
    with gzip.open(proof_dir / 'evaluation-dependencies.json.gz', 'rt') as stream:
        expected_graph = json.load(stream)
    for lane, folder in folders.items():
        assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=folder, text=True).strip() == native['sourceCommit']
        assert inventory(folder / 'node_modules') == expected_graph
        assert set(subprocess.check_output(['git', 'diff', '--name-only'], cwd=folder, text=True).splitlines()) == {test_path}
        for name, expected in proof['lanes'][lane]['files'].items():
            assert digest(folder / name) == expected, f'Changed native test/helper/snapshot: {name}'
        assert digest(folder / 'bun.lock') == proof['evaluationLockSha256']
        entry = proof['entries'][lane]
        assert digest(Path(entry['sourceEntry'])) == entry['sourceSha256']
        assert inventory(Path(entry['packageFolder']), ('node_modules',)) == proof['routingPackages'][lane]
    assert inventory(Path(proof['entries']['sharedRoutingDependencies'])) == proof['routingDependencies']
    assert digest(runtime / 'runtime-manifest.json') == proof['entries']['originalRuntimeManifestSha256']
    print('H616_POSTCHECK ' + json.dumps({'nativeSourcesSnapshotsAndRuntimeUnchanged': True}))
    raise SystemExit(0)

proof_dir.mkdir()
for folder in folders.values():
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=folder, text=True).strip() == native['sourceCommit']
    assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=folder)
    assert not (folder / 'node_modules').exists()
    for item in native['files']:
        path = folder / item['path']
        assert path.is_file() and path.stat().st_size == item['bytes'] and digest(path) == item['sha256'], item['path']
        if 'uncompressedSha256' in item:
            import hashlib
            raw = gzip.decompress(path.read_bytes())
            assert len(raw) == item['uncompressedBytes'] and hashlib.sha256(raw).hexdigest() == item['uncompressedSha256']
base, candidate = folders['base'], folders['pr']
package_bytes = (base / 'package.json').read_bytes()
assert package_bytes == (candidate / 'package.json').read_bytes()
install_config = proof_dir / 'install.bunfig.toml'
install_config.write_text('[install.lockfile]\nsave = true\n')
subprocess.run(['bun', f'--config={install_config}', 'install', '--save-text-lockfile', '--ignore-scripts', '--backend', 'copy'], cwd=base, check=True)
sharp = (base / 'node_modules/sharp').resolve()
assert sharp.is_relative_to(base / 'node_modules')
subprocess.run(['bun', 'run', 'install'], cwd=sharp, check=True)
assert (base / 'package.json').read_bytes() == package_bytes
graph = inventory(base / 'node_modules')
copy_graph(base / 'node_modules', candidate / 'node_modules')
assert inventory(candidate / 'node_modules') == graph
shutil.copyfile(base / 'bun.lock', candidate / 'bun.lock')
shutil.copyfile(base / 'bun.lock', proof_dir / 'bun.lock')
with gzip.open(proof_dir / 'evaluation-dependencies.json.gz', 'wt') as stream:
    json.dump(graph, stream, sort_keys=True)
subprocess.run(['bun', str(shared / 'prepare-entries.mjs'), str(runtime), str(proof_dir / 'routing-entries.json'), str(controller / 'experiment.json')], check=True)
entries = json.loads((proof_dir / 'routing-entries.json').read_text())
lanes = {}
constructor_import = '"lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"'
for lane, folder in folders.items():
    path = folder / test_path
    original = path.read_text()
    assert original.count(constructor_import) == 1
    path.write_text(original.replace(constructor_import, '"../../h616-selected-constructor.mjs"'))
    shutil.copyfile(controller / 'selected-constructor.mjs', folder / 'h616-selected-constructor.mjs')
    shutil.copyfile(controller / 'assess-output.ts', folder / 'h616-assess-output.ts')
    shutil.copyfile(controller / 'import-preflight.ts', folder / 'h616-import-preflight.ts')
    output = runtime / 'h616-results' / lane
    output.mkdir(parents=True)
    (output / 'selected-entry.json').write_text(json.dumps(entries[lane], indent=2) + '\n')
    environment = {**os.environ, 'H616_ENTRY_IDENTITY': str(output / 'selected-entry.json'), 'H616_CAPTURE_PATH': str(output / 'actual-output.json.gz')}
    imported = subprocess.check_output(['bun', 'h616-import-preflight.ts'], cwd=folder, env=environment, text=True)
    markers = [line.split('H616_IMPORT_PREFLIGHT ', 1)[1] for line in imported.splitlines() if line.startswith('H616_IMPORT_PREFLIGHT ')]
    assert len(markers) == 1
    packet = json.loads(markers[0])
    assert packet['sourceEntrySha256'] == entries[lane]['sourceSha256'] and packet['exactConstructor'] and packet['nativeHelpersImported']
    assert not packet['solverStepped'] and not packet['outputCalled'] and packet['bunVersion'] == '1.4.3'
    (output / 'import-preflight.json').write_text(json.dumps(packet, indent=2) + '\n')
    print('H616_IMPORT_PREFLIGHT ' + json.dumps({'lane': lane, **packet}))
    assert set(subprocess.check_output(['git', 'diff', '--name-only'], cwd=folder, text=True).splitlines()) == {test_path}
    # Preserve every native helper and loader byte from the exact source checkout.
    names = set(subprocess.check_output(['git', 'ls-files', 'lib/testing', 'lib/utils', 'lib/types', 'lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator.ts', 'tests/fixtures/preload.ts', 'tests/fixtures/svg-matcher.ts', 'package.json', 'bunfig.toml', 'tsconfig.json'], cwd=folder, text=True).splitlines())
    names.update(item['path'] for item in native['files'])
    names.update(['h616-selected-constructor.mjs', 'h616-assess-output.ts', 'h616-import-preflight.ts'])
    lanes[lane] = {'files': {name: digest(folder / name) for name in sorted(names)},
                   'testImportOverrideOnly': True, 'testAssertionsUnchanged': True,
                   'nativeFixtureAndSnapshotSha256': {item['path']: item['sha256'] for item in native['files']}}
assert lanes['base']['files'] == lanes['pr']['files']
proof = {'experiment': experiment, 'sourceCommit': native['sourceCommit'], 'nativeFiles': native['files'],
         'evaluationGraphResolvedOnce': True, 'evaluationLockSha256': digest(base / 'bun.lock'),
         'entries': entries, 'lanes': lanes, 'routingDependencies': inventory(Path(entries['sharedRoutingDependencies'])),
         'routingPackages': {lane: inventory(Path(entries[lane]['packageFolder']), ('node_modules',)) for lane in folders},
         'snapshotUpdatesDisabled': True, 'routingExecuted': False}
(proof_dir / 'provenance.json').write_text(json.dumps(proof, indent=2) + '\n')
print('H616_PREPARED ' + json.dumps({'sourceCommit': native['sourceCommit'], 'nativeFileCount': len(native['files']), 'assertionsAndSnapshotUnchanged': True, 'testImportOverrideOnly': True, 'sourceEntries': {lane: entries[lane]['sourceSha256'] for lane in folders}, 'routingExecuted': False}))
