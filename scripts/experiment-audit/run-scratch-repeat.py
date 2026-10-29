#!/usr/bin/env python3
"""Two selected scratch cases, four balanced fresh same-host pairs; no new board denominator."""
import argparse
import copy
import hashlib
import importlib.util
import inspect
import json
import os
from pathlib import Path
import re
import statistics

ROOT=Path(__file__).resolve().parent
MANIFEST=ROOT/'scratch-repeat16-20261029.json'
AUTHORITY=ROOT/'bottleneck-experiments-20261029.json'
WORKFLOW=ROOT.parent.parent/'.github/workflows/scratch-repeat.yml'
CAMPAIGN='scratch-repeat16-20261029'
CASES=[('srj18',14),('srj24',2)]
ORDERS=['AB','BA','BA','AB']
RESULT='SCRATCH_REPEAT_RESULT_JSON '
ACTIVE='SCRATCH_REPEAT_ACTIVE_JSON '
SUMMARY='SCRATCH_REPEAT_SUMMARY_JSON '
NEW_ASSETS={'run-scratch-repeat.py','seal-scratch-repeat-manifest.py','scratch-repeat-artifact-carrier.py','tests/scratch-repeat-integrity.py','tests/scratch-repeat-artifact-carrier-integrity.py'}

def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,ROOT/filename);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

common=load('repeat_frozen_native_runtime','run-bottleneck-experiments.py')
require,exact,sha=common.require,common.exact,common.sha
def obj(value):return value if isinstance(value,dict) else {}

def assets():return set(common.ASSETS)|NEW_ASSETS

def validate():
    m=json.loads(MANIFEST.read_text());a=common.validate_manifest(AUTHORITY)
    require(m.get('campaign')==CAMPAIGN and m.get('repository')=='tscircuit/tscircuit-autorouter','Wrong repeat campaign')
    require([(x.get('dataset'),x.get('sample')) for x in m.get('cases',[])]==CASES and m.get('pairOrders')==ORDERS,'Exact predeclared cases/orders required')
    require(type(m.get('plannedAttempts')) is int and m['plannedAttempts']==16 and type(m.get('plannedJobs')) is int and m['plannedJobs']==2,'Exactly16 repeated attempts in2jobs required')
    require(m.get('freshProcessPerAttempt') is True and m.get('nativeWithinSampleCachesUnchanged') is True and m.get('cpuProfiling') is False and m.get('sampleTimeoutSeconds')==360 and m.get('externalControllerGuardSeconds')==480,'Native process/deadline/cache policy changed')
    require(all(type(m.get(k)) is int and m[k]==1 for k in ['threads','concurrency','effort']),'Native effort/thread/concurrency changed')
    require(m.get('uniqueBoardDenominatorIncrease') is False and m.get('additionalSolvedBoardClaim') is False and m.get('overallOptimizationClaim') is False and m.get('correctedClocks') is False,'Repeat-study credit policy changed')
    require(m.get('authoritySha256')==sha(AUTHORITY) and m.get('workflowSha256')==sha(WORKFLOW),'Frozen authority/workflow changed')
    require(set(m.get('runtimeSourceHashes',{}))==assets() and all(sha(ROOT/n)==h for n,h in m['runtimeSourceHashes'].items()),'Repeat helper bytes changed')
    require(m.get('runSampleSourceSha256')==hashlib.sha256(inspect.getsource(common.pinned.run_sample).encode()).hexdigest(),'Fresh native run_sample changed')
    item=next(x for x in a['experiments'] if x['id']=='repair-search-scratch')
    require(exact(m.get('candidate'),item) and m.get('baselineSha')==common.MAIN,'Previously qualified scratch/native source changed')
    require(item['candidateSha']=='4670cce8f25203cab72155a6c4c9e8a9a33f44c9' and item['candidateTree']=='3b89af647470148fe97e2730c9d0cf1a7c51382d','Wrong measured scratch source')
    require(all(x.get('inputHash')==a['expectedInputHashesByDataset'][x['dataset']][str(x['sample'])] for x in m['cases']),'Original case input changed')
    require(m.get('estimators')==estimator_policy(),'Predeclared estimator/cohort changed')
    return m,a

