from pathlib import Path
import os, subprocess, json, re
files = [
 'pipeline9-h616-native-ddr-clearance',
 'pipeline9-icepi-retained-vias',
 'pipeline9-orangecrab-through-via-layer-span',
 'pipeline9-orangecrab-through-vias',
]
for name in files:
 path=Path('tests/repro')/(name+'.test.ts')
 s=path.read_text()
 marker='  solver.solve()\n'
 assert marker in s,name
 log='''  solver.solve()
  console.log("LEGACY_ROUTE=" + JSON.stringify({
    revision: process.env.REVISION,
    file: import.meta.path.split("/").at(-1),
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    highDensity: solver.highDensityRouteSolver?.stats,
    copperHash: new Bun.CryptoHasher("sha256").update(JSON.stringify(solver.getOutputSimplifiedPcbTraces())).digest("hex"),
  }))
'''
 path.write_text(s.replace(marker,log,1))
 env=dict(os.environ,BUN_UPDATE_SNAPSHOTS='1')
 result=subprocess.run(['bun','test',str(path),'--timeout','9999999'],env=env)
 svg=Path('tests/repro/__snapshots__')/(name+'.snap.svg')
 data=svg.read_bytes()
 print('LEGACY_SVG='+json.dumps({'revision':os.environ['REVISION'],'name':name,'exit':result.returncode,'drc':re.findall(r'Relaxed DRC errors: (\d+)',data.decode())}),flush=True)
 if result.returncode:raise SystemExit(result.returncode)
