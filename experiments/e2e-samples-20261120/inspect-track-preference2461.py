from pathlib import Path
import gzip,json,math,hashlib,collections
samples=['butterstick-original','butterstick-spaced','glider-original','glider-spaced','h616-original','h616-spaced','icepi-original','icepi-spaced','imx6-original','imx6-spaced']
read=lambda p:json.loads(gzip.decompress(p.read_bytes()) if str(p).endswith('.gz') else p.read_text())
out=Path('inspection');out.mkdir(exist_ok=True);rows=[]
for sample in samples:
 before=read(Path('before')/('native-'+sample+'-source-tracks')/'native.json.gz')
 after=read(Path('after')/('native-'+sample+'-source-track-preference')/'native.json.gz')
 assert before['summary']['inputSha256']==after['summary']['inputSha256']
 old={p['connectionName']:p for p in before['best']['plans']};new={p['connectionName']:p for p in after['best']['plans']}
 gained=sorted(new.keys()-old.keys());lost=sorted(old.keys()-new.keys())
 group=lambda plans:dict(collections.Counter(p['busId'] for p in plans))
 row={'sample':sample,'before':before['summary'],'after':after['summary'],'gainedByBus':group(new[n] for n in gained),'lostByBus':group(old[n] for n in lost),'gained':gained,'lost':lost,'longerRetainedRoutes':[n for n in old.keys()&new.keys() if new[n]['length']>old[n]['length']+1e-7],'layerChanges':[{'connection':n,'bus':new[n]['busId'],'before':old[n]['targetLayer'],'after':new[n]['targetLayer']} for n in old.keys()&new.keys() if new[n]['targetLayer']!=old[n]['targetLayer']]}
 rows.append(row);print('TRACK_INSPECTION',json.dumps({k:v for k,v in row.items() if k not in ['before','after','gained','lost','longerRetainedRoutes','layerChanges']}))
(out/'comparisons.json').write_text(json.dumps(rows,indent=2)+'\n')
sample='icepi-spaced';folder=Path('capture')/sample;report=read(folder/'report.json');entry=next(e for e in report['solvers'] if e['name']=='FanoutSolver');original=read(folder/f"solver-{entry['id']}-input.json.gz");srj,options=original;prepared=read(folder/f"solver-{entry['id']}-prepared-buses.json.gz")
bounds=options.get('sharedBoundary',srj['bounds']);components={bus['componentId'] for bus in prepared};maximum_trace=max(bus.get('traceWidth',srj['minTraceWidth']) for bus in prepared);via=options.get('viaDiameter',srj.get('minViaPadDiameter',srj.get('minViaDiameter')));clearance=options.get('clearance',srj.get('minViaEdgeToPadEdgeClearance',srj.get('minTraceToPadEdgeClearance')));halo=max(maximum_trace/2,via/2)+clearance
retained=[]
for obstacle in srj['obstacles']:
 radius=(abs(obstacle['width'])+abs(obstacle['height']))/2
 x,y=obstacle['center']['x'],obstacle['center']['y']
 if obstacle.get('componentId') in components or not(x+radius<bounds['minX']-halo or x-radius>bounds['maxX']+halo or y+radius<bounds['minY']-halo or y-radius>bounds['maxY']+halo):retained.append(obstacle)
fixture={'solverParams':{**srj,'obstacles':retained},'solverOptions':options,'capture':{'sample':sample,'run':45070654984,'originalConstructorSha256':hashlib.sha256((folder/f"solver-{entry['id']}-input.json.gz").read_bytes()).hexdigest(),'archiveSha256':'1991ad1891a953dcd660818aaceb73f7aa42dbf704e677e635753b9159f7a6b7','bounds':bounds,'halo':halo,'originalObstacleCount':len(srj['obstacles']),'retainedObstacleCount':len(retained),'sourceComponentIds':sorted(components),'policy':'All requests, source-component pads, rules and aliases retained. Only obstacles provably outside the shared boundary and maximum copper-clearance halo are omitted.'}}
assert not srj.get('traces'), 'Expected fresh fanout with no existing traces'
raw=json.dumps(fixture,separators=(',',':')).encode();(out/'icepi-spaced-native-fanout.json.gz').write_bytes(gzip.compress(raw,compresslevel=9,mtime=0));(out/'fixture-capture.json').write_text(json.dumps(fixture['capture'],indent=2)+'\n');print('NATIVE_FIXTURE',len(raw),'bytes; obstacles',len(srj['obstacles']),'to',len(retained))
