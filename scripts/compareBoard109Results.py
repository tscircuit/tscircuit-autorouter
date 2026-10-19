import json
from statistics import mean
from pathlib import Path
results={p.parent.name: json.loads(p.read_text()) for p in Path('comparison').glob('*/result.json')}
assert set(results)=={'base-1','base-2','head-1','head-2'}
base=mean(results[n]['elapsedMs'] for n in ['base-1','base-2'])
head=mean(results[n]['elapsedMs'] for n in ['head-1','head-2'])
print(json.dumps({'baseMeanSeconds':base/1000,'headMeanSeconds':head/1000,'savedSeconds':(base-head)/1000,'percentFaster':100*(base-head)/base,'identicalOutput':len({r['outputSha256'] for r in results.values()})==1,'runs':results}))
for r in results.values():
    assert r['drcErrorCount']==0
    assert r['traceCount']==results['base-1']['traceCount']
    assert r['viaCount']==results['base-1']['viaCount']
assert len({r['outputSha256'] for r in results.values()})==1, 'Routing output changed'
assert head < base, 'No routing speed improvement'
