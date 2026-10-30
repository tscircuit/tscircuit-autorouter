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
MANIFEST=ROOT/'mst-relative-v4-84-20261030.json'
AUTHORITY=ROOT/'bottleneck-experiments-20261029.json'
WORKFLOW=ROOT.parent.parent/'.github/workflows/mst-relative-v4-84-20261030.yml'
CAMPAIGN='mst-relative-v4-84-20261030'
SOURCE='2d4ab738b6c3d50bc5d3073d8523cabedef8ae54'
TREE='1c8c555d2fccef02ef02d454efe6fbac9fb399bb'
FLAG='experimentLayerAwareMstIdentity'
RELATIVE_FLAG='experimentRelativeWitnessRepair'
RELATIVE_QUAL='relativeWitnessRepairSolver.qualification'
RELATIVE_STATS='relativeWitnessRepairSolver.stats'
RELATIVE_PROOF='relativeWitnessRepairSolver.relativeProof'
PATH='netToPointPairsSolver.layerAwareMstStats'
EVIDENCE_PATHS=[PATH,RELATIVE_QUAL,RELATIVE_STATS,RELATIVE_PROOF]
RESULT='MST_RELATIVE_V4_SHARD_RESULT_JSON '
ACTIVE='MST_RELATIVE_V4_SHARD_ACTIVE_JSON '
SUMMARY='MST_RELATIVE_V4_SHARD_SUMMARY_JSON '
BRANCH='codex/mst-relative-v4-84-controller-20261030'
SOURCE_LOCAL='cb6e176c7bb2a00605bd09c0b67629d1ec4e4dc3'
QA_SHA='ef5801be5ed731cf656616d8bb361fb9af37cbab6f8399c3b5060cc6ba9ba4e5'
REVIEW_SHA='9d5854c4e602337c63deb29e88678b2bfa4ce9c2b81fd7fa52e5a91d1c3441ac'
PUBLICATION_SHA='a09da769e944c0ab64afc6a6817d97b7489864f7723cc737812f173fa42be13c'
SOURCE_PARENTS=['5d5500e3da02a7b1ed3eec74fc262f31c04f47df','f5d60ecabaf3850758f392f26c86dc450b986fc6']
STAGE18_GATE_SHA='430fe49abec222cd5a8895cda69cf95c64d34e74df5e1f758bc730a23497d587'
STAGE18_RAW_SHA='abe194aa21d0454b9da2b763e0a85c8e7cb8d77b7ccc10a1fe0fbb653aa7dc9a'
STAGE18_PEER_SHA='a0cde55d85a718e8c4b94f0bf0926fa1ec92dde5e2475f26dbd11ed5bdb18d18'
PLAN_SHA='2c49b68072c1fe87c63918910d934769f4a8868db55466f554b305b5b3324a50'
NEW_ASSETS={'tests/mst-relative-v4-source-publication-integrity.py','mst-relative-v4-launch-gate.py','mst-relative-v4-original-mst-source-inventory.json','tests/mst-relative-v4-launch-gate-integrity.py','mst-relative-v4-coverage.py','tests/mst-relative-v4-coverage-integrity.py','tests/mst-relative-v4-observer-integrity.ts','mst-relative-v4-18-stage-gate.json','mst-relative-v4-18-stage-qualification.json','mst-relative-v4-18-stage-independent-review.json','layer-aware-mst-transition-audit.py','tests/layer-aware-mst-transition-audit-integrity.py','tests/mst-relative-v4-84-raw-binding-integrity.py','run-mst-relative-v4-84.py','seal-mst-relative-v4-84.py','layer-aware-mst-coverage.py','mst-relative-v4-artifact-carrier.py','mst-relative-v4-84-raw-proof.py','tests/mst-relative-v4-84-integrity.py','tests/layer-aware-mst-coverage-integrity.py','tests/mst-relative-v4-artifact-carrier-integrity.py','run-scratch-repeat.py','pruning-context-coverage.py','layer-aware-mst-prior-lpt-plan.json','layer-aware-mst-prior-lpt-review.json','layer-aware-mst-case8-terminal-requirements.json','mst-relative-v4-source-qa.json','mst-relative-v4-source-review.json','mst-relative-v4-source-publication.json'}