def estimator_policy():
    return {'primaryTarget':'pipeline9JointDrcRepairSolver setup through next phase setup, with native constructor, setup+constructor and run intervals reported separately',
            'unchangedControls':['official-start through Joint phase_setup_enter','initial highDensityRouteSolver setup through next phase_setup_enter'],
            'wholeClock':'actual solver constructorTimeMs plus official elapsedTimeMs; own matched pair only',
            'reports':['every individual paired ratio','ratio of paired clock sums','median paired ratio','AB and BA order strata'],
            'wholeCohort':'Both strict, solved, physical/declared-supported clean, exact output/copper/inventory, all compact nonclock official+seven-report/ownership facts and native routing iteration facts equal',
            'componentBeforeLaterFailure':'Retain every completed source-bound component interval separately; no whole timing/output credit',
            'correction':'No clock normalization, prefix subtraction, historical timing pooling or discard of unfavorable repeats',
            'interpretation':'Four repetitions are descriptive repeats of each of two selected boards, not four additional boards or a full-dataset/overall optimization claim'}

def select_case(m,dataset,sample):
    case=next((x for x in m['cases'] if (x['dataset'],x['sample'])==(dataset,sample)),None);require(case is not None,'Outside predeclared case scope');return case

def pair_campaign(case,pair,order):return f"{CAMPAIGN}:{case['dataset']}:{case['sample']}:pair-{pair}:{order}"

def expected_cp(m,case,pair,arm,run_id,controller):
    require(type(pair) is int and 1<=pair<=4 and arm in ['A','B'],'Wrong pair/arm')
    require(isinstance(run_id,str) and re.fullmatch(r'[1-9][0-9]*',run_id) and common.digest(controller),'Run/head identity missing')
    return {'campaign':pair_campaign(case,pair,ORDERS[pair-1]),'arm':arm,'algorithmSha':common.MAIN if arm=='A' else m['candidate']['candidateSha'],
            'dataset':case['dataset'],'originalSample':case['sample'],'inputSha256':case['inputHash'],'observerSourceSha256':m['runtimeSourceHashes']['phase-checkpoint-observer.ts'],
            'executionOrder':ORDERS[pair-1],'githubRunId':str(run_id),'controllerSha':controller}

def metadata(m,case,pair,arm):
    order=ORDERS[pair-1]
    return {'campaign':pair_campaign(case,pair,order),'experiment':'repair-search-scratch','pr':3198,'dataset':case['dataset'],'round':pair,'pairIndex':pair,'sampleNumber':case['sample'],'arm':arm,'executionOrder':order,'requestedOptions':m['candidate']['options'] if arm=='B' else {'cacheProvider':None,'effort':1}}

def qualify(record,m,a,case,pair,arm,run_id,controller):
    cp=record.get('phaseCheckpointAudit') or {};last=cp.get('lastDurableCheckpoint') or {};expected=expected_cp(m,case,pair,arm,run_id,controller)
    require(all(exact(record.get(k),v) for k,v in metadata(m,case,pair,arm).items()),'Record pair/order/option identity differs')
    require(record.get('sha')==expected['algorithmSha'] and record.get('expectedInputHash')==case['inputHash'],'Record source/input identity differs')
    require(cp.get('errors')==[] and all(v is not None and exact(last.get(k),v) for k,v in expected.items()),'Source/input/round/order checkpoint identity unbound')
    require(last.get('observedObjectPath')=='solver' and last.get('observedConstructorName')==common.SOLVER and last.get('actualCacheProviderState')=='disabled' and exact(last.get('observedRequestedOptions'),record['requestedOptions']),'Actual observed native constructor/options differ')
    common.qualify_record(record,a,m['candidate']);record['durableTimeoutSourceQualification']=common.timeout_checkpoint_qualification(record)
    record['nonterminalFeatureObservations']=common.coverage_module.nonterminal_observations(record,m['candidate'])
    return record

