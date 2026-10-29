#!/usr/bin/env python3
"""Full original42 cases in11 deterministic shards with fresh own native/candidate pairs."""
import argparse
import copy
import hashlib
import importlib.util
import inspect
import json
import os
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parent
MANIFEST=ROOT/'pruning-sharded84-20261029.json'
AUTHORITY=ROOT/'bottleneck-experiments-20261029.json'
WORKFLOW=ROOT.parent.parent/'.github/workflows/pruning-sharded-experiment.yml'
CAMPAIGN='pruning-sharded84-20261029'
SOURCE='952204726757f7ea423c0ca658d7a400903414a2'
TREE='44ab181739c32eda88df89f0a19b305bb6f3229d'
FLAG='experimentFuturePointDistancePruning'
PATH='highDensityRouteSolver.futurePointDistancePruningStats'
RESULT='PRUNING_SHARD_RESULT_JSON '
ACTIVE='PRUNING_SHARD_ACTIVE_JSON '
SUMMARY='PRUNING_SHARD_SUMMARY_JSON '
NEW_ASSETS={'run-pruning-sharded.py','seal-pruning-sharded-manifest.py','pruning-context-coverage.py','pruning-shard-artifact-carrier.py','tests/pruning-sharded-integrity.py','tests/pruning-context-coverage-integrity.py','tests/pruning-shard-artifact-carrier-integrity.py','run-scratch-repeat.py'}

def load(name,filename):
    s=importlib.util.spec_from_file_location(name,ROOT/filename);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

pair_helpers=load('immutable_pair_evidence_helpers','run-scratch-repeat.py')
common=pair_helpers.common
coverage=load('actual_pruning_context_census','pruning-context-coverage.py')
require,exact,sha=common.require,common.exact,common.sha
obj=pair_helpers.obj
source_qualified=pair_helpers.source_qualified

def assets():return set(common.ASSETS)|NEW_ASSETS

def derived_shards(authority):
    rows=[]
    for dataset,count,nshards in [('srj18',16,4),('srj24',26,7)]:
        for shard in range(nshards):
            cases=[{'sample':sample,'inputHash':authority['expectedInputHashesByDataset'][dataset][str(sample)],'order':'AB' if (shard+ordinal)%2==0 else 'BA'} for ordinal,sample in enumerate(n for n in range(1,count+1) if (n-1)%nshards==shard)]
            rows.append({'dataset':dataset,'shardIndex':shard,'shardCount':nshards,'cases':cases})
    return rows

def estimator_policy():
    return {'primaryTarget':'Initial highDensityRouteSolver setup through next phase setup, with native constructor and run reported separately',
            'wholeClock':'Actual solver constructorTimeMs plus official elapsedTimeMs; own matched same-host native/candidate pair only',
            'qualityCohort':'Both strict solved physical/declared-supported clean, exact outputs/copper/finding inventory plus all compact nonclock official/seven-report/ownership and native routing iteration facts equal',
            'reports':['every original case paired ratio','ratio of own matched clock sums','median paired ratio','prospectively assigned AB/BA strata'],
            'completedComponentBeforeLaterFailure':'Retain completed source-bound HD intervals and context census separately; no whole output/timing credit',
            'counterSemantics':'instances and contextsPruned count admitted contexts and contexts with a first actual sqrt+numeric-add skip; not queries, points, sqrt totals, saved work volume, all-HD coverage or a baseline comparator',
            'clocks':'No profile, clock normalization, historical baseline reuse, prefix correction, outcome-dependent pruning or pooling with prior336/repeat16',
            'fullUnion':'All16srj18 plus26srj24 original IDs occur exactly once perarm in this84, retaining duplicate inputs and every native failure/timeout',
            'zeroActivation':'Coherent zero eligible/pruned contexts are valid UNEXERCISED cases, retained in full quality and matched whole clocks; their flag/dispatch/setup costs count. Positive markers only prove actual context pruning, not performance.'}