def load(name,filename):
    s=importlib.util.spec_from_file_location(name,ROOT/filename);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

pair_helpers=load('immutable_pair_evidence_helpers','run-scratch-repeat.py')
common=pair_helpers.common
coverage=load('actual_mst_and_relative_census','mst-relative-v4-coverage.py')
launch_gate=load('combined_prospective_launch_prerequisite','mst-relative-v4-launch-gate.py')
transitions=load('actual_mst_structural_transitions','layer-aware-mst-transition-audit.py')
require,exact,sha=common.require,common.exact,common.sha
obj=pair_helpers.obj
source_qualified=pair_helpers.source_qualified

def assets():return set(common.ASSETS)|NEW_ASSETS

def derived_shards(authority):
    plan=ROOT/'layer-aware-mst-prior-lpt-plan.json';require(sha(plan)==PLAN_SHA,'Original prior-only LPT vectors changed')
    rows=json.loads(plan.read_text())['shards']
    result=[{k:row[k] for k in ['dataset','shardIndex','shardCount']}|{'cases':[{k:case[k] for k in ['sample','inputHash','order']}for case in row['cases']]}for row in rows]
    identities=[(row['dataset'],case['sample'])for row in result for case in row['cases']]
    require(len(identities)==len(set(identities))==42 and set(identities)=={(d,n)for d,count in [('srj18',16),('srj24',26)]for n in range(1,count+1)},'All42 original cases once required')
    require(all(case['inputHash']==authority['expectedInputHashesByDataset'][row['dataset']][str(case['sample'])]for row in result for case in row['cases']),'LPT original input identity changed')
    require({order:sum(case['order']==order for row in result for case in row['cases'])for order in ['AB','BA']}=={'AB':21,'BA':21},'Fixed prior-only order balance changed')
    return result

def estimator_policy():
    return {'primaryTarget':'Combine original layer-aware MST terminal identity with the reviewed relativeV4 repair. Both options are true; coincident XY on distinct layers retains requirements and local geometry may improve. Geometry, point pairs, iterations and native work may legitimately change.',
        'qualityCohort':'Per-arm strict original-source/input/runtime/budget provenance plus frozen original-owner seven copper predicates and the inherited scoped supplemental grade. Full libraryRoutingChecks remain retained; that grade is not universal via-in-pad clearance or electrical PASS. Targeted case24:8 recovery evidence additionally requires all six explicit structural manufactured bridges outside their original SMT envelopes. Matched physical-clean clocks require both arms individually clean; cross-arm output/hash/iterations equality is never an integrity or cohort gate.',
        'wholeClock':'Actual constructorTimeMs plus official elapsedTimeMs, own fresh same-host native/candidate pair only; original360s solve after constructor and480s outer guard.',
        'reports':['all42 per-arm original outcomes and physical identities/gains/losses','changed outputs/pointpairs/native work reported as outcomes','matched physical-clean ratio of sums, paired median and predeclared AB/BA strata','completed MST component ledger before later failures without solved/output credit','relative source-bound local qualification/stat/proof scalar observations and stage overhead; no independent within-B pre-repair snapshot means local contact replay UNKNOWN'],
        'logicalMechanism':'Cold completed MST ledger covers intermediate selected requirements before preconnection filtering/off-board substitution. It is not emitted-demand or final electrical proof. Case24:8 six original distinct-layer terminal IDs require independent original/raw point-pair graph replay; missing later-failure context stays UNKNOWN, not zero or a source-integrity error.',
        'fullUnion':'All16srj18 and26srj24 original IDs once perarm; every native failure/timeout/invalid/UNKNOWN retained, no outcome-dependent exclusions or historical baseline reuse.',
        'scheduling':'Only immutable prior-native LPT weights/case/order vectors reused from the old conditional plan. Its unmet prior quality6 recovery condition is NOT claimed or adopted as authorization; root separately prospectively authorized this semantic experiment before any candidate board run.',
        'relativeMechanism':'Four immutable observer paths retain MST9, relative qualification10, flat scalar stats and relative proof5. The exact-untargeted mode retains the four flat acceptanceMode/target1-to0/untargeted-preserved scalars and allows positive remaining findings only for that coherent mode. Nested selected moves, candidate ledger and pre-repair input are not retained. Local source telemetry is not independent contact proof, not global electrical PASS, and never promotes a full UNKNOWN certificate. A separate newly qualified retained18V4 production-stage proof is a launch prerequisite only; final full84 outcomes require new raw proof.',
        'clocks':'No profiling, normalization, prefix correction, prior timing pooling or geometry/work parity filtering. Logical demand coverage is distinct from physical/final electrical PASS.'}

