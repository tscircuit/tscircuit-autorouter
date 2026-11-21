from pathlib import Path
import hashlib,json,gzip,os

experiment=Path(__file__).resolve().parent
module=experiment/'runtime/node_modules/@tscircuit/capacity-autorouter/dist/index.js'
original=module.read_bytes()
expected=json.loads((experiment/'base-autorouter-hash.json').read_text())
assert hashlib.sha256(original).hexdigest()==expected['index.js']
before=(experiment/'regional-padding-original.js').read_bytes()
after=(experiment/'regional-padding.js').read_bytes()
assert original.count(before)==1
updated=original.replace(before,after)
temporary=module.with_suffix('.regional-padding.tmp')
temporary.write_bytes(updated)
os.replace(temporary,module)
provenance={
 'sourcePatchSha256':hashlib.sha256(gzip.decompress((experiment/'regional-padding-source.patch.gz').read_bytes())).hexdigest(),
 'beforeModuleSha256':hashlib.sha256(original).hexdigest(),
 'afterModuleSha256':hashlib.sha256(updated).hexdigest(),
 'scope':'Only pad the regional copper-cutting window by the existing clearance envelope before creating repair endpoints. No solver budgets, copper constraints or other routing stages change.',
}
(experiment/'regional-padding-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
