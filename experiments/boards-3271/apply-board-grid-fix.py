from pathlib import Path
import hashlib,json,gzip
root=Path('experiments/boards-3271')
package=root/'runtime/node_modules/@tscircuit/core/dist/index.js'
original=package.read_text()
expected=json.loads((root/'base-core-hash.json').read_text())['index.js']
assert hashlib.sha256(package.read_bytes()).hexdigest()==expected,'unexpected released core'
start=original.index('function getBoardGrid({')
raster=original.index('  const blocked = new Uint8Array(xs.length * ys.length);',start)
end=original.index('  if (blocked.byteLength <= maxBoardGridBytes)',raster)
assert original[start:end].count('boardSegmentIsClear({')==1
replacement=(root/'board-grid-raster.js').read_text()
updated=original[:raster]+replacement+original[end:]
temp=package.with_suffix('.grid-fix.tmp');temp.write_text(updated);temp.replace(package)
provenance={'sourcePatchSha256':hashlib.sha256(gzip.decompress((root/'board-grid-source.patch.gz').read_bytes())).hexdigest(),'beforeSha256':expected,'afterSha256':hashlib.sha256(package.read_bytes()).hexdigest(),'scope':'Replace only the embedded bus-lanes getBoardGrid raster loop with the transpiled source fix; preserve its cache, key and all routing code.'}
Path('board-grid-fix-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps(provenance))