def validate():
    m=json.loads(MANIFEST.read_text());a=common.validate_manifest(AUTHORITY)
    require(m.get('campaign')==CAMPAIGN and m.get('repository')=='tscircuit/tscircuit-autorouter','Wrong sharded campaign')
    require(m.get('shards')==derived_shards(a) and exact(m.get('shards'),derived_shards(a)),'Full exact deterministic modulo union/order/input population changed')
    require(type(m.get('plannedJobs')) is int and m['plannedJobs']==11 and type(m.get('plannedAttempts')) is int and m['plannedAttempts']==84,'Exact11 jobs and84 attempts required')
    require(m.get('caseCounts')=={'srj18':16,'srj24':26} and m.get('orderCounts')=={'AB':21,'BA':21},'Full case/order counts changed')
    require(exact(m.get('fullOriginalInputPopulationHashes'),a['expectedInputHashesByDataset']) and m.get('orderRule')=='AB when (shardIndex + zero-based ordinalWithinShard) is even; BA otherwise','Original full input population/prospective order rule changed')
    require(m.get('priorClean336Immutable') is True and m.get('priorScratchRepeat16Immutable') is True and m.get('originalServerZipRawProofRequired') is True,'Prior-authority/raw-proof policy changed')
    require(m.get('baselineSha')==common.MAIN and m.get('authoritySha256')==sha(AUTHORITY) and m.get('workflowSha256')==sha(WORKFLOW),'Native authority/workflow changed')
    require(set(m.get('runtimeSourceHashes',{}))==assets() and all(sha(ROOT/n)==h for n,h in m['runtimeSourceHashes'].items()),'Sharded helper bytes changed')
    require(m.get('runSampleSourceSha256')==hashlib.sha256(inspect.getsource(common.pinned.run_sample).encode()).hexdigest(),'Native fresh process routine changed')
    require(m.get('freshProcessPerAttempt') is True and m.get('nativeWithinSampleCachesUnchanged') is True and m.get('cpuProfiling') is False and m.get('correctedClocks') is False and m.get('timingsPooledWithPriorCampaigns') is False,'Native process/cache/clock policy changed')
    require(m.get('sampleTimeoutSeconds')==360 and m.get('externalControllerGuardSeconds')==480 and all(type(m.get(k)) is int and m[k]==1 for k in ['threads','concurrency','effort']),'Native deadlines/runtime changed')
    require(m.get('estimators')==estimator_policy(),'Prospective estimator/cohort changed')
    require(m.get('zeroContextCasesRetainedInQualityAndWhole') is True,'Zero-work cases must remain in quality/whole timing cohorts')
    item=m.get('candidate',{});require(item.get('id')=='future-distance-pruning' and item.get('candidateSha')==SOURCE and item.get('candidateTree')==TREE and item.get('option')==FLAG,'Wrong qualified pruningV2 source')
    require(exact(item.get('options'),{'cacheProvider':None,'effort':1,FLAG:True}) and item.get('evidencePaths')==[PATH] and item.get('solverName')==common.SOLVER and item.get('solverModule')==common.MODULE,'Exact flag/main census/native constructor required')
    contract={'statsPath':PATH,'stageName':'highDensityRouteSolver','countFields':['instances','contextsPruned'],'timeFields':[],'eligibleField':'instances','executedField':'contextsPruned','positiveSavedFields':['contextsPruned']}
    require(exact(item.get('coverageContract'),contract),'Two context-marker schema changed')
    require(item.get('sourceIsCurrentPrHead') is False and item.get('sourceBranch')=='codex/experiment-future-distance-pruning-20261029' and item.get('pr')==3199 and item.get('originPrLineageOnly')==3199 and item.get('publicationRole')=='standalone-refinement-not-current-pr-head','Standalone source role changed')
    q=item.get('sourceQualification') or {};text=q.get('evidenceText');require(isinstance(text,str) and hashlib.sha256(text.encode()).hexdigest()=='38e401f3fd12498eea15295f14ea15df59a623cd52b37bbd3d7b28b9cfdbec8f','Frozen source QA bytes changed')
    source=json.loads(text);require(source.get('localCommit')=='97a96dd226b1ccaf55ea63cbab0e821489244c4f' and source.get('tree')==TREE and source.get('nativeBaseline')==common.MAIN and source.get('sourceClean') is True,'Source QA belongs to different tree')
    require(q.get('status')=='PASS_ROOT_REVIEWED' and q.get('sourceTree')==TREE,'Source QA declaration differs')
    tests=source.get('validation') or {};require(tests.get('fullTypes') is True and tests.get('workerEsmDtsBuild') is True and tests.get('failures')==0 and tests.get('focusedAssertions')==143935,'Source QA incomplete')
    pub=item.get('publication') or {};require(pub.get('remoteSha')==SOURCE and pub.get('tree')==TREE and pub.get('qaSha256')==q.get('evidenceSha256')=='38e401f3fd12498eea15295f14ea15df59a623cd52b37bbd3d7b28b9cfdbec8f' and pub.get('reviewSha256')=='07d12ab1cf21b59bfda61eb4759b8d2e5934140dbf702e535945d680174f4986' and pub.get('branch')==item['sourceBranch'],'Source publication/review changed')
    require(hashlib.sha256((json.dumps(pub,indent=2)+'\n').encode()).hexdigest()=='5df338b032595ab9394b27afbe420e1a41366bcf11101b28b65e60b08e57b947','Full frozen source publication receipt changed')
    return m,a