def source_qualified(record):
    gaps={'Actual factory input/options/cache identity unproven','Actual solver/sample/deadline identity differs','Timing observations missing'}
    return not record.get('repeatQualificationError') and (record.get('strictIntegrityQualified') is True or ((record.get('durableTimeoutSourceQualification') or {}).get('sourceAndInputProvenByBoundedCheckpoints') is True and set(record.get('strictIntegrityIssues',[]))==gaps))

def nonclock_facts(record):
    official=obj(record.get('official'));supp=obj(record.get('supplemental'));metrics=obj(official.get('routingMetrics'))
    return {'official':{k:official.get(k) for k in ['didSolve','didTimeout','relaxedDrcPassed','viaCount','traceLintIssueCounts','drcErrorCount','drcErrorTypes','drcErrorMessages']},
            'supplemental':{k:v for k,v in supp.items() if k!='validationTimeMs'},'declared':record.get('declaredIntentCopper'),
            'routingIterationsAndMetrics':{'highDensityIterations':metrics.get('highDensityIterations'),'tinyHypergraph':{k:v for k,v in obj(metrics.get('tinyHypergraph')).items() if k!='timeMs'}}}

def output_hashes(record):
    metrics=obj(obj(record.get('official')).get('routingMetrics'));audit=obj(metrics.get('experimentAudit'))
    return {'rawOutputHash':audit.get('rawOutputHash'),'rawNewTracesHash':audit.get('rawNewTracesHash'),'canonicalCopper':(record.get('supplemental') or {}).get('canonicalCircuitJsonSha256'),'findingInventory':(record.get('declaredIntentCopper') or {}).get('findingInventorySha256')}

def intervals(record):
    rows=(record.get('phaseCheckpointAudit') or {}).get('stageBoundaries',[])
    def stage(name):
        start=next((i for i,x in enumerate(rows) if x.get('phaseName')==name and x.get('event')=='phase_setup_enter'),None)
        if start is None:return None
        rr=rows[start:];stamp=lambda event:next((x.get('officialStartOffsetMs') for x in rr if x.get('phaseName')==name and x.get('event')==event),None)
        setup=stamp('phase_setup_enter');params=stamp('constructor_params_exit');constructed=stamp('active_subsolver_constructed');run=stamp('phase_run_enter');end=next((x.get('officialStartOffsetMs') for x in rr[1:] if x.get('event')=='phase_setup_enter' and x.get('phaseName')!=name),None)
        difference=lambda x,y:y-x if common.finite(x) and common.finite(y) and y>=x else None
        return {'setupOffsetMs':setup,'setupThroughNextSetupMs':difference(setup,end),'nativeConstructorMs':difference(params,constructed),'setupThroughConstructedMs':difference(setup,constructed),'runThroughNextSetupMs':difference(run,end),'completedStage':end is not None,'constructorCompleted':constructed is not None}
    return {'Joint':stage('pipeline9JointDrcRepairSolver'),'initialHD':stage('highDensityRouteSolver')}

def clock_summary(pairs,key):
    values=[p[key] for p in pairs if p.get(key) is not None]
    return {'pairCount':len(values),'pairedSumsMs':{arm:sum(x[arm] for x in values) for arm in 'AB'},'weightedBdivA':sum(x['B'] for x in values)/sum(x['A'] for x in values) if values and sum(x['A'] for x in values)>0 else None,'medianPairedBdivA':statistics.median(x['B']/x['A'] for x in values) if values and all(x['A']>0 for x in values) else None}

