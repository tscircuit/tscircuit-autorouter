from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess,json,time,os,collections,gzip,hashlib

root=Path('experiments/boards-3266/runtime').resolve()
out=Path('board-benchmark-results').resolve()
out.mkdir(exist_ok=True)
versions={}
for name in ['tscircuit','@tscircuit/core','@tscircuit/fanout-solver','@tscircuit/capacity-autorouter']:
 package=json.loads((root/'node_modules'/name/'package.json').read_text())
 entry=package.get('module',package.get('main','index.js'))
 versions[name]={'version':package['version'],'entrySha256':hashlib.sha256((root/'node_modules'/name/entry).read_bytes()).hexdigest()}
(out/'runtime-versions.json').write_text(json.dumps(versions,indent=2)+'\n')
variant=os.environ.get('BOARD_VARIANT','main')
if os.environ.get('BOARD_FIX_PROVENANCE'):
 (out/'fix-provenance.json').write_bytes(Path(os.environ['BOARD_FIX_PROVENANCE']).read_bytes())
boards=sorted(p.stem for p in (root/'boards').glob('*.tsx'))
def run(board):
 d=out/variant/board
 d.mkdir(parents=True,exist_ok=True)
 circuit=root/'output'/(board+'.circuit.json')
 if circuit.exists():circuit.unlink()
 start=time.monotonic()
 env={**os.environ,'BOARD_RUN_OUT':str(d)}
 with (d/'run.log').open('w') as f:
  p=subprocess.Popen(['bun','--preload','./observer.ts','./render.tsx',board],cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT)
  try:
   rc=p.wait(timeout=600)
   stop='settled'
  except subprocess.TimeoutExpired:
   p.terminate()
   p.wait()
   rc=p.returncode
   stop='600-second render budget'
 result={'board':board,'variant':variant,'exit':rc,'seconds':round(time.monotonic()-start,3),'stop':stop}
 if circuit.exists():
  raw=circuit.read_bytes()
  els=json.loads(raw)
  counts=collections.Counter(e['type'] for e in els)
  result.update(elements=len(els),traces=counts['pcb_trace'],vias=counts['pcb_via'],circuitSha256=hashlib.sha256(raw).hexdigest(),errors={k:v for k,v in counts.items() if k.endswith('_error')})
  (d/'circuit.json.gz').write_bytes(gzip.compress(raw))
 (d/'result.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result),flush=True)
with ThreadPoolExecutor(max_workers=19) as pool:
 list(pool.map(run,boards))
(out/'matrix.json').write_text(json.dumps([json.loads(p.read_text()) for p in sorted(out.glob('*/*/result.json'))],indent=2)+'\n')