def select_shard(m,dataset,index):
    require(type(index) is int,'Typed shard index required');row=next((x for x in m['shards'] if (x['dataset'],x['shardIndex'])==(dataset,index)),None);require(row is not None,'Outside sealed shard population');return row

def expected_cp(m,shard,ordinal,arm,run_id,controller):
    require(type(ordinal) is int and 0<=ordinal<len(shard['cases']) and arm in ['A','B'] and isinstance(run_id,str) and re.fullmatch(r'[1-9][0-9]*',run_id) and common.digest(controller),'Invalid selected attempt identity')
    case=shard['cases'][ordinal]
    return {'campaign':f"{CAMPAIGN}:{shard['dataset']}:shard-{shard['shardIndex']}:case-{case['sample']}:{case['order']}",'arm':arm,'algorithmSha':common.MAIN if arm=='A' else SOURCE,'dataset':shard['dataset'],'originalSample':case['sample'],'inputSha256':case['inputHash'],'observerSourceSha256':m['runtimeSourceHashes']['phase-checkpoint-observer.ts'],'executionOrder':case['order'],'githubRunId':run_id,'controllerSha':controller}

def metadata(m,shard,ordinal,arm,run_id,controller):
    case=shard['cases'][ordinal];cp=expected_cp(m,shard,ordinal,arm,run_id,controller)
    return {'campaign':cp['campaign'],'experiment':'future-distance-pruning','pr':3199,'dataset':shard['dataset'],'round':1,'pairIndex':1,'sampleNumber':case['sample'],'arm':arm,'executionOrder':case['order'],'requestedOptions':m['candidate']['options'] if arm=='B' else {'cacheProvider':None,'effort':1},'sha':cp['algorithmSha'],'expectedInputHash':case['inputHash'],'solverName':common.SOLVER,'shardIndex':shard['shardIndex'],'shardCount':shard['shardCount'],'ordinalWithinShard':ordinal,'runId':run_id,'controllerSha':controller}

def qualify(record,m,a,shard,ordinal,arm,run_id,controller):
    require(all(exact(record.get(k),v) for k,v in metadata(m,shard,ordinal,arm,run_id,controller).items()),'Record source/input/shard/order/ordinal identity differs')
    cp=obj(record.get('phaseCheckpointAudit'));last=obj(cp.get('lastDurableCheckpoint'));expected=expected_cp(m,shard,ordinal,arm,run_id,controller)
    require(cp.get('errors')==[] and all(v is not None and exact(last.get(k),v) for k,v in expected.items()),'Durable source/input/shard/order identity unbound')
    require(last.get('observedObjectPath')=='solver' and last.get('observedConstructorName')==common.SOLVER and last.get('actualCacheProviderState')=='disabled' and exact(last.get('observedRequestedOptions'),record['requestedOptions']),'Actual native constructor/options differ')
    # Select only the feature-specific post-timing census adapter; all native
    # source/output/runtime/clock checks in the shared qualifier stay exact.
    original_coverage=common.feature_coverage
    try:
        common.feature_coverage=coverage.coverage
        common.qualify_record(record,a,m['candidate'])
    finally:common.feature_coverage=original_coverage
    record['durableTimeoutSourceQualification']=common.timeout_checkpoint_qualification(record);record['nonterminalFeatureObservations']=coverage.nonterminal_observations(record,m['candidate']);return record