def summarize(records,case):
    index={(r['pairIndex'],r['arm']):r for r in records};pairs=[]
    for pair,order in enumerate(ORDERS,1):
        if not all((pair,arm) in index for arm in 'AB'):continue
        values={arm:index[pair,arm] for arm in 'AB'};source=all(source_qualified(r) for r in values.values());hashes={arm:output_hashes(r) for arm,r in values.items()};facts={arm:nonclock_facts(r) for arm,r in values.items()}
        quality=all(r.get('strictIntegrityQualified') is True and common.physical_clean(r) for r in values.values()) and exact(hashes['A'],hashes['B']) and all(common.digest(h,64) for h in hashes['A'].values()) and exact(facts['A'],facts['B'])
        clocks=None
        if quality:clocks={arm:r['official']['elapsedTimeMs']+r['official']['routingMetrics']['experimentAudit']['constructorTimeMs'] for arm,r in values.items()}
        phase={arm:intervals(r) for arm,r in values.items()};component={}
        for stage in ['Joint','initialHD']:
            for key in ['setupThroughNextSetupMs','nativeConstructorMs','setupThroughConstructedMs','runThroughNextSetupMs']:
                vv={arm:(phase[arm].get(stage) or {}).get(key) for arm in 'AB'};component[stage+'.'+key]=vv if source and all(common.finite(x) for x in vv.values()) else None
        prefix={arm:(phase[arm]['Joint'] or {}).get('setupOffsetMs') for arm in 'AB'}
        pairs.append({'pairIndex':pair,'order':order,'sourceQualified':source,'wholeQualityQualified':quality,'wholeClockMs':clocks,'wholeBdivA':clocks['B']/clocks['A'] if clocks and clocks['A']>0 else None,'outputHashes':hashes,'nonclockFactsEqual':exact(facts['A'],facts['B']),'componentIntervalsMs':component,'unchangedPrefixMs':prefix if source and all(common.finite(x) for x in prefix.values()) else None,'actualCandidateCounters':values['B'].get('featureCoverage'),'outcomes':{arm:{k:obj(r.get('official')).get(k) for k in ['didSolve','didTimeout','relaxedDrcPassed']} for arm,r in values.items()}})
    quality_pairs=[p for p in pairs if p['wholeQualityQualified']]
    components={}
    if pairs:
        for key in pairs[0]['componentIntervalsMs']:
            selected=[dict(p,value=p['componentIntervalsMs'][key]) for p in quality_pairs]
            components[key]={'wholeQualityQualified':clock_summary(selected,'value'),'wholeQualityQualifiedByOrder':{o:clock_summary([p for p in selected if p['order']==o],'value') for o in ['AB','BA']},'sourceBoundIntervalsRetainedBeforeLaterFailure':sum(p['componentIntervalsMs'][key] is not None and not p['wholeQualityQualified'] for p in pairs)}
    return {'campaign':CAMPAIGN,'case':case,'recordCount':len(records),'expectedRecords':8,'populationComplete':len(records)==len(index)==8 and set(index)=={(p,a) for p,o in enumerate(ORDERS,1) for a in o},'sourceQualifiedRecordCount':sum(source_qualified(r) for r in records),'strictRecordCount':sum(r.get('strictIntegrityQualified') is True for r in records),'wholeQualityQualifiedPairs':len(quality_pairs),'pairs':pairs,'whole':clock_summary(pairs,'wholeClockMs'),'wholeByOrder':{o:clock_summary([p for p in pairs if p['order']==o],'wholeClockMs') for o in ['AB','BA']},'wholeQualityQualifiedComponentClocks':components,'unchangedPrefix':clock_summary(pairs,'unchangedPrefixMs'),'wholeQualityQualifiedUnchangedPrefix':clock_summary(quality_pairs,'unchangedPrefixMs'),'uniqueBoardDenominatorIncrease':False,'additionalSolvedBoardClaim':False,'overallOptimizationClaim':False,'clocksCorrected':False,'scope':'Four descriptive repetitions of this one preselected case; all clocks/failed attempts retained without global performance claims.'}

