#!/usr/bin/env python3
"""Two prospectively selected development cases, four fresh native/candidate attempts."""
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
MANIFEST=ROOT/'layer-aware-mst-stable4-20261030.json'
AUTHORITY=ROOT/'bottleneck-experiments-20261029.json'
WORKFLOW=ROOT.parent.parent/'.github/workflows/layer-aware-mst-stable4-20261030.yml'
CAMPAIGN='layer-aware-mst-stable4-20261030'
SOURCE='087075c2dbb9a96e1d1a1a5a2eb43b5f8b2326d2'
TREE='319fde34548c761746444080560f3412ed63affd'
FLAG='experimentLayerAwareMstIdentity'
PATH='netToPointPairsSolver.layerAwareMstStats'
RESULT='LAYER_AWARE_MST_STABLE_SHARD_RESULT_JSON '
ACTIVE='LAYER_AWARE_MST_STABLE_SHARD_ACTIVE_JSON '
SUMMARY='LAYER_AWARE_MST_STABLE_SHARD_SUMMARY_JSON '
BRANCH='codex/layer-aware-mst-stable4-controller-20261030'
SOURCE_LOCAL='d0bd6ff2795ebd7f59eaf16a0f9bfb63c0b200dd'
QA_SHA='633de81abbdcbebd4387d0819736606f4d057fd7e422e5c0f7a7fa5d04dd349f'
REVIEW_SHA='1ce40d4157a61b76e2b1c81945dce26c3842ca7e489d3f324c7f77319a429aad'
PUBLICATION_SHA='cdf56921fd56eb88d034aa4154c9b2eccc9b84d3552e6511b27276682f3cbe43'
NEW_ASSETS={'layer-aware-mst-transition-audit.py','tests/layer-aware-mst-transition-audit-integrity.py','tests/layer-aware-mst-stable4-raw-binding-integrity.py','run-layer-aware-mst-stable4.py','seal-layer-aware-mst-stable4.py','layer-aware-mst-coverage.py','layer-aware-mst-stable-artifact-carrier.py','layer-aware-mst-stable4-raw-proof.py','tests/layer-aware-mst-stable4-integrity.py','tests/layer-aware-mst-coverage-integrity.py','tests/layer-aware-mst-stable-artifact-carrier-integrity.py','run-scratch-repeat.py','pruning-context-coverage.py','layer-aware-mst-case8-terminal-requirements.json','layer-aware-mst-stable-source-qa.json','layer-aware-mst-stable-source-review.json','layer-aware-mst-stable-source-publication.json','layer-aware-mst-stable4-prior84-independent-review.json','tests/layer-aware-mst84-integrity.py'}


def load(name,filename):
    s=importlib.util.spec_from_file_location(name,ROOT/filename);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

pair_helpers=load('immutable_pair_evidence_helpers','run-scratch-repeat.py')
common=pair_helpers.common
coverage=load('actual_mst_logical_census','layer-aware-mst-coverage.py')
transitions=load('actual_mst_structural_transitions','layer-aware-mst-transition-audit.py')
require,exact,sha=common.require,common.exact,common.sha
obj=pair_helpers.obj
source_qualified=pair_helpers.source_qualified

def assets():return set(common.ASSETS)|NEW_ASSETS

def derived_shards(authority):
    return [{'dataset':dataset,'shardIndex':0,'shardCount':1,'cases':[{'sample':sample,'inputHash':authority['expectedInputHashesByDataset'][dataset][str(sample)],'order':order}]}for dataset,sample,order in [('srj18',11,'AB'),('srj24',8,'BA')]]

