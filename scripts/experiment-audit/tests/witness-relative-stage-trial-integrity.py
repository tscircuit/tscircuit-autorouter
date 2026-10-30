#!/usr/bin/env python3
"""Pure prospective/sealed manifest and local-domain controls; no retained data."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('retained_stage_trial_controls',ROOT/'run-witness-relative-stage-trial.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)


def main():
    manifest=runner.validate(allow_unsealed=True);checks=['exact-prospective-or-sealed-assets-source-input-runtime-pins']
    if manifest['sealState']=='UNSEALED':
        try:runner.validate()
        except ValueError as error:assert 'UNSEALED'in str(error);checks.append('unsealed-production-run-refused')
        else:raise AssertionError('Unsealed trial accepted as runnable')
    for key,value in [('campaign','wrong'),('sourceBaseSha','0'*40),('maximumCandidates',17),('maximumStageIterations',21),('maximumStageSolveCalls',0),('viaMaximumMove',.3),('wireMaximumMove',.03),('routingAllowed',True),('productionStageSolveRequired',False),('independentBlacksmithDataOnlyReplayRequired',False),('localDatasetCheckerAllowed',True),('qualityOrSpeedCredit',True),('productionAcceptanceAllowed',True),('fullBoardRecoveryClaim',True)]:
        bad=copy.deepcopy(manifest);bad[key]=value
        try:runner.validate(bad,allow_unsealed=True)
        except ValueError:checks.append('reject-'+key)
        else:raise AssertionError('Foreign trial manifest accepted: '+key)
    before='export function collectRawViaSites(a: unknown) {}\nexport function checkBoardEnvelope(a: unknown) {}\n'
    assert runner.strip_visibility_exports(before)=='function collectRawViaSites(a: unknown) {}\nfunction checkBoardEnvelope(a: unknown) {}\n';checks.append('only-two-certificate-visibility-prefixes-reversible')
    for foreign in [before.replace('export function checkBoardEnvelope','function checkBoardEnvelope'),before+before]:
        try:runner.strip_visibility_exports(foreign)
        except ValueError:pass
        else:raise AssertionError('Unexpected certificate export mask accepted')
    checks.append('missing-or-duplicate-export-mask-refused')
    bun='/tmp/autorouter-post588-bun/package/bin/bun'
    complete=subprocess.run([bun,'-e','const fs=require("node:fs");const s=fs.readFileSync(process.argv[1],"utf8");const start=s.indexOf("const publishedNames =");const end=s.indexOf("\\nrequireValue(completeChecks(before)",start);if(start<0||end<start)throw new Error("Pure child guard block not found");const code=new Bun.Transpiler({loader:"ts"}).transformSync(s.slice(start,end));const {completeChecks,geometryChecksZero}=new Function(code+";return {completeChecks,geometryChecksZero}")();const names=["viaPad","padTrace","viaTrace","traceOverlap","differentNetViaSpacing","sameNetViaSpacing","padPad"];const baseline={referenceErrorCount:0,srjObstacleViolationCount:2,viaPadPolicyViolationCount:1,viaInPadViolationCount:0,copper:{status:"FAIL",allPublishedCopperChecksRun:true,ownershipCoverageStatus:"COMPLETE",qualifiedSupportedCopper:false,checksRun:names,checks:Object.fromEntries(names.map(n=>[n,{count:n==="viaPad"?1:0}]))}};if(!completeChecks(baseline)||geometryChecksZero(baseline))throw new Error("Known complete FAIL baseline was hidden or qualified clean");const unchanged=structuredClone(baseline);if(!completeChecks(unchanged)||geometryChecksZero(unchanged))throw new Error("Unchanged negative result rejected or qualified clean");const clean=structuredClone(baseline);clean.srjObstacleViolationCount=0;clean.viaPadPolicyViolationCount=0;clean.copper.status="PASS";clean.copper.qualifiedSupportedCopper=true;clean.copper.checks.viaPad.count=0;if(!completeChecks(clean)||!geometryChecksZero(clean))throw new Error("Complete clean candidate rejected");for(const mutate of [v=>{v.copper.allPublishedCopperChecksRun=false},v=>{v.copper.ownershipCoverageStatus="UNKNOWN"},v=>{v.copper.checksRun.pop()},v=>{delete v.copper.checks.padPad}]){const bad=structuredClone(baseline);mutate(bad);if(completeChecks(bad))throw new Error("Incomplete published checks or owners accepted")}',str(ROOT/'witness-relative-stage-child.ts')],capture_output=True,text=True)
    assert complete.returncode==0,complete.stderr;checks.append('actual-child-guards-preserve-complete-FAIL-baseline-and-unchanged-negative')
    canonical=subprocess.run([bun,'-e','const {isDeepStrictEqual}=require("node:util");const generated={a:1,omitted:undefined,n:-0};const retained={n:0,a:1};if(!isDeepStrictEqual(JSON.parse(JSON.stringify(generated)),retained))throw new Error("Canonical JSON field order/omission comparison failed");if(isDeepStrictEqual(JSON.parse(JSON.stringify(generated)),{n:0,a:2}))throw new Error("Changed canonical value was accepted");'],capture_output=True,text=True)
    assert canonical.returncode==0,canonical.stderr;checks.append('canonical-JSON-key-order-irrelevant-but-values-protected')
    env={key:value for key,value in os.environ.items()if key!='GITHUB_ACTIONS'}
    child=subprocess.run([bun,str(ROOT/'witness-relative-stage-child.ts'),'/nonexistent/source','/nonexistent/output','retained'],env=env,capture_output=True,text=True)
    assert child.returncode!=0 and 'Actual production stage execution is Blacksmith-only'in child.stderr;checks.append('local-actual-child-rejected-before-source-import')
    replay=subprocess.run(['python3',str(ROOT/'replay-witness-relative-stage-proof.py'),'--output','/nonexistent/output'],env=env,capture_output=True,text=True)
    assert replay.returncode!=0 and 'Actual retained proof replay is Blacksmith-only'in replay.stderr;checks.append('local-actual-replay-cli-rejected-before-data-read')
    parse=subprocess.run([bun,'-e','const fs=require("node:fs");new Bun.Transpiler({loader:"ts"}).transformSync(fs.readFileSync(process.argv[1],"utf8"));',str(ROOT/'witness-relative-stage-child.ts')],capture_output=True,text=True)
    assert parse.returncode==0,parse.stderr;checks.append('production-stage-child-TypeScript-parses')
    print(json.dumps({'status':'PASS_PURE_PROSPECTIVE_RETAINED_PRODUCTION_STAGE_CONTROLS','sealState':manifest['sealState'],'checks':checks,'count':len(checks),'actualDatasetCheckerExecutions':0,'actualStageExecutions':0,'routingExecutions':0,'networkRequests':0}))


if __name__=='__main__':main()
