"""One pure source/tap/manifest/fingerprint test; no actual retained data."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('component_controller_pure_controls',ROOT/'run-relative-v2-main18-component-diagnostic.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
BUN='/tmp/autorouter-post588-bun/package/bin/bun'


class ComponentControllerControls(unittest.TestCase):
    def test_exact_observations_source_and_component_scope(self):
        manifest=runner.validate();checks=['sealed-exact-published-source-main18-input-and-assets']
        for key,value in [('campaign','other'),('controllerBranch','other'),('sourceSha','0'*40),('inheritedLocal','0'*40),('baselineCertificateSha256','0'*64),('maximumCandidates',17),('maximumConceptualSteps',21),('viaMaximumMove',.3),('wireMaximumMove',.03),('stageSolveCalls',1),('routingAllowed',True),('localDatasetCheckerAllowed',True),('productionAcceptanceAllowed',True),('fullBoardRecoveryClaim',True),('qualityOrSpeedCredit',True),('productionStageCredit',True),('completeOriginalInstrumentedReturnEqualityRequired',False),('detailedUntargetedFindingMultisetsExact',False),('publishedV2ProposalHelperRequired',False),('samePublishedRelativeProofRequired',False),('independentBlacksmithDataOnlyReplayRequired',False)]:
            bad=copy.deepcopy(manifest);bad[key]=value
            with self.assertRaises(ValueError):runner.validate(bad)
            checks.append('reject-'+key)
        source=Path('/tmp/autorouter-relative-witness-v2')/manifest['certificateRelative'];original=runner.prior.strip_visibility_exports(source.read_text())
        self.assertEqual(hashlib.sha256(original.encode()).hexdigest(),manifest['certificateSha256'])
        observed=runner.tap.instrument(original);self.assertEqual(runner.tap.strip(observed),original);self.assertEqual(observed.count(runner.tap.BEGIN),11)
        with self.assertRaises(ValueError):runner.tap.instrument(original.replace('checkViasInPads(native.circuitJson)','checkViasInPads(other)'))
        with tempfile.TemporaryDirectory()as directory:
            path=Path(directory)/'observed.ts';path.write_text(observed)
            parsed=subprocess.run([BUN,'-e','const fs=require("node:fs");for(const p of process.argv.slice(1))new Bun.Transpiler({loader:"ts"}).transformSync(fs.readFileSync(p,"utf8"));',str(path),str(ROOT/'relative-v2-main18-component-child.ts')],capture_output=True,text=True)
            self.assertEqual(parsed.returncode,0,parsed.stderr)
        checks.append('eleven-transparent-tagged-blocks-strip-to-exact-oldbody-and-parse')
        js='''const fs=require("node:fs"),s=fs.readFileSync(process.argv[1],"utf8"),a=s.indexOf("function stable("),b=s.indexOf("const owners =",a);if(a<0||b<a)throw Error("Fingerprint definitions absent");const code=new Bun.Transpiler({loader:"ts"}).transformSync(s.slice(a,b));const {stable,multiset}=new Function("requireValue",code+";return {stable,multiset}")((v,m)=>{if(!v)throw Error(m)});if(stable({a:1,b:[2,3]})!==stable({b:[2,3],a:1}))throw Error("Object order matters");for(const [a,b]of [[{}, {x:undefined}],[-0,0],[[1,2],[2,1]],[[undefined],Array(1)]])if(stable(a)===stable(b))throw Error("Lossy detail encoder");if(multiset([{a:1},{a:1}]).length!==2)throw Error("Multiplicity lost");const cycle={};cycle.x=cycle;const extra=[];extra.extra=1;for(const v of [NaN,Infinity,-Infinity,1n,()=>1,new Date(),cycle,extra]){let failed=false;try{stable(v)}catch{failed=true}if(!failed)throw Error("Unsupported fingerprint accepted")}'''
        js=js.replace('return {stable,multiset}', 'return {stable,multiset,coupledOccurrences}').replace('const {stable,multiset}=', 'const {stable,multiset,coupledOccurrences}=')
        js+='''const traces=[{route:[{route_type:"wire",x:2,y:3,layer:"top"},{route_type:"via",x:2,y:3,from_layer:"top",to_layer:"bottom"},{route_type:"wire",x:2,y:3,layer:"bottom"},{route_type:"wire",x:2,y:3,layer:"inner1"},{route_type:"wire",x:9,y:3,layer:"top"}]}];const site={x:2,y:3,layers:["top","bottom"],occurrences:[{traceIndex:0,pointIndex:1}]};const all=coupledOccurrences(traces,site);if(JSON.stringify(all)!==JSON.stringify([{traceIndex:0,pointIndex:0},{traceIndex:0,pointIndex:1},{traceIndex:0,pointIndex:2}]))throw Error("Via-only inventory failed to expand to all supported wire-via-wire aliases");const moved=structuredClone(traces);for(const p of all)Object.assign(moved[p.traceIndex].route[p.pointIndex],{x:2.01,y:3.01});if(all.some(p=>moved[p.traceIndex].route[p.pointIndex].x!==2.01)||moved[0].route[3].x!==2||moved[0].route[4].x!==9)throw Error("Coupled mask failed");'''
        result=subprocess.run([BUN,'-e',js,str(ROOT/'relative-v2-main18-component-child.ts')],capture_output=True,text=True);self.assertEqual(result.returncode,0,result.stderr)
        checks.append('strict-lossless-full-record-multisets-preserve-undefined-minuszero-arrays-and-duplicates')
        checks.append('production-equivalent-wire-via-wire-coupling-expands-via-only-inventory')
        env={k:v for k,v in os.environ.items()if k!='GITHUB_ACTIONS'}
        for command,message in [([BUN,str(ROOT/'relative-v2-main18-component-child.ts'),'/nonexistent/source','/nonexistent/output','retained'],'Actual retained component predicates are Blacksmith-only'),(['python3',str(ROOT/'replay-relative-v2-main18-component-proof.py'),'--output','/nonexistent/output'],'Actual retained component proof replay is Blacksmith-only')]:
            result=subprocess.run(command,env=env,capture_output=True,text=True);self.assertNotEqual(result.returncode,0);self.assertIn(message,result.stderr)
        checks.append('actual-child-and-proof-local-CLIs-rejected-before-source-or-data-read')
        print(json.dumps({'status':'PASS_PURE_OBSERVATIONAL_COMPONENT_DIAGNOSTIC_CONTROLS','checks':checks,'count':len(checks),'actualStageOrCheckerExecutions':0,'actualRetainedProofReplayExecutions':0,'networkRequests':0}))


if __name__=='__main__':unittest.main()