def estimator_policy():
    return {'primaryTarget':'Targeted development check of stable MST requirement identities: remove the observed srj18:11 foreign-copper regression while preserving all six explicit srj24:8 manufactured SMT bridges.',
        'qualityCohort':'Each arm independently source/input/runtime/budget bound with original-owner seven copper predicates, full supplemental reports, and unchanged scoped grade. This is not universal via-in-pad clearance or electrical PASS; case24:8 attribution additionally needs six independent raw/canonical structural manufactured bridges outside its original SMT pads.',
        'wholeClock':'Descriptive constructorTimeMs plus official elapsedTimeMs from the same fresh paired host, only when both arms individually meet the inherited scoped physical grade. No population speed claim from two known development cases.',
        'reports':['all four original outcomes including every failure/timeout/UNKNOWN','per-arm complete finding classes and output/point-pair/native-work changes','source-bound completed MST ledger distinct from emitted logical requirements and manufactured geometry','case24:8 six original layer-specific IDs and explicit bridge witnesses'],
        'targetedScope':'Only srj18:11AB and srj24:8BA, declared before any stable-candidate outcome. No full42-case/no-regression/general-speed claim; all earlier baselines and clocks remain separate.',
        'scheduling':'Two separate Blacksmith8vCPUARM hosts, one fresh e703 baseline and stable candidate per selected case, opposite fixed AB/BA orders, unchanged360s solve after constructor/480s outer guard/one thread/effort1.',
        'fullUnion':'Exactly these two original case identities and four attempts, two original serverZIPs independently approved. Prior full84 independent proof is a prerequisite and is never reused as a fresh baseline or an outcome of this new source.'}

def validate():
    m=json.loads(MANIFEST.read_text());a=common.validate_manifest(AUTHORITY)
    require(sha(ROOT/'layer-aware-mst-stable4-prior84-independent-review.json')=='2d0305a72997d0cda3809245ea9dd293e847f11adc3f9467aad53c613d06a2c6','Original full84 independent raw prerequisite changed')
    require(m.get('campaign')==CAMPAIGN and m.get('repository')=='tscircuit/tscircuit-autorouter' and m.get('controllerBranch')==BRANCH,'Wrong semantic MST campaign/branch')
    require(exact(m.get('shards'),derived_shards(a)),'Prospective two targeted cases/orders changed')
    require(type(m.get('plannedJobs'))is int and m['plannedJobs']==2 and type(m.get('plannedAttempts'))is int and m['plannedAttempts']==4,'Exactly two jobs/four targeted attempts required')
    require(m.get('caseCounts')=={'srj18':1,'srj24':1} and m.get('orderCounts')=={'AB':1,'BA':1},'Exact original case/order counts required')
    require(exact(m.get('fullOriginalInputPopulationHashes'),a['expectedInputHashesByDataset'])and m.get('selectedBeforeCandidateOutcomes')is True and m.get('fullCorpusClaim')is False,'Original input/targeted-only study scope changed')
    require(m.get('baselineSha')==common.MAIN and m.get('authoritySha256')==sha(AUTHORITY)and m.get('workflowSha256')==sha(WORKFLOW),'Frozen native authority/workflow changed')
    require(m.get('inheritedControllerLocal')=='5a8762d51ab4082f86cb6485619a49647df4bbce'and m.get('inheritedControllerTree')=='03f9bde76aba4147502b63ac5d87a0df85162b1f'and m.get('expectedRemoteParent')=='fd28c1325f48efaba0f4189e432777be7dd51d6d','Additive source parent changed')
    require(set(m.get('runtimeSourceHashes',{}))==assets()and all(sha(ROOT/name)==value for name,value in m['runtimeSourceHashes'].items()),'Exact semantic controller/helper bytes changed')
    require(m.get('runSampleSourceSha256')==hashlib.sha256(inspect.getsource(common.pinned.run_sample).encode()).hexdigest(),'Original native process routine changed')
    require(m.get('freshProcessPerAttempt')is True and m.get('cpuProfiling')is False and m.get('correctedClocks')is False and m.get('timingsPooledWithPriorCampaigns')is False and m.get('originalServerZipRawProofRequired')is True,'Fresh process/raw/clock policy changed')
    require(m.get('sampleTimeoutSeconds')==360 and m.get('externalControllerGuardSeconds')==480 and all(type(m.get(k))is int and m[k]==1 for k in ['threads','concurrency','effort']),'Native budget/runtime changed')
    require(exact(m.get('estimators'),estimator_policy()) and m.get('changedGeometryAndWorkAllowed')is True and m.get('crossArmParityRequired')is False,'Prospective semantic estimator policy changed')
    item=m.get('candidate',{});require(item.get('id')=='layer-aware-mst-stable'and item.get('candidateSha')==SOURCE and item.get('candidateTree')==TREE and item.get('option')==FLAG,'Wrong qualified MST source')
    require(exact(item.get('options'),{'cacheProvider':None,'effort':1,FLAG:True})and item.get('evidencePaths')==[PATH]and item.get('solverName')==common.SOLVER and item.get('solverModule')==common.MODULE and exact(item.get('coverageContract'),coverage.contract()),'Exact MST option/native constructor/ledger contract required')
    require(SOURCE!='0'*40 and TREE!='1'*40 and SOURCE_LOCAL!='5'*40,'Unpublished draft source may not run')
    for name,value in [('layer-aware-mst-stable-source-qa.json',QA_SHA),('layer-aware-mst-stable-source-review.json',REVIEW_SHA),('layer-aware-mst-stable-source-publication.json',PUBLICATION_SHA)]:require(sha(ROOT/name)==value,'Frozen source QA/review/publication bytes changed')
    q=json.loads((ROOT/'layer-aware-mst-stable-source-qa.json').read_text());pub=json.loads((ROOT/'layer-aware-mst-stable-source-publication.json').read_text())
    require(q.get('tree')==TREE and q.get('localCommit')==SOURCE_LOCAL,'Source QA tree/local commit differs')
    require(pub.get('remoteCommit')==SOURCE and pub.get('tree')==TREE and obj(pub.get('qa')).get('sha256')==QA_SHA and obj(pub.get('peer')).get('sha256')==REVIEW_SHA and pub.get('remoteCommitTreeSingleParentAndBranchGetVerified')is True and pub.get('readyForFreshTargetedSemantic4')is True,'Root published source provenance differs')
    require(pub.get('singleRemoteParent')=='5d5500e3da02a7b1ed3eec74fc262f31c04f47df','Stable MST source must retain the exact independently published MST parent')
    return m,a

