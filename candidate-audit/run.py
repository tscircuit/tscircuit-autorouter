import json,pathlib,concurrent.futures,subprocess,time,os
root=pathlib.Path.cwd();out=root/'candidate-results';out.mkdir(exist_ok=True)
candidates=json.loads((root/'candidate-audit/candidates.json').read_text())
timeout=1800

def run(c):
 p=out/(c['id']+'.json');log=out/(c['id']+'.log');start=time.time()
 try:
  with log.open('w') as f:
   proc=subprocess.run(['bun','candidate-audit/route-candidate.ts',c['input'],str(p)],stdout=f,stderr=f,timeout=timeout)
  if not p.exists():p.write_text(json.dumps({'solved':False,'failed':True,'status':'worker-error','error':f'exit {proc.returncode}'}))
 except subprocess.TimeoutExpired:p.write_text(json.dumps({'solved':False,'failed':False,'status':'timeout','timeoutSeconds':timeout}))
 r=json.loads(p.read_text());summary={**c,**{k:v for k,v in r.items() if k not in ['errors','effectiveInputSrj','routedSrj','pointPairSrj','routedTraces','circuitJson','stack']}}
 print(c['id'],c['title'],r.get('status'),r.get('drcErrorCount'),f'{time.time()-start:.1f}s',flush=True)
 return summary

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:results=list(ex.map(run,candidates))
(out/'summary.json').write_text(json.dumps(results,indent=2)+'\n')
metadata={'routerCommit':'934cfed20151661b6ce1aa00827b1fc1e69ce28c','auditCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'solver':'AutoroutingPipelineSolver9_PreloadedTraceGraph','options':{'effort':1},'preprocessing':'migrateLegacyObstacleCircuitJsonMetadata','timeoutSeconds':timeout,'concurrency':8,'bunVersion':subprocess.check_output(['bun','--version'],text=True).strip(),'workflowRunId':os.environ.get('GITHUB_RUN_ID'),'workflowRunAttempt':os.environ.get('GITHUB_RUN_ATTEMPT'),'runnerOs':os.environ.get('RUNNER_OS'),'runnerArch':os.environ.get('RUNNER_ARCH')}
(out/'run-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
print('QUALIFYING',sum(r['status']=='qualifies' for r in results),'OF',len(results),flush=True)
