from pathlib import Path
import json,hashlib,gzip
root=Path('experiments/boards-3269/runtime').resolve()
package=root/'node_modules/@tscircuit/core/dist'
expected=json.loads(Path('experiments/boards-3269/base-core-hashes.json').read_text())
index=package/'index.js';chunk=package/'chunk-CP7OIOQG.js'
assert hashlib.sha256(index.read_bytes()).hexdigest()==expected['core-index-before.js']
assert hashlib.sha256(chunk.read_bytes()).hexdigest()==expected['core-chunk-before.js']
s=index.read_text();a=s.index('  doInitialCreateAutoplacedBreakoutPoints() {');b=s.index('  doInitialPcbAutoplaceBreakoutPoints() {',a);part=s[a:b]
needle='    const autoPlacedPorts = /* @__PURE__ */ new Set();'
assert part.count(needle)==1
part=part.replace(needle,'    this.getSubcircuit().updateOptimizeSelectorCache();\n'+needle+'\n    const pendingBreakoutPoints = [];')
assert part.count('this.add(breakoutPoint);')==1
part=part.replace('this.add(breakoutPoint);','pendingBreakoutPoints.push(breakoutPoint);')
assert part.endswith('    }\n  }\n')
part=part[:-len('  }\n')]+'    this.addAll(pendingBreakoutPoints);\n  }\n'
updated_index=s[:a]+part+s[b:]
s=chunk.read_text();needle='  doInitialOptimizeSelectorCache() {\n    if (!this.isSubcircuit) return;'
assert s.count(needle)==1
s=s.replace(needle,'  doInitialOptimizeSelectorCache() {\n    this._cachedSelectAllQueries.clear();\n    this._cachedSelectOneQueries.clear();\n    if (!this.isSubcircuit) return;')
needle='  updateOptimizeSelectorCache() {\n    this._cachedSelectAllQueries.clear();\n    this._cachedSelectOneQueries.clear();\n    this.doInitialOptimizeSelectorCache();'
assert s.count(needle)==1
updated_chunk=s.replace(needle,'  updateOptimizeSelectorCache() {\n    this.doInitialOptimizeSelectorCache();')
provenance={'sourcePatchSha256':hashlib.sha256(gzip.decompress(Path('experiments/boards-3269/breakout-selector.patch.gz').read_bytes())).hexdigest(),'files':[]}
for p,updated in [(index,updated_index),(chunk,updated_chunk)]:
 before=hashlib.sha256(p.read_bytes()).hexdigest();temporary=p.with_suffix('.temporary.js');temporary.write_text(updated);temporary.replace(p)
 provenance['files'].append({'path':str(p.relative_to(root)),'beforeSha256':before,'afterSha256':hashlib.sha256(p.read_bytes()).hexdigest()})
Path('breakout-selector-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps(provenance))
