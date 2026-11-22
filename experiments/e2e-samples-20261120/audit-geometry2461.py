from pathlib import Path
import gzip,json,math,hashlib,collections

samples=['butterstick-original','butterstick-spaced','glider-original','glider-spaced','h616-original','h616-spaced','icepi-original','icepi-spaced','imx6-original','imx6-spaced']
root=Path('captures');out=Path('geometry-audit');out.mkdir(exist_ok=True)
read=lambda p:json.loads(gzip.decompress(p.read_bytes()) if str(p).endswith('.gz') else p.read_text())
rows=[]
for sample in samples:
 folder=root/('full-circuit-interception-'+sample)/sample
 report=read(folder/'report.json');entry=next(s for s in report['solvers'] if s['name']=='FanoutSolver')
 args=read(folder/f"solver-{entry['id']}-input.json.gz");srj,options=args
 circuit=read(folder/'circuit.json.gz');prepared=read(folder/f"solver-{entry['id']}-prepared-buses.json.gz")
 parent={}
 def find(x):
  if x not in parent:parent[x]=x
  if parent[x]!=x:parent[x]=find(parent[x])
  return parent[x]
 def join(ids):
  if not ids:return
  first=find(ids[0])
  for x in ids[1:]:parent[find(x)]=first
 for el in circuit:
  if el['type']=='source_trace':join(el.get('connected_source_port_ids',[])+el.get('connected_source_net_ids',[]))
  if el['type']=='source_component_internal_connection':join(el.get('source_port_ids',[]))
 ports={el['pcb_port_id']:el['source_port_id'] for el in circuit if el['type']=='pcb_port'}
 source_ports={el['source_port_id'] for el in circuit if el['type']=='source_port'}
 def pad_net(pad):
  pcb=pad.get('circuitJsonMetadata',{}).get('pcb_port_id')
  source=ports.get(pcb)
  return find(source) if source in source_ports else None
 obstacles_by_component=collections.defaultdict(list)
 for pad in srj['obstacles']:
  if pad.get('componentId') and not pad.get('isCopperPour'):obstacles_by_component[pad['componentId']].append(pad)
 proofs=[];pitches=collections.Counter();widths=collections.Counter()
 for bus in prepared:
  pitch_x,pitch_y=bus['pitchX'],bus['pitchY'];pitches[(round(pitch_x,6),round(pitch_y,6))]+=len(bus['connections'])
  if abs(pitch_x-pitch_y)>1e-6:continue
  pitch=(pitch_x+pitch_y)/2
  if not math.isfinite(pitch) or pitch<=0:continue
  width=bus.get('traceWidth') or options.get('traceWidth') or srj.get('nominalTraceWidth') or srj['minTraceWidth']
  widths[round(width,6)]+=len(bus['connections'])
  trace_clearance=srj.get('minTraceToPadEdgeClearance')
  via_clearance=srj.get('minViaEdgeToPadEdgeClearance')
  via_diameter=options.get('viaDiameter') or srj.get('minViaPadDiameter') or srj.get('minViaDiameter')
  if trace_clearance is None or via_clearance is None or via_diameter is None or srj.get('allowViaInPad'):continue
  for prepared_connection in bus['connections']:
   source=prepared_connection['sourcePoint'];source_layer=prepared_connection['sourceLayer'];source_net=ports.get(source.get('pcb_port_id') or source.get('pointId'))
   if source_net not in source_ports:continue
   source_net=find(source_net);pads=obstacles_by_component[bus['componentId']]
   grid={}
   for ix in [-1,0,1]:
    for iy in [-1,0,1]:
     x,y=source['x']+ix*pitch,source['y']+iy*pitch
     pad=next((p for p in pads if source_layer in p['layers'] and math.hypot(p['center']['x']-x,p['center']['y']-y)<1e-6),None)
     if pad is not None:grid[ix,iy]=pad
   if len(grid)!=9:continue
   # Every point of this square is within pitch/sqrt(2) of one of its nine
   # pad centers. Inscribed circles give a conservative pad-geometry bound.
   smallest_pad_radius=min(min(p['width'],p['height'])/2 for p in grid.values())
   via_keepout=smallest_pad_radius+via_diameter/2+via_clearance
   if via_keepout<=pitch/math.sqrt(2)+1e-6:continue
   sides=[];trace_radius=width/2+trace_clearance
   for axis,side in [('x',-1),('x',1),('y',-1),('y',1)]:
    intervals=[];ids=[]
    for track in [-1,0,1]:
     key=(side,track) if axis=='x' else (track,side);pad=grid[key];net=pad_net(pad)
     # Ignore any same-net or unidentified pad. The proof must remain valid
     # even if same-net copper contact is permitted.
     if net is None or net==source_net:continue
     angle=float(pad.get('ccwRotationDegrees',0))%180
     if pad.get('shape')=='circle' or abs(angle)>1e-7:
      half_extent=min(pad['width'],pad['height'])/2
     else:half_extent=pad['height']/2 if axis=='x' else pad['width']/2
     reach=half_extent+trace_radius
     intervals.append([track*pitch-reach,track*pitch+reach]);ids.append(pad.get('circuitJsonMetadata',{}).get('pcb_port_id'))
    covered=-pitch
    for lo,hi in sorted(intervals):
     if lo>covered+1e-7:break
     covered=max(covered,hi)
    if covered<pitch+1e-7:break
    sides.append({'axis':axis,'side':side,'foreignPadPorts':ids,'intervals':intervals})
   if len(sides)!=4:continue
   proofs.append({'connection':prepared_connection['connection']['name'],'source':source,'bus':bus['busId'],'termination':bus['termination'],'pitch':pitch,'traceWidth':width,'traceToPadClearance':trace_clearance,'viaDiameter':via_diameter,'viaToPadClearance':via_clearance,'smallestPadRadius':smallest_pad_radius,'maximumDistanceToNearestPadCenter':pitch/math.sqrt(2),'requiredViaDistanceToNearestPadCenter':via_keepout,'closedForeignPadBoundary':sides})
 assessment=read(folder/'assessment.json');diagnostics=read(folder/'diagnostics.json')
 row={'sample':sample,'requested':len(srj['connections']),'provenImpossibleRequests':len(proofs),'proofs':proofs,'pitches':[{ 'pitch':list(k),'requests':v} for k,v in pitches.items()],'traceWidths':dict(widths),'constructorInputSha256':hashlib.sha256((folder/f"solver-{entry['id']}-input.json.gz").read_bytes()).hexdigest(),'components':assessment['components'],'pads':assessment['pads'],'membershipErrors':assessment['membershipErrors'],'diagnostics':diagnostics,'fullCircuitStatus':report['status']}
 (out/(sample+'.json')).write_text(json.dumps(row,indent=2)+'\n');rows.append({k:v for k,v in row.items() if k not in ['proofs','diagnostics']})
 print('GEOMETRY_AUDIT',json.dumps(rows[-1]))
(out/'summary.json').write_text(json.dumps(rows,indent=2)+'\n')