def select_shard(m,dataset,index):
    require(type(index) is int,'Typed shard index required');row=next((x for x in m['shards'] if (x['dataset'],x['shardIndex'])==(dataset,index)),None);require(row is not None,'Outside sealed shard population');return row

def expected_cp(m,shard,ordinal,arm,run_id,controller):
    require(type(ordinal) is int and 0<=ordinal<len(shard['cases']) and arm in ['A','B'] and isinstance(run_id,str) and re.fullmatch(r'[1-9][0-9]*',run_id) and common.digest(controller),'Invalid selected attempt identity')
    case=shard['cases'][ordinal]
    return {'campaign':f"{CAMPAIGN}:{shard['dataset']}:shard-{shard['shardIndex']}:case-{case['sample']}:{case['order']}",'arm':arm,'algorithmSha':common.MAIN if arm=='A' else SOURCE,'dataset':shard['dataset'],'originalSample':case['sample'],'inputSha256':case['inputHash'],'observerSourceSha256':m['runtimeSourceHashes']['phase-checkpoint-observer.ts'],'executionOrder':case['order'],'githubRunId':run_id,'controllerSha':controller}

def metadata(m,shard,ordinal,arm,run_id,controller):
    case=shard['cases'][ordinal];cp=expected_cp(m,shard,ordinal,arm,run_id,controller)
    return {'campaign':cp['campaign'],'experiment':'layer-aware-mst-stable','dataset':shard['dataset'],'round':1,'pairIndex':1,'sampleNumber':case['sample'],'arm':arm,'executionOrder':case['order'],'requestedOptions':m['candidate']['options']if arm=='B'else{'cacheProvider':None,'effort':1},'sha':cp['algorithmSha'],'expectedInputHash':case['inputHash'],'solverName':common.SOLVER,'shardIndex':shard['shardIndex'],'shardCount':shard['shardCount'],'ordinalWithinShard':ordinal,'runId':run_id,'controllerSha':controller}

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
    record['strictIntegrityIssues'].extend(record['featureCoverage']['issues']);record['strictIntegrityQualified']=not record['strictIntegrityIssues'];record['durableTimeoutSourceQualification']=common.timeout_checkpoint_qualification(record);record['nonterminalFeatureObservations']=coverage.nonterminal_observations(record,m['candidate']);return record

