from pathlib import Path
import gzip, hashlib, io, json, sys, urllib.request, zipfile

experiment = Path(__file__).resolve().parent
variant, url, expected = sys.argv[1:]
archive = urllib.request.urlopen(url).read()
assert hashlib.sha256(archive).hexdigest() == expected
root = Path('/workspace/work/results-3276-no-pours') / variant
root.mkdir(parents=True, exist_ok=True)
inputs, preloads, stages = {}, [], []
with zipfile.ZipFile(io.BytesIO(archive)) as z:
    for name in z.namelist():
        relative = Path(name)
        assert not relative.is_absolute() and '..' not in relative.parts
        if relative.name in ['matrix.json', 'runtime-versions.json', 'fix-provenance.json', 'events.jsonl', 'result.json', 'circuit.json.gz', 'run.log'] or (relative.parent.name == 'glider-local' and relative.name.startswith('stage-') and 'highDensityRouteSolver' in relative.name):
            z.extract(name, root)
        if name.endswith('.srj.json.gz') or name.endswith('-input.json.gz') or (relative.name.startswith('stage-') and name.endswith('.json.gz')):
            data = gzip.decompress(z.read(name))
            inputs['/'.join(relative.parts[1:])] = hashlib.sha256(data).hexdigest()
            if relative.parent.name == 'h616-local' and name.endswith('.srj.json.gz'):
                srj = json.loads(data)
                preloads.append({'file': name, 'traces': len(srj.get('traces', [])), 'obstacles': len(srj['obstacles']), 'unattributedObstacles': [o for o in srj['obstacles'] if not any(o.get('circuitJsonMetadata', {}).get(key) for key in ['pcb_smtpad_id', 'pcb_plated_hole_id', 'pcb_hole_id'])]})
            if relative.name.startswith('stage-') and 'highDensityRouteSolver' in relative.name:
                params = json.loads(data)
                stages.append({'file': name, 'immutablePreloads': sum(r.get('isFixed') is True for r in params.get('fixedHdRoutes', []))})
for name in ['matrix.json', 'runtime-versions.json', 'fix-provenance.json']:
    if (root / name).exists():
        (experiment / (variant + '-' + name)).write_bytes((root / name).read_bytes())
(experiment / (variant + '-input-hashes.json')).write_text(json.dumps(inputs, indent=2) + '\n')
(experiment / (variant + '-preload-audit.json')).write_text(json.dumps(preloads, indent=2) + '\n')
(experiment / (variant + '-stage-audit.json')).write_text(json.dumps(stages, indent=2) + '\n')
(experiment / (variant + '-artifact.json')).write_text(json.dumps({'sha256': expected, 'bytes': len(archive)}, indent=2) + '\n')
print(json.dumps({'variant': variant, 'boards': len(json.loads((root / 'matrix.json').read_text())), 'capturedInputs': len(inputs), 'sha256': expected}))