def run(args,m,a):
    case=select_case(m,args.dataset,args.sample);item=m['candidate'];output=args.output.resolve();require(not output.exists() or not any(output.iterdir()),'Fresh output required');checkouts={'A':args.baseline.resolve(),'B':args.candidate.resolve()};common.verify_checkouts(a,item,checkouts);common.verify_dependencies(a,checkouts)
    identities={arm:common.pinned.read_identity(path,args.dataset) for arm,path in checkouts.items()};require(exact(identities['A'],identities['B']) and {str(x['sampleNumber']):x['inputHash'] for x in identities['A']}==a['expectedInputHashesByDataset'][args.dataset],'Original input population changed');identity=next(x for x in identities['A'] if x['sampleNumber']==args.sample);require(identity['inputHash']==case['inputHash'],'Original selected input changed')
    harnesses={arm:json.loads((path/'experiment-harness-provenance.json').read_text()) for arm,path in checkouts.items()}
    for arm,h in harnesses.items():require(h.get('checkoutSha')==(common.MAIN if arm=='A' else item['candidateSha']) and h.get('validators')==a['expectedValidatorHashes'] and all(h.get(k)==v for k,v in a['expectedHarnessSourceHashes'].items()),'Native harness/source changed')
    comparison=common.pinned.compare_dependency_resolutions(harnesses);common.pinned.write_json(output/'provenance.json',{'manifest':m,'manifestSha256':sha(MANIFEST),'case':case,'inputIdentity':identity,'harnesses':harnesses,'dependencyComparison':comparison,'githubRunId':os.environ.get('GITHUB_RUN_ID'),'controllerSha':os.environ.get('GITHUB_SHA'),'runAttempt':os.environ.get('GITHUB_RUN_ATTEMPT'),'pairOrders':ORDERS,'uniqueBoardDenominatorIncrease':False})
    records=[]
    for pair,order in enumerate(ORDERS,1):
        for arm in order:
            cp=expected_cp(m,case,pair,arm,os.environ.get('GITHUB_RUN_ID'),os.environ.get('GITHUB_SHA'));config=dict(a['baseline'],evidencePaths=item['evidencePaths']) if arm=='A' else dict(item);config.update(phaseCheckpoint=cp,repeatStudy={'case':case,'pairIndex':pair,'round':pair,'order':order})
            config_path=output/f'pair-{pair}'/f'config-{arm}.json';common.pinned.write_json(config_path,config);meta=metadata(m,case,pair,arm);print(ACTIVE+json.dumps(meta),flush=True);target=output/f'pair-{pair}'/arm
            record=common.pinned.run_sample(checkouts[arm],config_path,target,args.dataset,args.sample,360);record.update(meta,qualificationMode='selected-case-repeated-full',scenarioName=identity['scenarioName'],expectedInputHash=identity['inputHash'],sha=cp['algorithmSha'],solverName=common.SOLVER)
            common.declared.qualify_output(record,target,checkouts[arm],a,ROOT,common.pinned.execute_with_deadline);record['phaseCheckpointAudit']=common.checkpoint_audit(target/'raw',cp)
            try:qualify(record,m,a,case,pair,arm,os.environ.get('GITHUB_RUN_ID'),os.environ.get('GITHUB_SHA'))
            except Exception as error:
                record['repeatQualificationError']=str(error);record['strictIntegrityQualified']=False;record['strictIntegrityIssues']=['Repeated attempt qualification failed: '+str(error)]
            records.append(record);common.pinned.write_json(target/'audit-result.json',record)
            with (output/'results.jsonl').open('a') as stream:stream.write(json.dumps(record)+'\n')
            print(RESULT+json.dumps(record,separators=(',',':')),flush=True);common.pinned.write_json(output/'summary.json',summarize(records,case))
    summary=summarize(records,case);common.pinned.write_json(output/'summary.json',summary);print(SUMMARY+json.dumps(summary,separators=(',',':')),flush=True);require(summary['populationComplete'] and summary['sourceQualifiedRecordCount']==8,'Repeated source population unqualified; all raw attempts retained')