def summarize(records,shard):
    index={(r['sampleNumber'],r['arm']):r for r in records};pairs=[]
    for ordinal,case in enumerate(shard['cases']):
        if not all((case['sample'],arm)in index for arm in 'AB'):continue
        values={arm:index[case['sample'],arm]for arm in 'AB'};source=all(source_qualified(r)for r in values.values());hashes={arm:pair_helpers.output_hashes(r)for arm,r in values.items()}
        physical={arm:common.physical_clean(row)for arm,row in values.items()};quality=source and all(physical.values())
        times={arm:row['official']['elapsedTimeMs']+row['official']['routingMetrics']['experimentAudit']['constructorTimeMs']for arm,row in values.items()}if quality else None
        pairs.append({'sample':case['sample'],'ordinalWithinShard':ordinal,'order':case['order'],'sourceQualified':source,'wholeQualityQualified':quality,'wholeClockMs':times,'wholeBdivA':times['B']/times['A']if times and times['A']>0 else None,'perArmPhysicalClean':physical,'outputHashes':hashes,'crossArmOutputHashEquality':{key:hashes['A'][key]==hashes['B'][key]for key in hashes['A']},'crossArmParityIsRequired':False,'candidateMstLedger':values['B'].get('featureCoverage'),'perArmPointPairRequirementAudit':{arm:row.get('pointPairRequirementAudit')for arm,row in values.items()},'perArmRawTransitionAudit':{arm:row.get('rawTransitionAudit')for arm,row in values.items()},'perArmTargetedStructuralRecoveryEvidence':{arm:source_qualified(row)and physical[arm]and obj(row.get('pointPairRequirementAudit')).get('status')=='COVERED_LOGICAL_REQUIREMENTS'and obj(obj(row.get('rawTransitionAudit')).get('targetSMTTransitionWitness')).get('status')=='PROVEN_STRUCTURAL'for arm,row in values.items()},'scopedSevenGradeIsNotElectricalPass':True,'perArmStageIntervals':{arm:pair_helpers.intervals(row)for arm,row in values.items()},'outcomes':{arm:{key:obj(row.get('official')).get(key)for key in ['didSolve','didTimeout','relaxedDrcPassed']}for arm,row in values.items()}})
    expected={(case['sample'],arm)for case in shard['cases']for arm in 'AB'}
    return {'campaign':CAMPAIGN,'shard':shard,'recordCount':len(records),'expectedRecords':len(expected),'populationComplete':len(records)==len(index)==len(expected)and set(index)==expected,'sourceQualifiedRecordCount':sum(source_qualified(row)for row in records),'strictRecordCount':sum(row.get('strictIntegrityQualified')is True for row in records),'pairs':pairs,'whole':pair_helpers.clock_summary(pairs,'wholeClockMs'),'wholeByOrder':{o:pair_helpers.clock_summary([p for p in pairs if p['order']==o],'wholeClockMs')for o in ['AB','BA']},'priorBaselinesReused':False,'timingsPooledWithPriorCampaigns':False,'clockCorrectionApplied':False,'crossArmOutputOrNativeWorkParityRequired':False,'logicalMechanismIsNotElectricalPass':True,'scopedSevenGradeIsNotElectricalPass':True,'scope':'One fresh paired attempt on a predeclared development case. All outcomes remain retained; both targeted original serverZIP proofs required, with no full42-case claim.'}


