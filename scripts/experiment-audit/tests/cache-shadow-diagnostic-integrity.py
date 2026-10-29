#!/usr/bin/env python3
"""Pure policy, two-ledger and exact inner-ZIP controls; no actual boards."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
R=load("shadow_controller_fixture",ROOT/"run-cache-shadow-diagnostic.py")
C=load("shadow_exact_frozen_codec",ROOT/"framed-artifact-log.py")
checks=[]
def check(name,condition):
    if not condition:raise AssertionError(name)
    checks.append(name)
def main():
    m=json.loads(R.MANIFEST.read_text());m["candidate"]["candidateSha"]="c"*40;case=m["cases"][0];cp={"campaign":R.CAMPAIGN,"arm":"B","algorithmSha":"c"*40,"dataset":case["dataset"],"originalSample":case["sample"],"inputSha256":case["inputHash"],"observerSourceSha256":m["runtimeSourceHashes"]["phase-checkpoint-observer.ts"],"executionOrder":R.ORDER,"githubRunId":"9001","controllerSha":"e"*40}
    primary=dict(instances=1,lookups=100,hits=60,misses=40,distanceEvaluations=800,entryProbes=110,occupiedMissProbes=20,stores=40,evictions=20,coldStores=20,invalidations=1,identityInvalidations=1,lengthInvalidations=1,uncacheableQueries=0,mixedHashLookups=100,associativeLookups=20)
    shadow=dict(instances=1,lookups=100,legacyHits=50,legacyMisses=50,legacyDistanceEvaluations=1000,candidateHits=60,candidateMisses=40,candidateDistanceEvaluations=800,bothHits=40,legacyOnlyHits=10,candidateOnlyHits=20,bothMisses=30,assertedLegacyHits=50,invalidations=1,uncacheableQueries=0,indexMismatches=0)
    contract=R.contract();evidence={contract["candidatePath"]:primary,contract["shadowPath"]:shadow}
    rows=[{"event":"phase_setup_enter","phaseName":"highDensityRouteSolver"},{"event":"phase_run_enter","phaseName":"highDensityRouteSolver"},{"event":"phase_setup_enter","phaseName":"laterJoint"}]
    record={"official":{"routingMetrics":None},"phaseCheckpointAudit":{"errors":[],"stageBoundaries":rows,"lastDurableCheckpoint":{**cp,"observedObjectPath":"solver","observedConstructorName":R.common.SOLVER,"actualCacheProviderState":"disabled","observedRequestedOptions":m["candidate"]["options"],"evidence":evidence}}}
    v=R.census(record,m,case,cp);check("complete source-bound two-ledger census",v["counterCensusFinal"] and v["counterEvidenceComplete"] and v["actualOwnedQueryPrefixObserved"])
    check("counterfactual point difference is not performance or correctness credit",v["counterfactualLegacyMinusCandidatePointEvaluations"]==200 and not v["optimizationTimingCredit"] and not v["solvedBoardCredit"] and not v["independentCorrectnessOracleOnMisses"] and not v["actualBaselineExecution"])
    x=copy.deepcopy(record);x['phaseCheckpointAudit']['stageBoundaries']=rows[:2];v=R.census(x,m,case,cp);check('partial query prefix stays unknown',not v['counterCensusFinal'] and v['actualOwnedQueryPrefixObserved'])
    for path in evidence:
        for key in evidence[path]:
            x=copy.deepcopy(record);x['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence'][path][key]=True;v=R.census(x,m,case,cp);check('typed counter '+path+':'+key,not v['counterEvidenceComplete'])
        x=copy.deepcopy(record);x['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence'].pop(path);v=R.census(x,m,case,cp);check('missing entire ledger '+path,not v['counterEvidenceComplete'])
    for key in ['lookups','legacyHits','candidateHits','bothHits','assertedLegacyHits','instances','invalidations','candidateDistanceEvaluations','uncacheableQueries']:
        x=copy.deepcopy(record);x['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence'][contract['shadowPath']][key]+=1;v=R.census(x,m,case,cp);check('incoherent shadow '+key,not v['counterEvidenceComplete'])
    x=copy.deepcopy(record);x['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence'][contract['shadowPath']]['indexMismatches']=1;x['phaseCheckpointAudit']['stageBoundaries']=rows[:2];v=R.census(x,m,case,cp);check('partial hit-index divergence is explicit failure',v['indexDivergenceObserved'] and v['status']=='INDEX_DIVERGENCE_DIAGNOSTIC_FAILURE')
    for key in cp:
        x=copy.deepcopy(record);x['phaseCheckpointAudit']['lastDurableCheckpoint'].pop(key);v=R.census(x,m,case,cp);check('missing source identity '+key,not v['counterCensusFinal'] and not v['actualOwnedQueryPrefixObserved'])
    for key,bad in [("observedObjectPath","other"),("observedConstructorName","WrongSolver"),("actualCacheProviderState","enabled"),("observedRequestedOptions",{})]:
        x=copy.deepcopy(record);x["phaseCheckpointAudit"]["lastDurableCheckpoint"][key]=bad;v=R.census(x,m,case,cp);check("actual factory witness "+key,not v["counterCensusFinal"] and not v["actualOwnedQueryPrefixObserved"])
    x=copy.deepcopy(record);x['phaseCheckpointAudit']['errors']=['wrong source'];v=R.census(x,m,case,cp);check('bad checkpoint cannot prove HD completion',not v['counterCensusFinal'])
    for value in [None,[],1,'malformed']:
        x=copy.deepcopy(record);x['official']['routingMetrics']=value;v=R.census(x,m,case,cp);check('nullable/malformed audit cannot erase retained checkpoint '+str(value),v['counterCensusFinal'])
    check('exactly three candidate-only input cases',[(x['dataset'],x['sample']) for x in m['cases']]==R.CASES and m['candidateExecutions']==3 and m['actualBaselineExecution'] is False)
    with tempfile.TemporaryDirectory(prefix='shadow-codec-fixture-') as tmp:
        p=Path(tmp);directory=p/'source';directory.mkdir();provenance={'manifest':m,'githubRunId':'9001','controllerSha':'e'*40,'githubRunAttempt':'1','githubJobKey':'diagnostic','diagnosticType':'CACHE_SHADOW','cpuProfiling':False,'optimizationTimingCredit':False,'solvedBoardCredit':False,'inputIdentity':{'sampleNumber':case['sample'],'inputHash':case['inputHash']}}
        (directory/'profile-provenance.json').write_text(json.dumps(provenance));(directory/'profile-result.json').write_text(json.dumps({'dataset':case['dataset'],'sampleNumber':case['sample'],'expectedInputHash':case['inputHash'],'diagnosticType':'CACHE_SHADOW','shadowDiagnostics':v}))
        raw=directory/'attempt/raw';raw.mkdir(parents=True);(raw/'synthetic-raw.txt').write_text('exact retained synthetic bytes\n')
        stream=io.StringIO();C.emit(directory,p/'inner.zip',run_id='9001',controller_sha='e'*40,case='srj18:14',stream=stream)
        result=C.restore(stream.getvalue(),p/'restored.zip',expected_run_id='9001',expected_controller_sha='e'*40,expected_case='srj18:14');check('unchanged codec carries honest CACHE_SHADOW wire metadata without CPU files',(p/'inner.zip').read_bytes()==(p/'restored.zip').read_bytes() and result['profile_identity']['inputHash']==case['inputHash'])
        try:C.restore(stream.getvalue().rsplit('\n',2)[0],p/'invalid.zip',expected_run_id='9001',expected_controller_sha='e'*40,expected_case='srj18:14')
        except ValueError:check('truncated inner-ZIP transport fails closed',not (p/'invalid.zip').exists())
        else:check('truncated inner-ZIP transport fails closed',False)
    # Synthetic source attestation is only a parser fixture, never publication.
    with tempfile.TemporaryDirectory(prefix='shadow-sealed-policy-') as temp:
        path=Path(temp)/'SYNTHETIC-NOT-PUBLISHED.json';original=R.MANIFEST
        synthetic=copy.deepcopy(m);item=synthetic['candidate'];tree='f'*40;local='a'*40
        evidence=json.dumps({'sourceTree':tree,'localCommit':local,'rootReview':'SYNTHETIC_NOT_PUBLICATION'})
        import hashlib
        item.update(candidateSha='c'*40,candidateTree=tree,sourceBranch='codex/SYNTHETIC_NOT_PUBLISHED',publication={'publishedCommit':'c'*40,'expectedTree':tree,'reviewedLocalCommit':local},sourceQualification={'status':'PASS_ROOT_REVIEWED','sourceTree':tree,'fullTypesExitCode':0,'fullBuildExitCode':0,'focusedTestsExitCode':0,'evidenceText':evidence,'evidenceSha256':hashlib.sha256(evidence.encode()).hexdigest()})
        R.MANIFEST=path;path.write_text(json.dumps(synthetic));R.validate();check('synthetic sealed policy validates without running a board',True)
        for label,mutate in [
            ('CPU profiler',lambda x:x.update(cpuProfiling=True)),('performance credit',lambda x:x.update(optimizationTimingCredit=True)),('solved board credit',lambda x:x.update(solvedBoardCredit=True)),('baseline execution',lambda x:x.update(actualBaselineExecution=True)),('full84 count',lambda x:x.update(candidateExecutions=84)),('boolean thread',lambda x:x.update(threads=True)),('wrong original input',lambda x:x['cases'][0].update(inputHash='0'*64)),('missing selected case',lambda x:x['cases'].pop()),('flag false',lambda x:x['candidate']['options'].update(experimentFuturePointCache=False)),('missing shadow path',lambda x:x['candidate']['evidencePaths'].pop()),('active production source branch',lambda x:x['candidate'].update(sourceBranch='experiment/pipeline9-1')),('current PR head claim',lambda x:x['candidate'].update(sourceIsCurrentPrHead=True)),('wrong source tree receipt',lambda x:x['candidate']['sourceQualification'].update(sourceTree='d'*40)),('boolean source build QA',lambda x:x['candidate']['sourceQualification'].update(fullBuildExitCode=True)),('pending source',lambda x:x['candidate'].update(candidateSha=None))]:
            changed=copy.deepcopy(synthetic);mutate(changed);path.write_text(json.dumps(changed))
            try:R.validate()
            except ValueError:check('reject '+label,True)
            else:check('reject '+label,False)
        R.MANIFEST=original
    result={'status':'PASS_CACHE_SHADOW_PURE_POLICY_COUNTER_AND_CODEC_CONTROLS','checks':len(checks),'names':checks,'actualBoardRouting':0,'networkRequests':0}
    print(json.dumps(result,sort_keys=True))
if __name__=='__main__':main()
