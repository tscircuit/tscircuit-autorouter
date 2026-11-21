from pathlib import Path
import json,gzip,csv,hashlib,collections,shutil
out=Path('experiments/boards-3269')
base=Path('/workspace/work/results-3269-before')
head=Path('/workspace/work/results-3269-after')
before={r['board']:r for r in json.loads((base/'matrix.json').read_text())}
after={r['board']:r for r in json.loads((head/'matrix.json').read_text())}
prior_root=Path('/workspace/work/results-3268-before')
prior={r['board']:r for r in json.loads((prior_root/'matrix.json').read_text())}
rows=[];shared_inputs=[];mismatches=[];phase_rows=[];release=[];blockers=collections.Counter()
for board,b in before.items():
 a=after[board];bd=base/b['variant']/board;ad=head/a['variant']/board
 row={'board':board,'beforeSeconds':b['seconds'],'afterSeconds':a['seconds'],'stop':b['stop'],'sameStop':b['stop']==a['stop'],'beforeTraces':b.get('traces'),'afterTraces':a.get('traces'),'beforeVias':b.get('vias'),'afterVias':a.get('vias'),'sameCircuitJson':b.get('circuitSha256')==a.get('circuitSha256') if 'circuitSha256' in b else None,'circuitSha256':b.get('circuitSha256'),'errors':b.get('errors')}
 assert row['sameStop'] and row['sameCircuitJson'] is not False,board
 for p in bd.glob('*.gz'):
  if not (p.name.endswith('.srj.json.gz') or p.name.endswith('-input.json.gz')):continue
  q=ad/p.name
  if not q.exists():continue
  equal=gzip.decompress(p.read_bytes())==gzip.decompress(q.read_bytes())
  shared_inputs.append({'board':board,'file':p.name,'identical':equal})
  if not equal:mismatches.append(shared_inputs[-1])
 events=[json.loads(line) for line in (bd/'events.jsonl').read_text().splitlines()]
 starts={e.get('phaseOrdinal'):e for e in events if e['key']=='start'}
 ends=[e for e in events if e['key']=='end']
 for e in ends:
  start=starts[e.get('phaseOrdinal')];phase_rows.append({'board':board,'phase':e.get('phaseName'),'solver':e.get('solverName'),'startSeconds':start['seconds'],'endSeconds':e['seconds'],'seconds':e['seconds']-start['seconds'],'traces':e.get('traceCount')})
 failure=[e for e in events if e['key']=='pipeline-failure']
 if failure:stage=failure[-1]['phase']
 elif any(e['key'] in ['fanout','fanout-progress'] for e in events):stage='fanout'
 elif events[-1]['key']=='bus-progress':stage='bus lanes'
 else:stage='highDensityRouteSolver'
 row['blockingStage']=stage;blockers[stage]+=1;rows.append(row)
 old=prior[board];same_copper=None
 if b['stop']=='settled' and old['stop']=='settled':
  current_cj=json.loads(gzip.decompress((bd/'circuit.json.gz').read_bytes()));prior_cj=json.loads(gzip.decompress((prior_root/old['variant']/board/'circuit.json.gz').read_bytes()))
  copper=lambda cj:[e for e in cj if e['type'] in ['pcb_trace','pcb_via']]
  same_copper=copper(current_cj)==copper(prior_cj)
 release.append({'board':board,'previousRelease':'0.0.3268','latestRelease':'0.0.3269','previousSeconds':old['seconds'],'latestSeconds':b['seconds'],'sameStop':old['stop']==b['stop'],'sameTraceCount':old.get('traces')==b.get('traces'),'sameViaCount':old.get('vias')==b.get('vias'),'identicalEmittedCopper':same_copper})
(out/'before-matrix.json').write_bytes((base/'matrix.json').read_bytes())
(out/'before-runtime-versions.json').write_bytes((base/'runtime-versions.json').read_bytes())
(out/'after-matrix.json').write_bytes((head/'matrix.json').read_bytes())
(out/'after-runtime-versions.json').write_bytes((head/'runtime-versions.json').read_bytes())
(out/'fix-provenance.json').write_bytes((head/'fix-provenance.json').read_bytes())
(out/'comparison.json').write_text(json.dumps(rows,indent=2)+'\n')
with (out/'comparison.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator="\n");w.writeheader();w.writerows(rows)
(out/'shared-inputs.json').write_text(json.dumps(shared_inputs,indent=2)+'\n')
(out/'latest-release-comparison.json').write_text(json.dumps(release,indent=2)+'\n')
(out/'completed-phases.json').write_text(json.dumps(phase_rows,indent=2)+'\n')
for board in ['icepi-native','h616-local']:
 target=out/'real-e2e'/board;target.mkdir(parents=True,exist_ok=True)
 for variant,r,root in [('before',before[board],base),('after',after[board],head)]:
  shutil.copyfile(root/r['variant']/board/'circuit.json.gz',target/(variant+'.circuit.json.gz'))
preloaded=json.loads(gzip.decompress((base/'main/h616-local/start-3.srj.json.gz').read_bytes()))
summary={'latestTscircuit':'0.0.3269','resolved':{'core':'0.0.2447','autorouter':'0.0.1145','fanoutSolver':'0.0.97','busLanesSolver':'0.0.63','connectivityMapBefore':'0.0.36','connectivityMapAfter':'0.0.36'},'boards':len(rows),'settledWithRoutingErrors':sum(r['stop']=='settled' for r in rows),'timeouts':[r['board'] for r in rows if r['stop']!='settled'],'fullyRouted':sum(r['stop']=='settled' and not r.get('errors') for r in after.values()),'identicalSettledCircuitJson':sum(r['sameCircuitJson'] is True for r in rows),'sharedInputFiles':len(shared_inputs),'sharedInputMismatches':mismatches,'blockingStages':dict(blockers),'previousReleaseEmittedCopperUnchanged':all(r['identicalEmittedCopper'] is not False for r in release),'preloadedTraceAudit':{'board':'h616-local','phase':'remaining','nativeTraceCount':len(preloaded.get('traces',[])),'fixedTraceCount':sum(bool(t.get('isFixed')) for t in preloaded.get('traces',[])),'obstacles':len(preloaded['obstacles']),'obstaclesWithoutCircuitMetadata':sum(not o.get('circuitJsonMetadata') for o in preloaded['obstacles']),'allUnattributedObstaclesAreNonPlatedHoles':all(o.get('isNonPlatedHole') for o in preloaded['obstacles'] if not o.get('circuitJsonMetadata'))},'interpretation':'The fix removes repeated CSS selector scans; it does not resolve existing routing failures. Shared matrix wall times are contended observations, not speedup claims. Use the same-machine paired results for performance conclusions.'}
(out/'analysis.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