def audit_pointpairs(record,raw):
    try:return audit_pointpairs_contents(record,raw)
    except (OSError,ValueError,TypeError,KeyError,AttributeError,IndexError)as error:
        return {'status':'UNKNOWN_RETAINED_POINT_PAIR_CONTEXT_UNREADABLE','reason':str(error)[:384],'electricalPass':'UNPROVEN','completedMstLedgerPreservedSeparately':True,'requiresOriginalServerZipReplay':True}

def audit_pointpairs_contents(record,raw):
    if(record.get('dataset'),record.get('sampleNumber'))!=('srj24',8):return {'status':'NOT_TARGETED_CASE','electricalPass':'UNPROVEN','requiresOriginalServerZipReplay':True}
    original,pairs=raw/'original-input.json',raw/'point-pair-context.json'
    if original.exists()and sha(original)!=record.get('expectedInputHash'):return {'status':'UNKNOWN_RETAINED_ORIGINAL_INPUT_HASH_MISMATCH','electricalPass':'UNPROVEN','sourceIntegrityFailure':False,'completedMstLedgerPreservedSeparately':True,'requiresOriginalServerZipReplay':True}
    if not original.exists()or not pairs.exists():return {'status':'UNKNOWN_MISSING_RETAINED_POINT_PAIR_CONTEXT','electricalPass':'UNPROVEN','completedMstLedgerPreservedSeparately':True,'requiresOriginalServerZipReplay':True}
    result=coverage.audit_case8(json.loads(original.read_text()),json.loads(pairs.read_text()),json.loads((ROOT/'layer-aware-mst-case8-terminal-requirements.json').read_text()))
    result.update(originalInputSha256=sha(original),pointPairContextSha256=sha(pairs),requiresOriginalServerZipReplay=True)
    return result

def audit_transitions(record,raw):
    try:
        if(raw/'original-input.json').exists()and sha(raw/'original-input.json')!=record.get('expectedInputHash'):return {'status':'UNKNOWN_RETAINED_ORIGINAL_INPUT_HASH_MISMATCH','electricalPass':'UNPROVEN','sourceIntegrityFailure':False,'completedMstLedgerPreservedSeparately':True,'requiresOriginalServerZipReplay':True}
        names=['original-input.json','point-pair-context.json','raw-new-traces.json','canonical-circuit-json.json','declared-intent-via-pad.json']
        if not all((raw/name).exists()for name in names):return {'status':'UNKNOWN_MISSING_RETAINED_TRANSITION_CONTEXT','electricalPass':'UNPROVEN','sourceIntegrityFailure':False,'requiresOriginalServerZipReplay':True}
        values=[json.loads((raw/name).read_text())for name in names]
        result=transitions.audit(*values,json.loads((ROOT/'layer-aware-mst-case8-terminal-requirements.json').read_text()),target_case=(record.get('dataset'),record.get('sampleNumber'))==('srj24',8))
        result.update(rawContextSha256={name:sha(raw/name)for name in names},requiresOriginalServerZipReplay=True)
        return result
    except(OSError,ValueError,TypeError,KeyError,AttributeError,IndexError)as error:
        return {'status':'UNKNOWN_RETAINED_TRANSITION_CONTEXT_UNREADABLE','reason':str(error)[:384],'electricalPass':'UNPROVEN','sourceIntegrityFailure':False,'requiresOriginalServerZipReplay':True}