def validate_source_publication(q,pub):
    require(q.get('tree')==TREE and q.get('localCommit')==SOURCE_LOCAL,'Source QA tree/local commit differs')
    require(pub.get('remoteCommit')==SOURCE and pub.get('tree')==TREE,'Root published source commit/tree differs')
    require(obj(pub.get('qa')).get('sha256')==QA_SHA and obj(pub.get('peer')).get('sha256')==REVIEW_SHA,'Source QA/peer bytes unbound')
    require(pub.get('remoteCommitTreeParentsAndBranchGetVerified')is True and pub.get('remoteCommitTreeSingleParentAndBranchGetVerified')is not True,'Two-parent source must accurately attest verified parents')
    require(pub.get('remoteParents')==SOURCE_PARENTS,'Combined source must bind BOTH originalMST and tested relativeV4 published parents')
    require(pub.get('readyForFreshCombinedSemantic84Source')is True,'Combined source has not received prospective full84 readiness')
    return {'originalMstAndTestedRelativeV4ParentsBound':True,'twoParentPublicationAccurate':True}

def validate():
    m=json.loads(MANIFEST.read_text());a=common.validate_manifest(AUTHORITY)
    require(m.get('campaign')==CAMPAIGN and m.get('repository')=='tscircuit/tscircuit-autorouter' and m.get('controllerBranch')==BRANCH,'Wrong semantic MST campaign/branch')
    require(exact(m.get('shards'),derived_shards(a)),'Fixed prior-only LPT shard/case/order vectors changed')
    require(type(m.get('plannedJobs'))is int and m['plannedJobs']==11 and type(m.get('plannedAttempts'))is int and m['plannedAttempts']==84,'Exact11 jobs/84 attempts required')
    require(m.get('caseCounts')=={'srj18':16,'srj24':26} and m.get('orderCounts')=={'AB':21,'BA':21},'Exact original case/order counts required')
    require(exact(m.get('fullOriginalInputPopulationHashes'),a['expectedInputHashesByDataset'])and m.get('priorSchedulingOnly')is True and m.get('oldQuality6ConditionClaimedMet')is False,'Original input/prior scheduling scope changed')
    require(m.get('relativeStandaloneSourceSha')==launch_gate.RELATIVE_SOURCE and m.get('relativeStandaloneSourceTree')==launch_gate.RELATIVE_TREE,'Tested standalone V4 source binding differs')
    require(m.get('baselineSha')==common.MAIN and m.get('authoritySha256')==sha(AUTHORITY)and m.get('workflowSha256')==sha(WORKFLOW),'Frozen native authority/workflow changed')
    require(m.get('inheritedControllerLocal')=='1ceae623bbb07db11c257a62ac609f16e597d258'and m.get('inheritedControllerTree')=='1721273b673e99ea20101f83afe32aaf546e712b'and m.get('expectedRemoteParent')=='42ebbb927dea2946f5165c26b106d5eb0843ee65','Additive source parent changed')
    require(set(m.get('runtimeSourceHashes',{}))==assets()and all(sha(ROOT/name)==value for name,value in m['runtimeSourceHashes'].items()),'Exact semantic controller/helper bytes changed')
    require(m.get('runSampleSourceSha256')==hashlib.sha256(inspect.getsource(common.pinned.run_sample).encode()).hexdigest(),'Original native process routine changed')
    require(m.get('freshProcessPerAttempt')is True and m.get('cpuProfiling')is False and m.get('correctedClocks')is False and m.get('timingsPooledWithPriorCampaigns')is False and m.get('originalServerZipRawProofRequired')is True,'Fresh process/raw/clock policy changed')
    require(m.get('sampleTimeoutSeconds')==360 and m.get('externalControllerGuardSeconds')==480 and all(type(m.get(k))is int and m[k]==1 for k in ['threads','concurrency','effort']),'Native budget/runtime changed')
    require(exact(m.get('estimators'),estimator_policy()) and m.get('changedGeometryAndWorkAllowed')is True and m.get('crossArmParityRequired')is False,'Prospective semantic estimator policy changed')
    item=m.get('candidate',{});require(item.get('id')=='mst-relative-v4'and item.get('candidateSha')==SOURCE and item.get('candidateTree')==TREE and item.get('option')==FLAG,'Wrong qualified MST source')
    require(exact(item.get('options'),{'cacheProvider':None,'effort':1,FLAG:True,RELATIVE_FLAG:True})and item.get('evidencePaths')==EVIDENCE_PATHS and item.get('solverName')==common.SOLVER and item.get('solverModule')==common.MODULE and exact(item.get('coverageContract'),coverage.contract())and exact(item.get('secondaryCoverageContract'),coverage.relative_contract()),'Exact MST option/native constructor/ledger contract required')
    require(SOURCE!='0'*40 and TREE!='1'*40 and SOURCE_LOCAL!='5'*40,'Unpublished draft source may not run')
    for name,value in [('mst-relative-v4-source-qa.json',QA_SHA),('mst-relative-v4-source-review.json',REVIEW_SHA),('mst-relative-v4-source-publication.json',PUBLICATION_SHA)]:require(sha(ROOT/name)==value,'Frozen source QA/review/publication bytes changed')
    q=json.loads((ROOT/'mst-relative-v4-source-qa.json').read_text());pub=json.loads((ROOT/'mst-relative-v4-source-publication.json').read_text())
    validate_source_publication(q,pub)
    stage_prerequisite(m)
    return m,a