def parse_log(text,m,a,case,run_id,controller):
    rows=[];active=[];summaries=[]
    for line in text.splitlines():
        line=re.sub(r'^\ufeff?(?:\d{4}-\d{2}-\d{2}T\S+Z\s+)?','',line)
        for prefix,target in [(RESULT,rows),(ACTIVE,active),(SUMMARY,summaries)]:
            if line.startswith(prefix):target.append(json.loads(line[len(prefix):]))
    expected=[(pair,arm) for pair,order in enumerate(ORDERS,1) for arm in order];require([(r.get('pairIndex'),r.get('arm')) for r in rows]==expected and len(summaries)==1,'Exact8 records/order and one summary required')
    require(exact(active,[metadata(m,case,pair,arm) for pair,arm in expected]),'Active/retained identity population differs')
    for record,(pair,arm) in zip(rows,expected):
        replay=copy.deepcopy(record);qualify(replay,m,a,case,pair,arm,run_id,controller)
        require(all(exact(replay.get(k),record.get(k)) for k in ['strictIntegrityQualified','strictIntegrityIssues','featureCoverage','durableTimeoutSourceQualification','nonterminalFeatureObservations']),'Self-reported source/counter qualification differs')
    summary=summarize(rows,case);require(exact(summary,summaries[0]),'Retained summary differs from exact records');require(summary['populationComplete'] and summary['sourceQualifiedRecordCount']==8,'Unqualified repeated source population')
    return {'schemaVersion':1,'campaign':CAMPAIGN,'runId':str(run_id),'controllerSha':controller,'case':case,'manifestSha256':sha(MANIFEST),'runtimeSha256':sha(Path(__file__)),'records':rows,'summary':summary,'rawLogSha256':hashlib.sha256(text.encode('utf8')).hexdigest(),'sourceQualified':True,'uniqueBoardDenominatorIncrease':False,'additionalSolvedBoardClaim':False,'overallOptimizationClaim':False}

def main():
    p=argparse.ArgumentParser();p.add_argument('--mode',choices=['plan','select','verify-checkouts','verify-dependencies','run','parse'],required=True);p.add_argument('--baseline',type=Path);p.add_argument('--candidate',type=Path);p.add_argument('--dataset',choices=['srj18','srj24']);p.add_argument('--sample',type=int);p.add_argument('--output',type=Path);p.add_argument('--job-log',type=Path);p.add_argument('--run-id');p.add_argument('--controller-sha');args=p.parse_args();m,a=validate()
    if os.environ.get('GITHUB_ACTIONS')=='true':require(os.environ.get('GITHUB_EVENT_NAME')=='push' and os.environ.get('GITHUB_REF_NAME')==common.BRANCH and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','Only first reviewed controller branch push attempt may run')
    if args.mode=='plan':common.outputs({'matrix':json.dumps({'include':[{'dataset':x['dataset'],'sample':x['sample']} for x in m['cases']]},separators=(',',':'))});return
    case=select_case(m,args.dataset,args.sample)
    if args.mode=='select':common.outputs({'baseline_sha':common.MAIN,'candidate_sha':m['candidate']['candidateSha'],'harness_sha':common.MAIN})
    elif args.mode=='verify-checkouts':common.verify_checkouts(a,m['candidate'],{'A':args.baseline.resolve(),'B':args.candidate.resolve()})
    elif args.mode=='verify-dependencies':common.verify_dependencies(a,{'A':args.baseline.resolve(),'B':args.candidate.resolve()})
    elif args.mode=='parse':require(not args.output.exists(),'Never overwrite parsed records');common.pinned.write_json(args.output,parse_log(args.job_log.read_text(),m,a,case,args.run_id,args.controller_sha))
    else:run(args,m,a)

if __name__=='__main__':main()