def run(args,m,a):
    shard=select_shard(m,args.dataset,args.shard);output=args.output.resolve();require(not output.exists() or not any(output.iterdir()),'Fresh output required');item=m['candidate'];checkouts={'A':args.baseline.resolve(),'B':args.candidate.resolve()};common.verify_checkouts(a,item,checkouts);common.verify_dependencies(a,checkouts)
    identities={arm:common.pinned.read_identity(path,args.dataset) for arm,path in checkouts.items()};require(exact(identities['A'],identities['B']) and {str(x['sampleNumber']):x['inputHash'] for x in identities['A']}==a['expectedInputHashesByDataset'][args.dataset],'Complete original input population changed');identity={x['sampleNumber']:x for x in identities['A']}
    harnesses={arm:json.loads((path/'experiment-harness-provenance.json').read_text()) for arm,path in checkouts.items()}
    for arm,h in harnesses.items():require(h.get('checkoutSha')==(common.MAIN if arm=='A' else SOURCE) and h.get('validators')==a['expectedValidatorHashes'] and all(h.get(k)==v for k,v in a['expectedHarnessSourceHashes'].items()),'Native source/harness differs')
    comparison=common.pinned.compare_dependency_resolutions(harnesses);common.pinned.write_json(output/'provenance.json',{'manifest':m,'manifestSha256':sha(MANIFEST),'shard':shard,'fullOriginalPopulation':identities['A'],'selectedOriginalInputs':[identity[x['sample']] for x in shard['cases']],'harnesses':harnesses,'dependencyComparison':comparison,'githubRunId':os.environ.get('GITHUB_RUN_ID'),'controllerSha':os.environ.get('GITHUB_SHA'),'runAttempt':os.environ.get('GITHUB_RUN_ATTEMPT'),'targetedOriginalCases':2,'plannedTargetedAttempts':4,'plannedTargetedShards':2,'fullCorpusClaim':False,'timingsPooledWithPriorCampaigns':False})
    records=[]
    for ordinal,case in enumerate(shard['cases']):
        require(identity[case['sample']]['inputHash']==case['inputHash'],'Selected original input changed')
        for arm in case['order']:
            meta=metadata(m,shard,ordinal,arm,os.environ.get('GITHUB_RUN_ID'),os.environ.get('GITHUB_SHA'));cp=expected_cp(m,shard,ordinal,arm,meta['runId'],meta['controllerSha']);config=dict(a['baseline'],evidencePaths=item['evidencePaths']) if arm=='A' else dict(item);config.update(phaseCheckpoint=cp,shardProvenance={'shard':shard,'ordinalWithinShard':ordinal,'originalSample':case['sample'],'order':case['order']});config_path=output/f"sample-{case['sample']:03d}"/f'config-{arm}.json';common.pinned.write_json(config_path,config);print(ACTIVE+json.dumps(meta),flush=True);target=output/f"sample-{case['sample']:03d}"/arm
            record=common.pinned.run_sample(checkouts[arm],config_path,target,args.dataset,case['sample'],360);record.update(meta,qualificationMode='prospective-targeted-development-pair',scenarioName=identity[case['sample']]['scenarioName']);common.declared.qualify_output(record,target,checkouts[arm],a,ROOT,common.pinned.execute_with_deadline);record['phaseCheckpointAudit']=common.checkpoint_audit(target/'raw',cp);record['pointPairRequirementAudit']=audit_pointpairs(record,target/'raw');record['rawTransitionAudit']=audit_transitions(record,target/'raw')
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
    return {'schemaVersion':1,'campaign':CAMPAIGN,'runId':str(run_id),'controllerSha':controller,'shard':shard,'manifestSha256':sha(MANIFEST),'runtimeSha256':sha(Path(__file__)),'records':records,'summary':summary,'rawLogSha256':hashlib.sha256(text.encode()).hexdigest(),'sourceQualified':True,'requiresFullUnionRawReceiptCount':2,'timingsPooledWithPriorCampaigns':False}

