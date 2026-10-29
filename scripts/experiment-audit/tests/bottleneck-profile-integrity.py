"""One synthetic profile qualification; never loads or routes a real board."""
import copy
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("profile_runtime",ROOT/"run-bottleneck-profile.py")
runtime = importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime)
manifest, authority = runtime.validate()
native_parent = subprocess.check_output(["git","show",runtime.old.MAIN+":scripts/benchmark/index.ts"],cwd=ROOT,text=True)
profile_parent = runtime.patch.profile_parent(native_parent)
assert profile_parent.count('...profileArgs') == 2
assert profile_parent.count('slot.child.kill("SIGKILL")') == 1
assert 'context.startsWith("shutting down worker ")' in profile_parent
assert 'slot.child.stdin.end()' in profile_parent
assert '--cpu-prof-interval=1000' in profile_parent
native_child = subprocess.check_output(["git","show",runtime.old.MAIN+":scripts/benchmark/benchmark.child.ts"],cwd=ROOT,text=True)
assert 'for await (const line of rl)' in native_child
assert 'process.exit' not in native_child
assert 'bottleneckProfileStartMarker()' in runtime.patch.profile_child(native_child)
assert 'bottleneckProfileEndMarker()' in runtime.patch.profile_child(native_child)
adapter = (ROOT/"experiment-audit-adapter.ts").read_text()
profile_adapter = runtime.patch.profile_adapter(adapter)
assert 'profilePid: process.pid' in profile_adapter and 'profilePerformanceTimeOriginMs: performance.timeOrigin' in profile_adapter
for bad in [native_parent.replace('slot.child.kill("SIGKILL")','slot.child.kill("SIGTERM")'),native_parent+native_parent]:
    try: runtime.patch.profile_parent(bad)
    except ValueError: pass
    else: raise AssertionError('Unreviewed parent shape accepted')

bun = subprocess.check_output(["which","bun"],text=True).strip()
with tempfile.TemporaryDirectory(prefix="bottleneck-profile-synthetic-") as directory:
    root=pathlib.Path(directory);child=root/"child.ts"
    child.write_text('import { bottleneckProfileStartMarker, bottleneckProfileEndMarker, recordBottleneckProfileMarker } from '+json.dumps(str(ROOT/'profile-clock-markers.ts'))+'\n'+'''import * as readline from "node:readline"
recordBottleneckProfileMarker("bottleneckProfileStartMarker",bottleneckProfileStartMarker())
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity})
function syntheticSetup(){let value=0;for(let i=0;i<30000000;i++)value+=Math.sqrt(i);return value}
function syntheticSearch(){let value=0;for(let i=0;i<30000000;i++)value+=Math.sin(i);return value}
for await(const line of rl){
 const marks:number[]=[];marks.push(performance.now());const setup=syntheticSetup();marks.push(performance.now());const search=syntheticSearch();marks.push(performance.now())
 recordBottleneckProfileMarker("bottleneckProfileEndMarker",bottleneckProfileEndMarker())
 process.stdout.write(JSON.stringify({pid:process.pid,timeOrigin:performance.timeOrigin,marks,setup,search,input:line})+"\\n")
}
''')
    command=[bun,"--cpu-prof","--cpu-prof-interval=1000","--cpu-prof-dir="+str(root),str(child)]
    process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=dict(os.environ,BOTTLENECK_PROFILE_DIRECTORY=str(root)))
    process.stdin.write('synthetic-only\n');process.stdin.flush()
    evidence=json.loads(process.stdout.readline());process.stdin.close()
    assert process.wait(timeout=10)==0
    profiles=list(root.glob('*.cpuprofile'));assert len(profiles)==1
    assert '.'+str(evidence['pid'])+'.' in profiles[0].name
    data=json.loads(profiles[0].read_text())
    marker_evidence=json.loads((root/'profile-clock-markers.json').read_text())
    assert marker_evidence['pid']==evidence['pid'] and len(marker_evidence['markers'])==2
    assert len(data['samples'])==len(data['timeDeltas'])>50
    nodes={n['id']:n for n in data['nodes']}
    stamp=data['startTime'];counts={'syntheticSetup':0,'syntheticSearch':0};misassigned=0;boundary=0
    marks=[(evidence['timeOrigin']+x)*1000 for x in evidence['marks']]
    for node,delta in zip(data['samples'],data['timeDeltas']):
        lo=stamp;stamp+=delta;hi=stamp
        name=nodes[node]['callFrame']['functionName']
        if name not in counts: continue
        if any(lo-2000 <= mark <= hi+2000 for mark in marks): boundary+=1;continue
        expected='syntheticSetup' if marks[0] <= lo <= hi <= marks[1] else ('syntheticSearch' if marks[1] <= lo <= hi <= marks[2] else None)
        if name!=expected:misassigned+=1
        counts[name]+=1
    assert all(x>10 for x in counts.values()) and misassigned==0,(counts,misassigned)
    # Hash calibration input/stdout/profile so the epoch/monotonic proof survives
    # fixture cleanup. These are synthetic evidence, never board performance.
    receipt={'status':'PASS_SYNTHETIC_ACTUAL_CHILD_EOF_PROFILE_AND_CLOCK_ALIGNMENT','diagnosticOnly':True,'realBoardsRouted':0,
        'bunVersion':subprocess.check_output([bun,'--version'],text=True).strip(),'profileFilename':profiles[0].name,
        'profileSha256':hashlib.sha256(profiles[0].read_bytes()).hexdigest(),'profileBytes':profiles[0].stat().st_size,
        'evidence':evidence,'profileStartTimeEpochUs':data['startTime'],'profileEndTimeEpochUs':data['endTime'],
        'nonBoundarySamplesByFunction':counts,'boundarySamplesExcluded':boundary,'misassignedNonBoundarySamples':misassigned,
        'guardMs':2,'guardIsSyntheticCalibrationNotUniversalClockGuarantee':True,
        'nativeTimeoutKillRetained':True,'normalEofExitCode':0,'samplingWeightsAreNotExactCpuTime':True}
    destination=pathlib.Path('/tmp/bottleneck-profile-calibration-evidence');destination.mkdir(exist_ok=True)
    (destination/'calibration-child.ts').write_bytes(child.read_bytes())
    (destination/'calibration-profile.cpuprofile').write_bytes(profiles[0].read_bytes())
    (destination/'calibration-stdout.json').write_text(json.dumps(evidence,indent=2)+'\n')
    (destination/'calibration-clock-markers.json').write_text(json.dumps(marker_evidence,indent=2)+'\n')
    (destination/'calibration-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,sort_keys=True))