def summarize(records,shard):
    index={(r['sampleNumber'],r['arm']):r for r in records};pairs=[]
    for ordinal,case in enumerate(shard['cases']):
        if not all((case['sample'],arm) in index for arm in 'AB'):continue
        values={arm:index[case['sample'],arm] for arm in 'AB'};source=all(source_qualified(r) for r in values.values());hashes={arm:pair_helpers.output_hashes(r) for arm,r in values.items()};facts={arm:pair_helpers.nonclock_facts(r) for arm,r in values.items()}
        quality=all(r.get('strictIntegrityQualified') is True and common.physical_clean(r) for r in values.values()) and exact(hashes['A'],hashes['B']) and all(common.digest(x,64) for x in hashes['A'].values()) and exact(facts['A'],facts['B'])
        times={arm:r['official']['elapsedTimeMs']+r['official']['routingMetrics']['experimentAudit']['constructorTimeMs'] for arm,r in values.items()} if quality else None
        phases={arm:pair_helpers.intervals(r) for arm,r in values.items()};components={}
        for stage in ['initialHD','Joint']:
            for key in ['setupThroughNextSetupMs','nativeConstructorMs','setupThroughConstructedMs','runThroughNextSetupMs']:
                vv={arm:obj(phases[arm].get(stage)).get(key) for arm in 'AB'};components[stage+'.'+key]=vv if source and all(common.finite(x) for x in vv.values()) else None
        census=obj(values['B'].get('featureCoverage'));counts=obj(census.get('contextCounts'));classification='EXERCISED' if census.get('counterCensusFinal') is True and census.get('counterEvidenceComplete') is True and counts.get('contextsPruned',0)>0 else 'UNEXERCISED' if census.get('counterCensusFinal') is True and census.get('counterEvidenceComplete') is True and counts.get('contextsPruned')==0 else 'PARTIAL_OR_UNKNOWN'
        pairs.append({'sample':case['sample'],'ordinalWithinShard':ordinal,'order':case['order'],'sourceQualified':source,'wholeQualityQualified':quality,'wholeClockMs':times,'wholeBdivA':times['B']/times['A'] if times and times['A']>0 else None,'outputHashes':hashes,'nonclockFactsEqual':exact(facts['A'],facts['B']),'componentIntervalsMs':components,'actualCandidateContextCensus':census,'contextActivationClassification':classification,'outcomes':{arm:{k:obj(r.get('official')).get(k) for k in ['didSolve','didTimeout','relaxedDrcPassed']} for arm,r in values.items()}})
    chosen=[x for x in pairs if x['wholeQualityQualified']];component={}
    if pairs:
        for key in pairs[0]['componentIntervalsMs']:
            vv=[dict(p,value=p['componentIntervalsMs'][key]) for p in chosen];component[key]={'wholeQualityQualified':pair_helpers.clock_summary(vv,'value'),'wholeQualityQualifiedByOrder':{o:pair_helpers.clock_summary([p for p in vv if p['order']==o],'value') for o in ['AB','BA']},'completedIntervalsBeforeLaterFailure':sum(p['componentIntervalsMs'][key] is not None and not p['wholeQualityQualified'] for p in pairs)}
    expected={(x['sample'],arm) for x in shard['cases'] for arm in 'AB'}
    return {'campaign':CAMPAIGN,'shard':shard,'recordCount':len(records),'expectedRecords':len(expected),'populationComplete':len(records)==len(index)==len(expected) and set(index)==expected,'sourceQualifiedRecordCount':sum(source_qualified(r) for r in records),'strictRecordCount':sum(r.get('strictIntegrityQualified') is True for r in records),'pairs':pairs,'whole':pair_helpers.clock_summary(pairs,'wholeClockMs'),'wholeByOrder':{o:pair_helpers.clock_summary([p for p in pairs if p['order']==o],'wholeClockMs') for o in ['AB','BA']},'wholeQualityQualifiedComponentClocks':component,'priorBaselinesReused':False,'timingsPooledWithPriorCampaigns':False,'clockCorrectionApplied':False,'contextMarkersNotOperationTotals':True,'scope':'One prospectively assigned own fresh same-host pair per original case in this exact shard; full84 qualification requires all11 disjoint shard raw receipts.'}

