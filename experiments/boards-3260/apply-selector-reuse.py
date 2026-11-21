from pathlib import Path
import hashlib,json

root=Path('experiments/boards-3260/runtime/node_modules/@tscircuit/core')
assert json.loads((root/'package.json').read_text())['version']=='0.0.2438'
chunk=root/'dist/chunk-MS7QPCOY.js'
before=chunk.read_bytes()
assert hashlib.sha256(before).hexdigest()=='7ac2d30da88918e7faa8fcfb7770e25321bbbec3edcf7b2e4cdc21713e54a24a'
old='''      const allMatching = selectAll(
        selector,
        this,
        cssSelectOptionsInsideSubcircuit
      );'''
new='''      const allMatching = this.selectAll(selectorRaw);'''
assert before.decode().count(old)==1
after=before.decode().replace(old,new).encode()
chunk.write_bytes(after)
provenance={
 'coreBaseVersion':'0.0.2438',
 'fixCommit':'aea0287c77451e32c13ae8c39d9b2a9694455d91',
 'fixRepository':'tscircuit/core',
 'method':'Replace the one compiled call corresponding to selector-reuse.patch; preserve every other released dependency and byte.',
 'chunkBeforeSha256':hashlib.sha256(before).hexdigest(),
 'chunkAfterSha256':hashlib.sha256(after).hexdigest(),
 'sourcePatchSha256':hashlib.sha256(Path('experiments/boards-3260/selector-reuse.patch').read_bytes()).hexdigest(),
}
Path('experiments/boards-3260/selector-reuse-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps(provenance))