def stage_prerequisite(m):
    names=[('mst-relative-v4-18-stage-gate.json',STAGE18_GATE_SHA),('mst-relative-v4-18-stage-qualification.json',STAGE18_RAW_SHA),('mst-relative-v4-18-stage-independent-review.json',STAGE18_PEER_SHA)]
    require(STAGE18_GATE_SHA!='7'*64 and STAGE18_RAW_SHA!='8'*64 and STAGE18_PEER_SHA!='9'*64,'New retained18V4 actual qualification and peer prerequisite is unsealed')
    for name,value in names:require(sha(ROOT/name)==value,'New retained18 stage prerequisite bytes changed: '+name)
    gate,raw,peer=[json.loads((ROOT/name).read_text())for name,value in names]
    result=launch_gate.validate_stage_documents(gate,raw,peer,STAGE18_RAW_SHA,STAGE18_PEER_SHA)
    require(exact(m.get('retained18V4Prerequisite'),{'gateSha256':STAGE18_GATE_SHA,'rawQualificationSha256':STAGE18_RAW_SHA,'independentReviewSha256':STAGE18_PEER_SHA}),'Manifest retained18V4 prerequisite receipt bindings differ')
    item=m['candidate'];inventory=launch_gate.original_inventory()
    require(item.get('originalMstSourceSha')==launch_gate.MST_SOURCE and item.get('excludedStableSourceSha')==launch_gate.EXCLUDED_STABLE and exact(item.get('requiredOriginalMstFileHashes'),{row['path']:row['sha256']for row in inventory['files']})and exact(item.get('requiredRelativeV4FileHashes'),{launch_gate.RELATIVE_FILES[k]:v for k,v in result['relativeImplementationHashes'].items()}),'Combined source exact component inventory differs')
    return gate

