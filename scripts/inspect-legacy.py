from pathlib import Path
import os, subprocess, json, re
files = [
 'pipeline9-h616-native-ddr-clearance',
 'pipeline9-icepi-retained-vias',
 'pipeline9-orangecrab-through-via-layer-span',
 'pipeline9-orangecrab-through-vias',
]
strict_names=os.environ.get("DIAGNOSTIC_TEST_NAMES", "")
if strict_names:files=json.loads(strict_names)
failed=0
print("DIAGNOSTIC_VERSION="+Path("node_modules/flatbush/package.json").read_text(),flush=True)
for name in files:
 if name == 'pipeline9-orangecrab-via-roundoff':
  if os.environ.get('FLATBUSH_VERSION'):
   manifest=Path('tests/repro/orangecrab-via-roundoff/package.json'); config=json.loads(manifest.read_text()); config['dependencies']['flatbush']=os.environ['FLATBUSH_VERSION']; manifest.write_text(json.dumps(config,indent=2)+'\n')
  subprocess.run(['bun','install','--ignore-scripts','--cwd','tests/repro/orangecrab-via-roundoff'],check=True)
 path=Path('tests/repro')/(name+'.test.ts')
 s=path.read_text()
 marker='  solver.solve()\n'
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
 if marker in s:path.write_text(s.replace(marker,log,1))
 env=dict(os.environ)
 if not strict_names:env['BUN_UPDATE_SNAPSHOTS']='1'
 result=subprocess.run(['bun','test',str(path),'--timeout','9999999'],env=env)
 svg=Path('tests/repro/__snapshots__')/(name+'.snap.svg')
 data=svg.read_bytes()
 print('LEGACY_SVG='+json.dumps({'revision':os.environ['REVISION'],'name':name,'exit':result.returncode,'drc':re.findall(r'Relaxed DRC errors: (\d+)',data.decode())}),flush=True)
 if result.returncode:failed+=1
 if result.returncode and not strict_names:raise SystemExit(result.returncode)

if strict_names and os.environ.get("FLATBUSH_VERSION") and failed:raise SystemExit(1)