def qualify_union(parsed,m,a,run_id,controller):
    require(len(parsed)==2,'Both targeted original shard populations required')
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
    ids={(r['dataset'],r['sampleNumber'],r['arm']) for r in records};expected_ids={(shard['dataset'],case['sample'],arm)for shard in m['shards']for case in shard['cases']for arm in 'AB'};require(len(records)==len(ids)==4 and ids==expected_ids and len(pairs)==2,'Targeted four-attempt union differs')
    require({o:sum(p['order']==o for p in pairs) for o in ['AB','BA']}=={'AB':1,'BA':1},'Prospective full-union order balance differs')
    identity_sets={}
    for dataset in ['srj18','srj24']:
        kinds={}
        for kind,predicate in [('completed',lambda r:r.get('strictIntegrityQualified') is True and obj(r.get('official')).get('didSolve') is True),('reference',common.reference_clean),('physical',common.physical_clean)]:
            arms={arm:[r['sampleNumber'] for r in records if r['dataset']==dataset and r['arm']==arm and predicate(r)] for arm in 'AB'};kinds[kind]={arm:sorted(arms[arm]) for arm in 'AB'};kinds[kind].update(gained=sorted(set(arms['B'])-set(arms['A'])),lost=sorted(set(arms['A'])-set(arms['B'])))
        identity_sets[dataset]=kinds
    return {'schemaVersion':1,'campaign':CAMPAIGN,'runId':str(run_id),'controllerSha':controller,'manifestSha256':sha(MANIFEST),'recordCount':4,'originalCaseCount':2,'shardCount':2,'orderCounts':{'AB':1,'BA':1},'sourceQualifiedLogUnion':True,'originalServerZipProofRequired':True,'requiredIndependentRawReceipts':2,'rawByteQualificationClaim':False,'fullCorpusClaim':False,'strictRecordCount':sum(r['strictIntegrityQualified'] is True for r in records),'separatelyCheckpointProvenTimeoutCount':sum(obj(r.get('durableTimeoutSourceQualification')).get('sourceAndInputProvenByBoundedCheckpoints') is True for r in records),'identitySets':identity_sets,'pairs':pairs,'candidateMstLogicalCoverageCases':[{'dataset':p['dataset'],'sample':p['sample'],'coverage':p['candidateMstLedger']}for p in pairs],'whole':pair_helpers.clock_summary(pairs,'wholeClockMs'),'wholeByOrder':{o:pair_helpers.clock_summary([p for p in pairs if p['order']==o],'wholeClockMs') for o in ['AB','BA']},'timingsPooledWithPriorCampaigns':False,'clockCorrectionApplied':False,'scope':'Complete targeted four-attempt log replay only; both independent original-serverZIP proofs still required. No full42-case/general-no-regression claim or prior clock pooling.'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--mode',choices=['plan','select','verify-checkouts','verify-dependencies','run','parse','union'],required=True);p.add_argument('--baseline',type=Path);p.add_argument('--candidate',type=Path);p.add_argument('--dataset',choices=['srj18','srj24']);p.add_argument('--shard',type=int);p.add_argument('--output',type=Path);p.add_argument('--job-log',type=Path);p.add_argument('--parsed',action='append',type=Path,default=[]);p.add_argument('--run-id');p.add_argument('--controller-sha');args=p.parse_args();m,a=validate()
    if os.environ.get('GITHUB_ACTIONS')=='true':require(os.environ.get('GITHUB_EVENT_NAME')=='push' and os.environ.get('GITHUB_REF_NAME')==BRANCH and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','Only first reviewed controller branch push attempt may run')
    if args.mode=='plan':common.outputs({'matrix':json.dumps({'include':[{'dataset':s['dataset'],'shard':s['shardIndex']} for s in m['shards']]},separators=(',',':'))});return
    if args.mode=='union':require(not args.output.exists(),'Never overwrite union replay');common.pinned.write_json(args.output,qualify_union([json.loads(p.read_text()) for p in args.parsed],m,a,args.run_id,args.controller_sha));return
    shard=select_shard(m,args.dataset,args.shard)
    if args.mode=='select':common.outputs({'baseline_sha':common.MAIN,'candidate_sha':SOURCE,'harness_sha':common.MAIN})
    elif args.mode=='verify-checkouts':common.verify_checkouts(a,m['candidate'],{'A':args.baseline.resolve(),'B':args.candidate.resolve()})
    elif args.mode=='verify-dependencies':common.verify_dependencies(a,{'A':args.baseline.resolve(),'B':args.candidate.resolve()})
    elif args.mode=='parse':require(not args.output.exists(),'Never overwrite parsed shard records');common.pinned.write_json(args.output,parse_log(args.job_log.read_text(),m,a,shard,args.run_id,args.controller_sha))
    else:run(args,m,a)

if __name__=='__main__':main()
