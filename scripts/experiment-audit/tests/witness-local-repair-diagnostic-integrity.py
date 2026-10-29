#!/usr/bin/env python3
"""Pure manifest, syntax and runner-domain controls; no retained geometry."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('local_component_controls',ROOT/'run-witness-local-repair-diagnostic.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)

def main():
    manifest=runner.validate();checks=['sealed-source-input-runtime-assets-pass']
    for key,value in [('campaign','wrong'),('sourceSha','0'*40),('maximumCandidates',17),('viaMaximumMove',0.3),('wireMaximumMove',0.03),('qualityOrSpeedCredit',True),('productionAcceptanceAllowed',True),('routingAllowed',True),('fullBoardRecoveryClaim',True),('newDiagnosticSubsetNotProductionMovementCap',False)]:
        bad=copy.deepcopy(manifest);bad[key]=value
        try:runner.validate(bad)
        except ValueError:checks.append('reject-'+key)
        else:raise AssertionError('Foreign manifest accepted: '+key)
    bun='/tmp/autorouter-post588-bun/package/bin/bun'
    child=subprocess.run([bun,str(ROOT/'witness-local-repair-child.ts'),'/nonexistent/source','/nonexistent/output','retained'],env={key:value for key,value in os.environ.items() if key!='GITHUB_ACTIONS'},capture_output=True,text=True)
    assert child.returncode!=0 and 'Actual retained certificate evaluation is Blacksmith-only' in child.stderr
    checks.append('local-retained-child-rejected-before-source-import')
    syntax=subprocess.run([bun,'-e','const fs=require("node:fs");for(const path of process.argv.slice(1))new Bun.Transpiler({loader:"ts"}).transformSync(fs.readFileSync(path,"utf8"));',str(ROOT/'witness-local-repair-child.ts'),str(ROOT/'witness-local-repair-proposals.ts')],capture_output=True,text=True)
    assert syntax.returncode==0,syntax.stderr;checks.append('both-TypeScript-programs-parse')
    print(json.dumps({'status':'PASS_PURE_COMPONENT_DIAGNOSTIC_CONTROLS','checks':checks,'count':len(checks),'actualDatasetCheckerExecutions':0,'routingExecutions':0,'networkRequests':0}))

if __name__=='__main__':main()
