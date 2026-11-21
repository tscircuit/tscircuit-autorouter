from pathlib import Path
import collections,csv,gzip,hashlib,json,statistics,sys

before_root,after_root=map(Path,sys.argv[1:3])
out=Path(__file__).parent
before={b['board']:b for b in json.loads((before_root/'matrix.json').read_text())}
after={b['board']:b for b in json.loads((after_root/'matrix.json').read_text())}
rows=[]
shared_inputs=0
changed_inputs=[]
for board,a in before.items():
 b=after[board]
 left=before_root/a['variant']/board
 right=after_root/b['variant']/board
 before_events=[json.loads(line) for line in (left/'events.jsonl').read_text().splitlines()]
 after_events=[json.loads(line) for line in (right/'events.jsonl').read_text().splitlines()]
 before_start=next(e['seconds'] for e in before_events if e['key']=='start')
 after_start=next(e['seconds'] for e in after_events if e['key']=='start')
 row={
  'board':board,'beforeSeconds':a['seconds'],'afterSeconds':b['seconds'],
  'beforeStop':a['stop'],'afterStop':b['stop'],
  'beforeFirstRouteSeconds':round(before_start,3),'afterFirstRouteSeconds':round(after_start,3),
  'setupSecondsSaved':round(before_start-after_start,3),
  'beforeTraces':a.get('traces'),'afterTraces':b.get('traces'),
  'beforeVias':a.get('vias'),'afterVias':b.get('vias'),
  'circuitJsonIdentical':None,'copperIdentical':None,'errorCountsIdentical':None,
 }
 if (left/'circuit.json.gz').exists() and (right/'circuit.json.gz').exists():
  cj_a=gzip.decompress((left/'circuit.json.gz').read_bytes())
  cj_b=gzip.decompress((right/'circuit.json.gz').read_bytes())
  el_a=json.loads(cj_a);el_b=json.loads(cj_b)
  row['circuitJsonIdentical']=cj_a==cj_b
  row['copperIdentical']=[e for e in el_a if e['type'] in ['pcb_trace','pcb_via']]==[e for e in el_b if e['type'] in ['pcb_trace','pcb_via']]
  row['errorCountsIdentical']=a['errors']==b['errors']
 for p in left.glob('start-*.srj.json.gz'):
  q=right/p.name
  if q.exists():
   shared_inputs+=1
   if gzip.decompress(p.read_bytes())!=gzip.decompress(q.read_bytes()):changed_inputs.append(board+'/'+p.name)
 before_fanout=next((e for e in before_events if e['key']=='fanout'),None)
 after_fanout=next((e for e in after_events if e['key']=='fanout'),None)
 if before_fanout and after_fanout:
  row['fanoutSearchIdentical']=all(before_fanout.get(k)==after_fanout.get(k) for k in ['requests','best','attempts','iterations','summary'])
 rows.append(row)
comparable=[r for r in rows if r['copperIdentical'] is not None]
settled=[r for r in rows if r['beforeStop']=='settled' and r['afterStop']=='settled']
analysis={
 'runtimeBefore':json.loads((before_root/'runtime-versions.json').read_text()),
 'runtimeAfter':json.loads((after_root/'runtime-versions.json').read_text()),
 'baselineRun':44839819843,'fixRun':44841452299,
 'patchProvenance':json.loads((after_root/'fix-provenance.json').read_text()),
 'setupDefinition':'Time from observer preload to the first autorouting:start event in the full original TSX render.',
 'budgetPerBoardSeconds':600,'parallelBoards':19,'runner':'blacksmith-32vcpu-ubuntu-2404-arm',
 'beforeSettled':sum(b['stop']=='settled' for b in before.values()),
 'afterSettled':sum(b['stop']=='settled' for b in after.values()),
 'comparableCircuits':len(comparable),'identicalCircuitJsons':sum(r['circuitJsonIdentical'] for r in comparable),
 'identicalCopper':sum(r['copperIdentical'] for r in comparable),
 'unchangedErrorCounts':sum(r['errorCountsIdentical'] for r in comparable),
 'sharedRoutingInputs':shared_inputs,'changedRoutingInputs':changed_inputs,
 'firstRouteTimeBeforeSum':sum(r['beforeFirstRouteSeconds'] for r in rows),
 'firstRouteTimeAfterSum':sum(r['afterFirstRouteSeconds'] for r in rows),
 'firstRouteMedianSpeedup':statistics.median(r['beforeFirstRouteSeconds']/r['afterFirstRouteSeconds'] for r in rows),
 'comparableRenderBeforeSum':sum(r['beforeSeconds'] for r in settled),
 'comparableRenderAfterSum':sum(r['afterSeconds'] for r in settled),
 'boards':rows,
}
for name,root in [('before',before_root),('after',after_root)]:
 (out/f'selector-reuse-{name}-matrix.json').write_bytes((root/'matrix.json').read_bytes())
(out/'selector-reuse-analysis.json').write_text(json.dumps(analysis,indent=2)+'\n')
keys=list(dict.fromkeys(k for row in rows for k in row))
with (out/'selector-reuse-comparison.csv').open('w') as f:
 writer=csv.DictWriter(f,fieldnames=keys);writer.writeheader();writer.writerows(rows)
print(json.dumps({k:v for k,v in analysis.items() if k not in ['boards','runtimeBefore','runtimeAfter']},indent=2))
for row in rows:print(json.dumps(row))
