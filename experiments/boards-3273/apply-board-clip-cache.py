from pathlib import Path
import json,hashlib,gzip
root=Path('experiments/boards-3273');p=root/'runtime/node_modules/@tscircuit/copper-pour-solver/dist/index.js'
original=p.read_text();expected=json.loads((root/'base-copper-hash.json').read_text())['index.js']
assert hashlib.sha256(p.read_bytes()).hexdigest()==expected,'unexpected copper-pour package'
needle='    const solvedRegions = [];'
assert original.count(needle)==1
start=original.index('      const boardOutline = region.boardOutline ?? region.boardEdgeOutline;')
end=original.index('      const clippedPour =',start)
assert 'const boardSection = boardOutline?.length' in original[start:end]
updated=original[:start]+(root/'board-clip-cache.js').read_text()+original[end:]
updated=updated.replace(needle,'    const boardSections = new Map();\n'+needle)
temp=p.with_suffix('.board-cache.tmp');temp.write_text(updated);temp.replace(p)
provenance={'sourcePatchSha256':hashlib.sha256(gzip.decompress((root/'board-clip-cache-source.patch.gz').read_bytes())).hexdigest(),'beforeSha256':expected,'afterSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'scope':'Apply only the per-getOutput board-section cache to released copper-pour-solver 0.0.74. The same getOutput code is shared with source main 0.0.75.'}
Path('board-clip-cache-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n');print(json.dumps(provenance))
