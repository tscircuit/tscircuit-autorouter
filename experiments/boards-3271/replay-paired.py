from pathlib import Path
import subprocess,json,time,os,gzip,hashlib,shutil,tempfile
root=Path('experiments/boards-3271/runtime').resolve()
board=os.environ['BOARD_SAMPLE']
out=Path('paired-results').resolve()/board;out.mkdir(parents=True,exist_ok=True)
index=root/'node_modules/@tscircuit/core/dist/index.js'
(root/'replay-cpu.ts').write_text('import {writeFileSync} from "node:fs"; import {resolve} from "node:path"; process.on("exit",()=>writeFileSync(resolve(process.env.BOARD_RUN_OUT!,"cpu.json"),JSON.stringify(process.cpuUsage())))\n')
rows=[]
with tempfile.TemporaryDirectory() as temp:
 baseline=Path(temp)/'index.js';shutil.copyfile(index,baseline)
 for ordinal,variant in enumerate(['base','head','head','base'],1):
  restored=index.with_suffix('.restore.tmp');shutil.copyfile(baseline,restored);restored.replace(index)
  if variant=='head':subprocess.run(['python3','experiments/boards-3271/apply-board-grid-fix.py'],check=True)
  d=out/(str(ordinal)+'-'+variant);d.mkdir(exist_ok=True)
  circuit=root/'output'/(board+'.circuit.json')
  if circuit.exists():circuit.unlink()
  start=time.monotonic()
  with (d/'run.log').open('w') as f:
   p=subprocess.Popen(['bun','--preload','./observer.ts','--preload','./replay-cpu.ts','./render.tsx',board],cwd=root,env={**os.environ,'BOARD_RUN_OUT':str(d)},stdout=f,stderr=subprocess.STDOUT)
   try:rc=p.wait(timeout=600);stop='settled'
   except subprocess.TimeoutExpired:p.terminate();p.wait();rc=p.returncode;stop='600-second render budget'
  row={'board':board,'variant':variant,'ordinal':ordinal,'exit':rc,'stop':stop,'seconds':time.monotonic()-start,'coreEntrySha256':hashlib.sha256(index.read_bytes()).hexdigest()}
  if circuit.exists():
   raw=circuit.read_bytes();row['circuitSha256']=hashlib.sha256(raw).hexdigest();(d/'circuit.json.gz').write_bytes(gzip.compress(raw))
  if (d/'cpu.json').exists():row['cpu']=json.loads((d/'cpu.json').read_text())
  (d/'result.json').write_text(json.dumps(row,indent=2)+'\n');rows.append(row);print(json.dumps(row),flush=True)
(out/'comparison.json').write_text(json.dumps(rows,indent=2)+'\n')