def run(args,m,a):
    shard=select_shard(m,args.dataset,args.shard);output=args.output.resolve();require(not output.exists() or not any(output.iterdir()),'Fresh output required');item=m['candidate'];checkouts={'A':args.baseline.resolve(),'B':args.candidate.resolve()};common.verify_checkouts(a,item,checkouts);common.verify_dependencies(a,checkouts)
    identities={arm:common.pinned.read_identity(path,args.dataset) for arm,path in checkouts.items()};require(exact(identities['A'],identities['B']) and {str(x['sampleNumber']):x['inputHash'] for x in identities['A']}==a['expectedInputHashesByDataset'][args.dataset],'Complete original input population changed');identity={x['sampleNumber']:x for x in identities['A']}
    harnesses={arm:json.loads((path/'experiment-harness-provenance.json').read_text()) for arm,path in checkouts.items()}
    for arm,h in harnesses.items():require(h.get('checkoutSha')==(common.MAIN if arm=='A' else SOURCE) and h.get('validators')==a['expectedValidatorHashes'] and all(h.get(k)==v for k,v in a['expectedHarnessSourceHashes'].items()),'Native source/harness differs')
    comparison=common.pinned.compare_dependency_resolutions(harnesses);common.pinned.write_json(output/'provenance.json',{'manifest':m,'manifestSha256':sha(MANIFEST),'shard':shard,'fullOriginalPopulation':identities['A'],'selectedOriginalInputs':[identity[x['sample']] for x in shard['cases']],'harnesses':harnesses,'dependencyComparison':comparison,'githubRunId':os.environ.get('GITHUB_RUN_ID'),'controllerSha':os.environ.get('GITHUB_SHA'),'runAttempt':os.environ.get('GITHUB_RUN_ATTEMPT'),'fullUnionCases':42,'plannedFullUnionAttempts':84,'plannedFullUnionShards':11,'timingsPooledWithPriorCampaigns':False})
    records=[]
    for ordinal,case in enumerate(shard['cases']):
        require(identity[case['sample']]['inputHash']==case['inputHash'],'Selected original input changed')
        for arm in case['order']:
            meta=metadata(m,shard,ordinal,arm,os.environ.get('GITHUB_RUN_ID'),os.environ.get('GITHUB_SHA'));cp=expected_cp(m,shard,ordinal,arm,meta['runId'],meta['controllerSha']);config=dict(a['baseline'],evidencePaths=item['evidencePaths']) if arm=='A' else dict(item);config.update(phaseCheckpoint=cp,shardProvenance={'shard':shard,'ordinalWithinShard':ordinal,'originalSample':case['sample'],'order':case['order']});config_path=output/f"sample-{case['sample']:03d}"/f'config-{arm}.json';common.pinned.write_json(config_path,config);print(ACTIVE+json.dumps(meta),flush=True);target=output/f"sample-{case['sample']:03d}"/arm
            record=common.pinned.run_sample(checkouts[arm],config_path,target,args.dataset,case['sample'],360);record.update(meta,qualificationMode='full-original-population-shard',scenarioName=identity[case['sample']]['scenarioName']);common.declared.qualify_output(record,target,checkouts[arm],a,ROOT,common.pinned.execute_with_deadline);record['phaseCheckpointAudit']=common.checkpoint_audit(target/'raw',cp)
            try:qualify(record,m,a,shard,ordinal,arm,meta['runId'],meta['controllerSha'])
            except Exception as error:record['repeatQualificationError']=str(error);record['strictIntegrityQualified']=False;record['strictIntegrityIssues']=['Shard attempt qualification failed: '+str(error)]
            records.append(record);common.pinned.write_json(target/'audit-result.json',record)
            with (output/'results.jsonl').open('a') as stream:stream.write(json.dumps(record)+'\n')
            print(RESULT+json.dumps(record,separators=(',',':')),flush=True);common.pinned.write_json(output/'summary.json',summarize(records,shard))
    summary=summarize(records,shard);common.pinned.write_json(output/'summary.json',summary);print(SUMMARY+json.dumps(summary,separators=(',',':')),flush=True);require(summary['populationComplete'] and summary['sourceQualifiedRecordCount']==summary['expectedRecords'],'Shard source population unqualified; all attempts retained')

