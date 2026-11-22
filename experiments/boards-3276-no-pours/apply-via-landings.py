from pathlib import Path
import gzip, hashlib, json, os

experiment = Path(__file__).resolve().parent
modules = json.loads((experiment / 'via-landings-module-hashes.json').read_text())
for entry in modules:
    module = experiment / 'runtime/node_modules/@tscircuit/capacity-autorouter' / entry['module']
    original = module.read_bytes()
    assert hashlib.sha256(original).hexdigest() == entry['beforeSha256']
    before = (experiment / entry['beforeSnippet']).read_bytes()
    after = (experiment / entry['afterSnippet']).read_bytes()
    assert original.count(before) == 1
    updated = original.replace(before, after)
    assert hashlib.sha256(updated).hexdigest() == entry['afterSha256']
    temporary = module.with_suffix('.via-landings.tmp')
    temporary.write_bytes(updated)
    os.replace(temporary, module)
provenance = {
    'sourcePatchSha256': hashlib.sha256(gzip.decompress((experiment / 'via-landings-source.patch.gz').read_bytes())).hexdigest(),
    'modules': modules,
    'scope': 'Preserve terminal-adjacent grid via landings when restoring off-grid endpoints. Apply the identical source change to the main bundle and both worker bundles; no search, budget, or clearance changes.',
}
(experiment / 'via-landings-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
