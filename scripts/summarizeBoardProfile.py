import json
from collections import defaultdict
p=json.load(open('board109-results/board109.cpuprofile'))
nodes={n['id']:n for n in p['nodes']}
parents={c:n['id'] for n in p['nodes'] for c in n.get('children',[])}
self_time=defaultdict(int)
total_time=defaultdict(int)
for sample,delta in zip(p['samples'],p['timeDeltas']):
    self_time[sample]+=delta
    node=sample
    while node is not None:
        total_time[node]+=delta
        node=parents.get(node)
for label,times in [('SELF',self_time),('TOTAL',total_time)]:
    print(label)
    for i,t in sorted(times.items(),key=lambda x:-x[1])[:100]:
        frame=nodes[i]['callFrame']
        print(json.dumps({'seconds':round(t/1e6,3),'function':frame['functionName'],'url':frame['url'],'line':frame['lineNumber']+1}))