def parse_log(text,m,a,shard,run_id,controller):
    records=[];active=[];summaries=[]
    for line in text.splitlines():
        line=re.sub(r'^\ufeff?(?:\d{4}-\d{2}-\d{2}T\S+Z\s+)?','',line)
        for prefix,target in [(RESULT,records),(ACTIVE,active),(SUMMARY,summaries)]:
            if line.startswith(prefix):target.append(json.loads(line[len(prefix):]))
    selected=[(ordinal,arm) for ordinal,case in enumerate(shard['cases']) for arm in case['order']];expected=[metadata(m,shard,ordinal,arm,run_id,controller) for ordinal,arm in selected]
    require(len(records)==len(selected) and len(summaries)==1 and exact(active,expected),'Exact per-shard ordered arm/case/active population required')
    for record,(ordinal,arm) in zip(records,selected):
        replay=copy.deepcopy(record);qualify(replay,m,a,shard,ordinal,arm,run_id,controller);require(all(exact(replay.get(k),record.get(k)) for k in ['strictIntegrityQualified','strictIntegrityIssues','featureCoverage','durableTimeoutSourceQualification','nonterminalFeatureObservations']),'Retained qualification/census differs from recomputation')
    summary=summarize(records,shard);require(exact(summary,summaries[0]) and summary['populationComplete'] and summary['sourceQualifiedRecordCount']==summary['expectedRecords'],'Retained shard summary/source population unqualified')
    return {'schemaVersion':1,'campaign':CAMPAIGN,'runId':str(run_id),'controllerSha':controller,'shard':shard,'manifestSha256':sha(MANIFEST),'runtimeSha256':sha(Path(__file__)),'records':records,'summary':summary,'rawLogSha256':hashlib.sha256(text.encode()).hexdigest(),'sourceQualified':True,'requiresFullUnionRawReceiptCount':11,'timingsPooledWithPriorCampaigns':False}

