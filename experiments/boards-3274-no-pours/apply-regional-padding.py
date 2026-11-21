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
start=original.index(before)
end=original.index(b'finishRegionalFallback(){',start)
scope=original[start:end]
declaration=(experiment/'regional-immutable-declaration.js').read_bytes()
assert scope.count(declaration)==1
updated=original[:start]+scope.replace(declaration,b'').replace(before,after)+original[end:]
temporary=module.with_suffix('.regional-padding.tmp')
temporary.write_bytes(updated)
os.replace(temporary,module)
provenance={
 'sourcePatchSha256':hashlib.sha256(gzip.decompress((experiment/'regional-padding-source.patch.gz').read_bytes())).hexdigest(),
 'beforeModuleSha256':hashlib.sha256(original).hexdigest(),
 'afterModuleSha256':hashlib.sha256(updated).hexdigest(),
 'scope':'Within the existing immutable-preload mode, apply the existing regional clearance expansion only when a newly cut movable-copper endpoint overlaps an unrelated original terminal on the same layer, in addition to the existing promoted-copper condition. No budgets or constraints change.',
}
(experiment/'regional-padding-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
