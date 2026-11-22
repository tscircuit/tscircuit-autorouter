from pathlib import Path
import collections,csv,gzip,hashlib,io,json,sys,urllib.request,zipfile

experiment=Path(__file__).resolve().parent
base=Path('/workspace/work/results-3273-no-pours')
head=Path('/workspace/work/results-3273-no-pours-final')
source=sys.argv[1]
archive=urllib.request.urlopen(source).read() if source.startswith('https://') else Path(source).read_bytes()
assert hashlib.sha256(archive).hexdigest()==sys.argv[2]
z=zipfile.ZipFile(io.BytesIO(archive))
for name in z.namelist():
 if Path(name).name in ['matrix.json','runtime-versions.json','fix-provenance.json','events.jsonl','result.json','circuit.json.gz','run.log']:
  z.extract(name,head)
before={r['board']:r for r in json.loads((base/'matrix.json').read_text())}
after={r['board']:r for r in json.loads((head/'matrix.json').read_text())}
assert len(before)==len(after)==19
rows=[];inputs=[];regressions=[];output_differences=[];stages=collections.Counter()
routing_error_types=['pcb_autorouting_error','pcb_trace_missing_error','pcb_port_not_connected_error']
for board,b in before.items():
 a=after[board];bd=base/b['variant']/board;ad=head/a['variant']/board
 be=[json.loads(line) for line in (bd/'events.jsonl').read_text().splitlines()]
 ae=[json.loads(line) for line in (ad/'events.jsonl').read_text().splitlines()]
 failures=[e for e in ae if e['key']=='pipeline-failure'];fanout=[e for e in ae if e['key']=='fanout']
 last=failures[-1] if failures else fanout[-1] if fanout else ae[-1]
 if failures:stage=failures[-1]['phase']
 elif fanout or any(e['key']=='fanout-progress' for e in ae):stage='fanout'
 else:
  active=[e for e in ae if e['key'] in ['bus-progress','pipeline-stage']]
  latest=active[-1] if active else ae[-1]
  stage='bus lanes' if latest['key']=='bus-progress' else latest.get('phase','post-routing')
 stages[stage]+=1
 prior_failures=[e for e in be if e['key']=='pipeline-failure']
 same_copper=None
 if b['stop']=='settled' and a['stop']=='settled':
  bc=json.loads(gzip.decompress((bd/'circuit.json.gz').read_bytes()));ac=json.loads(gzip.decompress((ad/'circuit.json.gz').read_bytes()))
  same_copper=[e for e in bc if e['type'] in ['pcb_trace','pcb_via']]==[e for e in ac if e['type'] in ['pcb_trace','pcb_via']]
  assert not any(e['type']=='pcb_copper_pour' for e in ac)
  if bc!=ac:
   removed=[e for e in bc if e not in ac];added=[e for e in ac if e not in bc]
   output_differences.append({'board':board,'removedTypes':dict(collections.Counter(e['type'] for e in removed)),'addedTypes':dict(collections.Counter(e['type'] for e in added)),'removed':removed,'added':added})
 row={'board':board,'beforeStop':b['stop'],'afterStop':a['stop'],'beforeTraces':b.get('traces'),'afterTraces':a.get('traces'),'beforeVias':b.get('vias'),'afterVias':a.get('vias'),'sameEmittedCopper':same_copper,'sameFullCircuitJson':b.get('circuitSha256')==a.get('circuitSha256') if b.get('circuitSha256') and a.get('circuitSha256') else None,'beforeErrors':b.get('errors'),'afterErrors':a.get('errors'),'beforeSeconds':b['seconds'],'afterSeconds':a['seconds'],'beforePipelineError':prior_failures[-1]['error'] if prior_failures else None,'afterPipelineError':failures[-1]['error'] if failures else None,'afterBlockingStage':stage}
 rows.append(row)
 if b['stop']=='settled' and (a['stop']!='settled' or a.get('traces',-1)<b.get('traces',0)):
  regressions.append({'board':board,'reason':'Lost completed render or emitted traces'})
 if b.get('errors') and a.get('errors') and sum(a['errors'].get(k,0) for k in routing_error_types)>sum(b['errors'].get(k,0) for k in routing_error_types):
  regressions.append({'board':board,'reason':'Increased routing error count'})
 for p in bd.glob('*.gz'):
  if not (p.name.endswith('.srj.json.gz') or p.name.endswith('-input.json.gz')):continue
  target=f"{a['variant']}/{board}/{p.name}"
  if target not in z.namelist():continue
  left=gzip.decompress(p.read_bytes());right=gzip.decompress(z.read(target))
  inputs.append({'board':board,'file':p.name,'identical':left==right,'beforeSha256':hashlib.sha256(left).hexdigest(),'afterSha256':hashlib.sha256(right).hexdigest()})
for name in ['matrix.json','runtime-versions.json','fix-provenance.json']:(experiment/('final-'+name)).write_bytes((head/name).read_bytes())
(experiment/'final-comparison.json').write_text(json.dumps(rows,indent=2)+'\n')
with (experiment/'final-comparison.csv').open('w') as f:
 writer=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator='\n');writer.writeheader();writer.writerows(rows)
(experiment/'final-common-inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
(experiment/'final-output-differences.json').write_text(json.dumps(output_differences,indent=2)+'\n')
summary={'boards':19,'copperPours':False,'fullyRoutedBefore':sum(r['stop']=='settled' and not any(r.get('errors',{}).get(k,0) for k in routing_error_types) for r in before.values()),'fullyRoutedAfter':sum(r['stop']=='settled' and not any(r.get('errors',{}).get(k,0) for k in routing_error_types) for r in after.values()),'settledBefore':sum(r['stop']=='settled' for r in before.values()),'settledAfter':sum(r['stop']=='settled' for r in after.values()),'identicalEmittedCopper':sum(r['sameEmittedCopper'] is True for r in rows),'identicalFullOutputs':sum(r['sameFullCircuitJson'] is True for r in rows),'commonInputFiles':len(inputs),'changedCommonInputs':[r for r in inputs if not r['identical']],'possibleRegressions':regressions,'blockingStagesAfter':dict(stages),'afterArtifactSha256':hashlib.sha256(archive).hexdigest(),'interpretation':'A local regional repair improvement is not whole-board completion. Full-matrix wall times are contended observations; no speedup claim is made.'}
(experiment/'final-analysis.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