def qualify_union(parsed,m,a,run_id,controller):
    require(len(parsed)==11,'All11 original shard populations required')
    by_key={};records=[];pairs=[]
    for value in parsed:
        shard=obj(value.get('shard'));key=(shard.get('dataset'),shard.get('shardIndex'));require(key not in by_key,'Duplicate shard population');by_key[key]=value
    expected={(s['dataset'],s['shardIndex']) for s in m['shards']};require(set(by_key)==expected,'Missing or foreign shard population')
    for shard in m['shards']:
        value=by_key[shard['dataset'],shard['shardIndex']]
        require(exact(value.get('shard'),shard) and value.get('runId')==str(run_id) and value.get('controllerSha')==controller and value.get('manifestSha256')==sha(MANIFEST) and value.get('runtimeSha256')==sha(Path(__file__)),'Foreign shard/source/controller authority')
        rows=value.get('records');selected=[(ordinal,arm) for ordinal,case in enumerate(shard['cases']) for arm in case['order']];require(isinstance(rows,list) and len(rows)==len(selected),'Incomplete per-shard attempt population')
        for row,(ordinal,arm) in zip(rows,selected):
            replay=copy.deepcopy(row);qualify(replay,m,a,shard,ordinal,arm,run_id,controller);require(all(exact(replay.get(k),row.get(k)) for k in ['strictIntegrityQualified','strictIntegrityIssues','featureCoverage','durableTimeoutSourceQualification','nonterminalFeatureObservations']),'Forged per-shard qualification')
        summary=summarize(rows,shard);require(exact(summary,value.get('summary')) and summary['populationComplete'] and summary['sourceQualifiedRecordCount']==summary['expectedRecords'],'Unqualified per-shard source population')
        records.extend(rows);pairs.extend(dict(pair,dataset=shard['dataset'],shardIndex=shard['shardIndex']) for pair in summary['pairs'])
    ids={(r['dataset'],r['sampleNumber'],r['arm']) for r in records};expected_ids={(d,n,arm) for d,count in [('srj18',16),('srj24',26)] for n in range(1,count+1) for arm in 'AB'};require(len(records)==len(ids)==84 and ids==expected_ids and len(pairs)==42,'Original full84 union differs')
    require({o:sum(p['order']==o for p in pairs) for o in ['AB','BA']}=={'AB':21,'BA':21},'Prospective full-union order balance differs')
    identity_sets={}
    for dataset in ['srj18','srj24']:
        kinds={}
        for kind,predicate in [('completed',lambda r:r.get('strictIntegrityQualified') is True and obj(r.get('official')).get('didSolve') is True),('reference',common.reference_clean),('physical',common.physical_clean)]:
            arms={arm:[r['sampleNumber'] for r in records if r['dataset']==dataset and r['arm']==arm and predicate(r)] for arm in 'AB'};kinds[kind]={arm:sorted(arms[arm]) for arm in 'AB'};kinds[kind].update(gained=sorted(set(arms['B'])-set(arms['A'])),lost=sorted(set(arms['A'])-set(arms['B'])))
        identity_sets[dataset]=kinds
    return {'schemaVersion':1,'campaign':CAMPAIGN,'runId':str(run_id),'controllerSha':controller,'manifestSha256':sha(MANIFEST),'recordCount':84,'originalCaseCount':42,'shardCount':11,'orderCounts':{'AB':21,'BA':21},'sourceQualifiedLogUnion':True,'originalServerZipProofRequired':True,'requiredIndependentRawReceipts':11,'rawByteQualificationClaim':False,'strictRecordCount':sum(r['strictIntegrityQualified'] is True for r in records),'separatelyCheckpointProvenTimeoutCount':sum(obj(r.get('durableTimeoutSourceQualification')).get('sourceAndInputProvenByBoundedCheckpoints') is True for r in records),'identitySets':identity_sets,'pairs':pairs,'contextCaseIdsByActivation':{label:[{'dataset':p['dataset'],'sample':p['sample']} for p in pairs if p['contextActivationClassification']==label] for label in ['EXERCISED','UNEXERCISED','PARTIAL_OR_UNKNOWN']},'whole':pair_helpers.clock_summary(pairs,'wholeClockMs'),'wholeByOrder':{o:pair_helpers.clock_summary([p for p in pairs if p['order']==o],'wholeClockMs') for o in ['AB','BA']},'timingsPooledWithPriorCampaigns':False,'clockCorrectionApplied':False,'scope':'Complete authenticated-log population replay only; final independent analysis additionally requires11 exact original-serverZIP/source/producer/member proof receipts, with no prior336 orrepeat16 clocks pooled.'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--mode',choices=['plan','select','verify-checkouts','verify-dependencies','run','parse','union'],required=True);p.add_argument('--baseline',type=Path);p.add_argument('--candidate',type=Path);p.add_argument('--dataset',choices=['srj18','srj24']);p.add_argument('--shard',type=int);p.add_argument('--output',type=Path);p.add_argument('--job-log',type=Path);p.add_argument('--parsed',action='append',type=Path,default=[]);p.add_argument('--run-id');p.add_argument('--controller-sha');args=p.parse_args();m,a=validate()
    if os.environ.get('GITHUB_ACTIONS')=='true':require(os.environ.get('GITHUB_EVENT_NAME')=='push' and os.environ.get('GITHUB_REF_NAME')==common.BRANCH and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','Only first reviewed controller branch push attempt may run')
    if args.mode=='plan':common.outputs({'matrix':json.dumps({'include':[{'dataset':s['dataset'],'shard':s['shardIndex']} for s in m['shards']]},separators=(',',':'))});return
    if args.mode=='union':require(not args.output.exists(),'Never overwrite union replay');common.pinned.write_json(args.output,qualify_union([json.loads(p.read_text()) for p in args.parsed],m,a,args.run_id,args.controller_sha));return
    shard=select_shard(m,args.dataset,args.shard)
    if args.mode=='select':common.outputs({'baseline_sha':common.MAIN,'candidate_sha':SOURCE,'harness_sha':common.MAIN})
    elif args.mode=='verify-checkouts':common.verify_checkouts(a,m['candidate'],{'A':args.baseline.resolve(),'B':args.candidate.resolve()})
    elif args.mode=='verify-dependencies':common.verify_dependencies(a,{'A':args.baseline.resolve(),'B':args.candidate.resolve()})
    elif args.mode=='parse':require(not args.output.exists(),'Never overwrite parsed shard records');common.pinned.write_json(args.output,parse_log(args.job_log.read_text(),m,a,shard,args.run_id,args.controller_sha))
    else:run(args,m,a)

if __name__=='__main__':main()