def verify_composition(checkout,m):return launch_gate.verify_composition(checkout,m['candidate'],stage_prerequisite(m))

def select_shard(m,dataset,index):
    require(type(index) is int,'Typed shard index required');row=next((x for x in m['shards'] if (x['dataset'],x['shardIndex'])==(dataset,index)),None);require(row is not None,'Outside sealed shard population');return row

def expected_cp(m,shard,ordinal,arm,run_id,controller):
    require(type(ordinal) is int and 0<=ordinal<len(shard['cases']) and arm in ['A','B'] and isinstance(run_id,str) and re.fullmatch(r'[1-9][0-9]*',run_id) and common.digest(controller),'Invalid selected attempt identity')
    case=shard['cases'][ordinal]
    return {'campaign':f"{CAMPAIGN}:{shard['dataset']}:shard-{shard['shardIndex']}:case-{case['sample']}:{case['order']}",'arm':arm,'algorithmSha':common.MAIN if arm=='A' else SOURCE,'dataset':shard['dataset'],'originalSample':case['sample'],'inputSha256':case['inputHash'],'observerSourceSha256':m['runtimeSourceHashes']['phase-checkpoint-observer.ts'],'executionOrder':case['order'],'githubRunId':run_id,'controllerSha':controller}

def metadata(m,shard,ordinal,arm,run_id,controller):
    case=shard['cases'][ordinal];cp=expected_cp(m,shard,ordinal,arm,run_id,controller)
    return {'campaign':cp['campaign'],'experiment':'mst-relative-v4','dataset':shard['dataset'],'round':1,'pairIndex':1,'sampleNumber':case['sample'],'arm':arm,'executionOrder':case['order'],'requestedOptions':m['candidate']['options']if arm=='B'else{'cacheProvider':None,'effort':1},'sha':cp['algorithmSha'],'expectedInputHash':case['inputHash'],'solverName':common.SOLVER,'shardIndex':shard['shardIndex'],'shardCount':shard['shardCount'],'ordinalWithinShard':ordinal,'runId':run_id,'controllerSha':controller}

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
        pairs.append({'sample':case['sample'],'ordinalWithinShard':ordinal,'order':case['order'],'sourceQualified':source,'wholeQualityQualified':quality,'wholeClockMs':times,'wholeBdivA':times['B']/times['A']if times and times['A']>0 else None,'perArmPhysicalClean':physical,'outputHashes':hashes,'crossArmOutputHashEquality':{key:hashes['A'][key]==hashes['B'][key]for key in hashes['A']},'crossArmParityIsRequired':False,'candidateMstLedger':values['B'].get('featureCoverage'),'perArmRelativeRepairObservation':{arm:obj(row.get('featureCoverage')).get('relativeRepairObservation')for arm,row in values.items()},'perArmPointPairRequirementAudit':{arm:row.get('pointPairRequirementAudit')for arm,row in values.items()},'perArmRawTransitionAudit':{arm:row.get('rawTransitionAudit')for arm,row in values.items()},'perArmTargetedStructuralRecoveryEvidence':{arm:source_qualified(row)and physical[arm]and obj(row.get('pointPairRequirementAudit')).get('status')=='COVERED_LOGICAL_REQUIREMENTS'and obj(obj(row.get('rawTransitionAudit')).get('targetSMTTransitionWitness')).get('status')=='PROVEN_STRUCTURAL'for arm,row in values.items()},'scopedSevenGradeIsNotElectricalPass':True,'perArmStageIntervals':{arm:pair_helpers.intervals(row)for arm,row in values.items()},'outcomes':{arm:{key:obj(row.get('official')).get(key)for key in ['didSolve','didTimeout','relaxedDrcPassed']}for arm,row in values.items()}})
    expected={(case['sample'],arm)for case in shard['cases']for arm in 'AB'}
    return {'campaign':CAMPAIGN,'shard':shard,'recordCount':len(records),'expectedRecords':len(expected),'populationComplete':len(records)==len(index)==len(expected)and set(index)==expected,'sourceQualifiedRecordCount':sum(source_qualified(row)for row in records),'strictRecordCount':sum(row.get('strictIntegrityQualified')is True for row in records),'pairs':pairs,'whole':pair_helpers.clock_summary(pairs,'wholeClockMs'),'wholeByOrder':{o:pair_helpers.clock_summary([p for p in pairs if p['order']==o],'wholeClockMs')for o in ['AB','BA']},'priorBaselinesReused':False,'timingsPooledWithPriorCampaigns':False,'clockCorrectionApplied':False,'crossArmOutputOrNativeWorkParityRequired':False,'logicalMechanismIsNotElectricalPass':True,'localRelativeTelemetryIsNotIndependentBeforeAfterOrGlobalPass':True,'scopedSevenGradeIsNotElectricalPass':True,'scope':'One fresh semantic native/candidate pair per original case in this fixed prior-only LPT shard. Every changed/failed/invalid/UNKNOWN result retained; all11 original serverZIP receipts required for full84 authority.'}


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
    shard=select_shard(m,args.dataset,args.shard);output=args.output.resolve();require(not output.exists() or not any(output.iterdir()),'Fresh output required');item=m['candidate'];checkouts={'A':args.baseline.resolve(),'B':args.candidate.resolve()};common.verify_checkouts(a,item,checkouts);composition=verify_composition(checkouts['B'],m);common.verify_dependencies(a,checkouts)
    identities={arm:common.pinned.read_identity(path,args.dataset) for arm,path in checkouts.items()};require(exact(identities['A'],identities['B']) and {str(x['sampleNumber']):x['inputHash'] for x in identities['A']}==a['expectedInputHashesByDataset'][args.dataset],'Complete original input population changed');identity={x['sampleNumber']:x for x in identities['A']}
    harnesses={arm:json.loads((path/'experiment-harness-provenance.json').read_text()) for arm,path in checkouts.items()}
    for arm,h in harnesses.items():require(h.get('checkoutSha')==(common.MAIN if arm=='A' else SOURCE) and h.get('validators')==a['expectedValidatorHashes'] and all(h.get(k)==v for k,v in a['expectedHarnessSourceHashes'].items()),'Native source/harness differs')
    comparison=common.pinned.compare_dependency_resolutions(harnesses);common.pinned.write_json(output/'provenance.json',{'manifest':m,'manifestSha256':sha(MANIFEST),'shard':shard,'fullOriginalPopulation':identities['A'],'selectedOriginalInputs':[identity[x['sample']] for x in shard['cases']],'harnesses':harnesses,'dependencyComparison':comparison,'combinedSourceComposition':composition,'retained18V4Prerequisite':m['retained18V4Prerequisite'],'githubRunId':os.environ.get('GITHUB_RUN_ID'),'controllerSha':os.environ.get('GITHUB_SHA'),'runAttempt':os.environ.get('GITHUB_RUN_ATTEMPT'),'fullUnionCases':42,'plannedFullUnionAttempts':84,'plannedFullUnionShards':11,'timingsPooledWithPriorCampaigns':False})
    records=[]
    for ordinal,case in enumerate(shard['cases']):
        require(identity[case['sample']]['inputHash']==case['inputHash'],'Selected original input changed')
        for arm in case['order']:
            meta=metadata(m,shard,ordinal,arm,os.environ.get('GITHUB_RUN_ID'),os.environ.get('GITHUB_SHA'));cp=expected_cp(m,shard,ordinal,arm,meta['runId'],meta['controllerSha']);config=dict(a['baseline'],evidencePaths=item['evidencePaths']) if arm=='A' else dict(item);config.update(phaseCheckpoint=cp,shardProvenance={'shard':shard,'ordinalWithinShard':ordinal,'originalSample':case['sample'],'order':case['order']});config_path=output/f"sample-{case['sample']:03d}"/f'config-{arm}.json';common.pinned.write_json(config_path,config);print(ACTIVE+json.dumps(meta),flush=True);target=output/f"sample-{case['sample']:03d}"/arm
            record=common.pinned.run_sample(checkouts[arm],config_path,target,args.dataset,case['sample'],360);record.update(meta,qualificationMode='full-original-population-shard',scenarioName=identity[case['sample']]['scenarioName']);common.declared.qualify_output(record,target,checkouts[arm],a,ROOT,common.pinned.execute_with_deadline);record['phaseCheckpointAudit']=common.checkpoint_audit(target/'raw',cp);record['pointPairRequirementAudit']=audit_pointpairs(record,target/'raw');record['rawTransitionAudit']=audit_transitions(record,target/'raw')
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
    return {'schemaVersion':1,'campaign':CAMPAIGN,'runId':str(run_id),'controllerSha':controller,'manifestSha256':sha(MANIFEST),'recordCount':84,'originalCaseCount':42,'shardCount':11,'orderCounts':{'AB':21,'BA':21},'sourceQualifiedLogUnion':True,'originalServerZipProofRequired':True,'requiredIndependentRawReceipts':11,'rawByteQualificationClaim':False,'strictRecordCount':sum(r['strictIntegrityQualified'] is True for r in records),'separatelyCheckpointProvenTimeoutCount':sum(obj(r.get('durableTimeoutSourceQualification')).get('sourceAndInputProvenByBoundedCheckpoints') is True for r in records),'identitySets':identity_sets,'pairs':pairs,'candidateMstLogicalCoverageCases':[{'dataset':p['dataset'],'sample':p['sample'],'coverage':p['candidateMstLedger']}for p in pairs],'whole':pair_helpers.clock_summary(pairs,'wholeClockMs'),'wholeByOrder':{o:pair_helpers.clock_summary([p for p in pairs if p['order']==o],'wholeClockMs') for o in ['AB','BA']},'timingsPooledWithPriorCampaigns':False,'clockCorrectionApplied':False,'scope':'Complete authenticated-log population replay only; final independent analysis additionally requires11 exact original-serverZIP/source/producer/member proof receipts, with no prior336 orrepeat16 clocks pooled.'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--mode',choices=['plan','select','verify-checkouts','verify-dependencies','run','parse','union'],required=True);p.add_argument('--baseline',type=Path);p.add_argument('--candidate',type=Path);p.add_argument('--dataset',choices=['srj18','srj24']);p.add_argument('--shard',type=int);p.add_argument('--output',type=Path);p.add_argument('--job-log',type=Path);p.add_argument('--parsed',action='append',type=Path,default=[]);p.add_argument('--run-id');p.add_argument('--controller-sha');args=p.parse_args();m,a=validate()
    if os.environ.get('GITHUB_ACTIONS')=='true':require(os.environ.get('GITHUB_EVENT_NAME')=='push' and os.environ.get('GITHUB_REF_NAME')==BRANCH and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','Only first reviewed controller branch push attempt may run')
    if args.mode=='plan':common.outputs({'matrix':json.dumps({'include':[{'dataset':s['dataset'],'shard':s['shardIndex']} for s in m['shards']]},separators=(',',':'))});return
    if args.mode=='union':require(not args.output.exists(),'Never overwrite union replay');common.pinned.write_json(args.output,qualify_union([json.loads(p.read_text()) for p in args.parsed],m,a,args.run_id,args.controller_sha));return
    shard=select_shard(m,args.dataset,args.shard)
    if args.mode=='select':common.outputs({'baseline_sha':common.MAIN,'candidate_sha':SOURCE,'harness_sha':common.MAIN})
    elif args.mode=='verify-checkouts':
        common.verify_checkouts(a,m['candidate'],{'A':args.baseline.resolve(),'B':args.candidate.resolve()});verify_composition(args.candidate.resolve(),m)
    elif args.mode=='verify-dependencies':common.verify_dependencies(a,{'A':args.baseline.resolve(),'B':args.candidate.resolve()})
    elif args.mode=='parse':require(not args.output.exists(),'Never overwrite parsed shard records');common.pinned.write_json(args.output,parse_log(args.job_log.read_text(),m,a,shard,args.run_id,args.controller_sha))
    else:run(args,m,a)

if __name__=='__main__':main()
