#!/usr/bin/env python3
"""Fresh N/P/F original42-case triplets; explicit roles, never arm relabeling."""
import argparse,copy,hashlib,importlib.util,inspect,json,math,os,re,statistics,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
CAMPAIGN='owner-root-memo126-20261030'
BRANCH='codex/owner-root-memo126-controller-20261030'
MANIFEST=ROOT/(CAMPAIGN+'.json')
WORKFLOW=ROOT.parent.parent/'.github/workflows'/('owner-root-memo126-20261030.yml')
AUTHORITY=ROOT/'bottleneck-experiments-20261029.json'
RESULT='OWNER_ROOT_MEMO126_SHARD_RESULT_JSON '
ACTIVE='OWNER_ROOT_MEMO126_SHARD_ACTIVE_JSON '
SUMMARY='OWNER_ROOT_MEMO126_SHARD_SUMMARY_JSON '
ROLES=['N','P','F']
PERMUTATIONS=['NPF','NFP','PNF','PFN','FNP','FPN']
SOURCE='b110666594b06e5e5c883eb24e7575bc1cdef753'
TREE='f697703ff8fce07c2321af29e89dfa450008da2f'
P_SOURCE='50a8051cd9853d260b26d312246714cddbb67749'
P_TREE='aed1e4ca2eef423389ef4adedc039667b617d4af'
def load(name,filename):
 s=importlib.util.spec_from_file_location(name,ROOT/filename);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
parent=load('memo126_frozen_parent_runtime','run-owner-feedback-fast126.py')
common,pair_helpers=parent.common,parent.pair_helpers
coverage=load('fast126_role_coverage','owner-root-memo126-coverage.py')
role_qualification=load('fast126_role_qualification','owner-root-memo126-role-qualification.py')
require,exact,sha,obj=common.require,common.exact,common.sha,parent.obj
source_qualified=parent.source_qualified
transitions=parent.transitions
PATH,FLAG,FEEDBACK_PATH,FEEDBACK_FLAG=parent.PATH,parent.FLAG,parent.FEEDBACK_PATH,parent.FEEDBACK_FLAG
NEW_ASSETS={'run-owner-root-memo126.py','owner-root-memo126-coverage.py','owner-root-memo126-role-qualification.py','owner-root-memo126-artifact-carrier.py','owner-root-memo126-raw-proof.py','seal-owner-root-memo126.py','owner-root-memo126-source-qa.json','owner-root-memo126-source-review.json','owner-root-memo126-source-publication.json','tests/owner-root-memo126-integrity.py','tests/owner-root-memo126-observer-integrity.ts','tests/owner-root-memo126-carrier-integrity.py','tests/owner-root-memo126-raw-binding-integrity.py','tests/owner-root-memo126-unsealed-integrity.py'}
def assets():return parent.assets()|NEW_ASSETS

def derived_shards(authority):
 rows=copy.deepcopy(parent.derived_shards(authority))
 # Sample identity assignment is deterministic, frozen before all MEMO outcomes.
 identities=sorted((r['dataset'],c['sample'])for r in rows for c in r['cases'])
 orders={identity:PERMUTATIONS[i%6]for i,identity in enumerate(identities)}
 for r in rows:
  for c in r['cases']:c['order']=orders[r['dataset'],c['sample']]
 require({o:sum(c['order']==o for r in rows for c in r['cases'])for o in PERMUTATIONS}=={o:7 for o in PERMUTATIONS},'Exact six-way order balance required')
 return rows

def role_items(a):
 common_fields={'id':'owner-root-memo126','option':FLAG,'evidencePaths':[PATH,FEEDBACK_PATH],'solverName':common.SOLVER,'solverModule':common.MODULE,'coverageContract':coverage.contract()}
 out={}
 for role,pin,tree,version in [('N',common.MAIN,a['baselineTree'],1),('P',P_SOURCE,P_TREE,2),('F',SOURCE,TREE,2)]:
  out[role]=dict(common_fields,role=role,roleName={'N':'native','P':'selected-two-feedback','F':'owner-root-index-feedback'}[role],candidateSha=pin,candidateTree=tree,feedbackVersion=version,options={'cacheProvider':None,'effort':1}|({FLAG:True,FEEDBACK_FLAG:True}if role!='N'else{}),secondaryCoverageContract=coverage.feedback_contract(version))
 return out

def estimator_policy():
 return {'primaryComparisons':['N/F','P/F'],'wholeClock':'Actual constructorTimeMs plus official elapsedTimeMs, samecase freshprocess samehost; separate matchedphysicalclean pairs percomparison.','quality':'All42 roles retained: sourcequalified native completions and frozen sevenpredicate/scoped supplemental physical identities; failures/timeouts/UNKNOWN never dropped or countedclean. FullPCBelectricalPASS remainsUNPROVEN.','runtime':'360s native solve afterconstructor;480s externalguard; effort1/cacheNull/thread1/concurrency1; no oldclocks or baseline reuse.','order':'Six permutations seven cases eachglobally; eachpair21/21 ordering. Existing prioronly11LPT groups unchanged.','semanticPreservation':'P/F rawoutput/pointpairs/nativework/coldcounter differences reported as outcomes, never integrityorcohortgate.','mechanism':'N featureabsence; P/F exact15scalarv2 full7admission/reference2. Only F adds a fresh per-invocation owner-root index; no cross-call context cache. Ledger notrepairorspeedproof.','proof':'Perarm fullseven originalowner reports/fullsupplemental/native errors and originalserverZIPbytes;24:8 sixlogicalrequirements and sixstructuralmanufacturedbridges required separately.'}

def validate():
 old,a=parent.validate();m=json.loads(MANIFEST.read_text())
 require(common.digest(SOURCE) and m.get('sourcePublicationState')=='PUBLISHED_MEMO_SOURCE','Memo source publication is UNSEALED; no actual run is permitted')
 require(m.get('schemaVersion')==2 and m.get('recordSchema')=='EXPLICIT_N_P_F_TRIPLET_V1'and m.get('campaign')==CAMPAIGN and m.get('controllerBranch')==BRANCH,'Explicit triplet schema/campaign required')
 require(m.get('expectedRemoteParent')=='815d192f376cbc927ffad2ffad709bea59edfa2f'and m.get('inheritedControllerTree')=='a36468b76f05307d3df7c1918d57f8b563db6557','Exact inherited parent tree required')
 require(exact(m.get('roles'),role_items(a))and exact(m.get('shards'),derived_shards(a)),'Roles/sources/options/input/permutations changed')
 require(m.get('plannedJobs')==11 and m.get('plannedAttempts')==126 and m.get('caseCounts')=={'srj18':16,'srj24':26}and m.get('orderCounts')=={o:7 for o in PERMUTATIONS},'Original42/126 union changed')
 require(m.get('authoritySha256')==sha(AUTHORITY)and m.get('workflowSha256')==sha(WORKFLOW)and m.get('baselineSha')==common.MAIN,'Frozen authority/workflow/native differs')
 require(exact(m.get('fullOriginalInputPopulationHashes'),a['expectedInputHashesByDataset'])and m.get('allOrdersSealedBeforeMemoOutcomes')is True and m.get('priorSchedulingOnly')is True,'Original population/prospective orders required')
 require(set(m.get('runtimeSourceHashes',{}))==assets()and all(sha(ROOT/n)==h for n,h in m['runtimeSourceHashes'].items()),'Exact helper bytes changed')
 require(m.get('runSampleSourceSha256')==hashlib.sha256(inspect.getsource(common.pinned.run_sample).encode()).hexdigest(),'Frozen fresh native process changed')
 require(m.get('sampleTimeoutSeconds')==360 and m.get('externalControllerGuardSeconds')==480 and all(type(m.get(k))is int and m[k]==1 for k in ['threads','concurrency','effort']),'Native budgets/runtime changed')
 require(m.get('freshProcessPerAttempt')is True and all(m.get(k)is False for k in ['cpuProfiling','correctedClocks','timingsPooledWithPriorCampaigns','crossArmParityRequired'])and m.get('originalServerZipRawProofRequired')is True,'Fresh complete proof/clock policy differs')
 require(exact(m.get('estimators'),estimator_policy()),'Predeclared estimators changed')
 require(P_SOURCE==parent.SOURCE and P_TREE==parent.TREE,'Selected-two parent source differs from inherited sealed authority')
 for name,h in [('qa','b5763e170c0b1fb87e94d05503721d20c40f598ce7db1045a6ffbb54e7351a5d'),('review','a863abb81b0ff293d9551293ab735da8cd856e8f397c65807f544b444216cd04'),('publication','a8d78a42e867db9886c94ff80cd9715926cacf1911700352e4401e8ff0b2b6f4')]:require(common.digest(h,64) and sha(ROOT/f'owner-root-memo126-source-{name}.json')==h,'Memo source evidence is UNSEALED or differs')
 pub=json.loads((ROOT/'owner-root-memo126-source-publication.json').read_text());require(pub['remoteCommit']==SOURCE and pub['tree']==TREE and pub['remoteParent']==P_SOURCE and pub['remoteCommitTreeParentsAndBranchGetVerified']is True,'Memo published source binding differs')
 return m,a

def select_shard(m,dataset,index):return parent.select_shard(m,dataset,index)
def expected_cp(m,shard,ordinal,arm,run_id,controller):
 require(type(ordinal)is int and 0<=ordinal<len(shard['cases'])and arm in ROLES and isinstance(run_id,str)and re.fullmatch(r'[1-9][0-9]*',run_id)and common.digest(controller),'Invalid role/case identity')
 case=shard['cases'][ordinal]
 return {'campaign':f"{CAMPAIGN}:{shard['dataset']}:shard-{shard['shardIndex']}:case-{case['sample']}:{case['order']}",'arm':arm,'algorithmSha':m['roles'][arm]['candidateSha'],'dataset':shard['dataset'],'originalSample':case['sample'],'inputSha256':case['inputHash'],'observerSourceSha256':m['runtimeSourceHashes']['phase-checkpoint-observer.ts'],'executionOrder':case['order'],'githubRunId':run_id,'controllerSha':controller}
def metadata(m,shard,ordinal,arm,run_id,controller):
 case=shard['cases'][ordinal];cp=expected_cp(m,shard,ordinal,arm,run_id,controller);item=m['roles'][arm]
 return {'recordSchema':'EXPLICIT_N_P_F_TRIPLET_V1','campaign':cp['campaign'],'experiment':'owner-root-memo126','dataset':shard['dataset'],'round':1,'tripletIndex':1,'sampleNumber':case['sample'],'arm':arm,'role':item['roleName'],'executionOrder':case['order'],'requestedOptions':item['options'],'sha':cp['algorithmSha'],'expectedInputHash':case['inputHash'],'solverName':common.SOLVER,'shardIndex':shard['shardIndex'],'shardCount':shard['shardCount'],'ordinalWithinShard':ordinal,'runId':run_id,'controllerSha':controller}
def attempt_config(m,a,shard,ordinal,arm,run_id,controller):
 case=shard['cases'][ordinal];config=dict(m['roles'][arm]);config.update(phaseCheckpoint=expected_cp(m,shard,ordinal,arm,run_id,controller),shardProvenance={'shard':shard,'ordinalWithinShard':ordinal,'originalSample':case['sample'],'order':case['order']});return config

def qualify(record,m,a,shard,ordinal,arm,run_id,controller):
 require(all(exact(record.get(k),v)for k,v in metadata(m,shard,ordinal,arm,run_id,controller).items()),'Triplet source/role/input/order identity differs')
 cp=obj(record.get('phaseCheckpointAudit'));last=obj(cp.get('lastDurableCheckpoint'));expected=expected_cp(m,shard,ordinal,arm,run_id,controller)
 require(cp.get('errors')==[]and all(v is not None and exact(last.get(k),v)for k,v in expected.items()),'Durable triplet provenance unbound')
 require(last.get('observedObjectPath')=='solver'and last.get('observedConstructorName')==common.SOLVER and last.get('actualCacheProviderState')=='disabled'and exact(last.get('observedRequestedOptions'),record['requestedOptions']),'Actual constructor/options differ')
 role_qualification.qualify_record(record,a,m['roles'][arm]);record['strictIntegrityIssues'].extend(record['featureCoverage']['issues']);record['strictIntegrityQualified']=not record['strictIntegrityIssues'];record['durableTimeoutSourceQualification']=common.timeout_checkpoint_qualification(record);record['nonterminalFeatureObservations']=coverage.nonterminal_observations(record,m['roles'][arm]);return record

def clock_summary(pairs,left,right):
 valid=[p['wholeClockMs']for p in pairs if p.get('wholeClockMs')is not None];ratios=[v[right]/v[left]for v in valid if v[left]>0]
 return {'comparison':left+'/'+right,'matchedPhysicalCleanCases':len(valid),'sumMs':{role:sum(v[role]for v in valid)for role in[left,right]},'ratioOfSums':sum(v[right]for v in valid)/sum(v[left]for v in valid)if valid and sum(v[left]for v in valid)>0 else None,'medianPairedRatio':statistics.median(ratios)if ratios else None,'geometricMeanPairedRatio':math.exp(statistics.mean(math.log(v)for v in ratios))if ratios and all(v>0 for v in ratios)else None,'allPairedRatios':ratios}
def summarize(records,shard):
 index={(r['sampleNumber'],r['arm']):r for r in records};triplets=[];pairs={'N/F':[],'P/F':[]}
 for ordinal,case in enumerate(shard['cases']):
  if not all((case['sample'],role)in index for role in ROLES):continue
  values={role:index[case['sample'],role]for role in ROLES};source={role:source_qualified(v)for role,v in values.items()};physical={role:common.physical_clean(v)for role,v in values.items()};hashes={role:pair_helpers.output_hashes(v)for role,v in values.items()}
  triplets.append({'sample':case['sample'],'ordinalWithinShard':ordinal,'order':case['order'],'perRoleSourceQualified':source,'perRolePhysicalClean':physical,'outputHashes':hashes,'perRoleMstLedger':{role:v.get('featureCoverage')for role,v in values.items()},'perRolePointPairRequirementAudit':{role:v.get('pointPairRequirementAudit')for role,v in values.items()},'perRoleRawTransitionAudit':{role:v.get('rawTransitionAudit')for role,v in values.items()},'perRoleStageIntervals':{role:pair_helpers.intervals(v)for role,v in values.items()},'outcomes':{role:{k:obj(v.get('official')).get(k)for k in['didSolve','didTimeout','relaxedDrcPassed']}for role,v in values.items()},'crossArmParityRequired':False,'scopedSevenGradeIsNotElectricalPass':True})
  for key in pairs:
   left,right=key.split('/');clean=all(source[role]and physical[role]for role in[left,right]);times={role:values[role]['official']['elapsedTimeMs']+values[role]['official']['routingMetrics']['experimentAudit']['constructorTimeMs']for role in[left,right]}if clean else None
   pairs[key].append({'sample':case['sample'],'order':case['order'],'relativeOrder':left+right if case['order'].index(left)<case['order'].index(right)else right+left,'sourceQualified':all(source[role]for role in[left,right]),'wholeQualityQualified':clean,'wholeClockMs':times,'perRolePhysicalClean':{role:physical[role]for role in[left,right]},'crossArmParityRequired':False})
 expected={(case['sample'],role)for case in shard['cases']for role in ROLES}
 return {'schemaVersion':2,'campaign':CAMPAIGN,'shard':shard,'recordCount':len(records),'expectedRecords':len(expected),'populationComplete':len(records)==len(index)==len(expected)and set(index)==expected,'sourceQualifiedRecordCount':sum(source_qualified(v)for v in records),'strictRecordCount':sum(v.get('strictIntegrityQualified')is True for v in records),'triplets':triplets,'comparisons':{key:{'pairs':rows,'whole':clock_summary(rows,*key.split('/')),'wholeByRelativeOrder':{order:clock_summary([p for p in rows if p['relativeOrder']==order],*key.split('/'))for order in[key.replace('/',''),key.replace('/','')[::-1]]}}for key,rows in pairs.items()},'priorBaselinesReused':False,'timingsPooledWithPriorCampaigns':False,'clockCorrectionApplied':False,'crossArmOutputOrNativeWorkParityRequired':False,'requiredIndependentRawReceipts':11}

def verify_checkouts(m,a,checkouts):
 for role,checkout in checkouts.items():
  item=m['roles'][role];observed=subprocess.check_output(['git','rev-parse','HEAD','HEAD^{tree}'],cwd=checkout,text=True).splitlines();require(observed==[item['candidateSha'],item['candidateTree']],'Role source tree differs:'+role);package=json.loads((checkout/'package.json').read_text());require(exact({k:package[k]for k in['dependencies','devDependencies','optionalDependencies']if k in package},a['sourceDependencySections']),'Source dependencies changed');require(all(sha(checkout/p)==v for p,v in a['expectedValidatorHashes'].items()),'Frozen validators changed')

def compare_dependency_pair(harnesses,left_role,right_role):
    left = harnesses[left_role]["dependencyResolution"].get("directDependencies", {})
    right = harnesses[right_role]["dependencyResolution"].get("directDependencies", {})
    mismatches = []
    changed = []
    for name in sorted(set(left) | set(right)):
        if name not in left or name not in right or left[name]["declaration"] != right[name]["declaration"]:
            changed.append(name)
        elif any(left[name].get(key) != right[name].get(key) for key in ["resolvedName", "resolvedVersion", "packageJsonSha256", "missingPackageJson"]):
            mismatches.append(name)
    if mismatches:
        raise ValueError("Identical direct dependency declarations resolved differently: " + ", ".join(mismatches))
    inventories = {}
    for arm in [left_role,right_role]:
        inventory = {}
        for package in harnesses[arm]["dependencyResolution"].get("installedPackages", []):
            inventory.setdefault(package["name"], set()).add((package["version"], package["packageJsonSha256"]))
        inventories[arm] = inventory
    transitive_differences = [name for name in sorted(set(inventories[left_role]) | set(inventories[right_role])) if inventories[left_role].get(name) != inventories[right_role].get(name)]
    critical = {"@tscircuit/checks", "circuit-json", "circuit-json-to-connectivity-map", "@tscircuit/math-utils", "graphics-debug", "@tscircuit/pcb-trace-linter"}
    critical_mismatches = [name for name in transitive_differences if name in critical and name not in changed]
    if critical_mismatches:
        raise ValueError("Shared validation/geometry dependency inventories differ: " + ", ".join(critical_mismatches))
    return {"changedDirectDependencyDeclarations": changed,
            "sameDeclarationResolutionMismatchCount": len(mismatches),
            "transitivePackageInventoryDifferences": transitive_differences,
            "limitation": "Transitive package inventories are retained; source has no lockfile. Equal direct declarations are required to resolve to equal package manifests, not asserted to prove complete dependency graph equivalence."}

def compare_dependencies(harnesses):
 require(set(harnesses)==set(ROLES),'Exact three roleharnesses required');return {left+'/'+right:compare_dependency_pair(harnesses,left,right)for left,right in[('N','P'),('N','F'),('P','F')]}

def run(args,m,a):
 shard=select_shard(m,args.dataset,args.shard);output=args.output.resolve();require(not output.exists()or not any(output.iterdir()),'Fresh output required');checkouts={'N':args.native.resolve(),'P':args.original.resolve(),'F':args.fast.resolve()};verify_checkouts(m,a,checkouts);common.verify_dependencies(a,checkouts)
 identities={role:common.pinned.read_identity(path,args.dataset)for role,path in checkouts.items()};require(all(exact(v,identities['N'])for v in identities.values())and{str(v['sampleNumber']):v['inputHash']for v in identities['N']}==a['expectedInputHashesByDataset'][args.dataset],'Original population changed');identity={v['sampleNumber']:v for v in identities['N']};harnesses={role:json.loads((path/'experiment-harness-provenance.json').read_text())for role,path in checkouts.items()}
 for role,h in harnesses.items():require(h.get('checkoutSha')==m['roles'][role]['candidateSha']and h.get('validators')==a['expectedValidatorHashes']and all(h.get(k)==v for k,v in a['expectedHarnessSourceHashes'].items()),'Identical native harness required')
 comparison=compare_dependencies(harnesses);common.pinned.write_json(output/'provenance.json',{'schemaVersion':2,'manifest':m,'manifestSha256':sha(MANIFEST),'shard':shard,'fullOriginalPopulation':identities['N'],'selectedOriginalInputs':[identity[c['sample']]for c in shard['cases']],'harnesses':harnesses,'dependencyComparison':comparison,'githubRunId':os.environ.get('GITHUB_RUN_ID'),'controllerSha':os.environ.get('GITHUB_SHA'),'runAttempt':os.environ.get('GITHUB_RUN_ATTEMPT'),'fullUnionCases':42,'plannedFullUnionAttempts':126,'plannedFullUnionShards':11,'timingsPooledWithPriorCampaigns':False});records=[]
 for ordinal,case in enumerate(shard['cases']):
  for role in case['order']:
   meta=metadata(m,shard,ordinal,role,os.environ.get('GITHUB_RUN_ID'),os.environ.get('GITHUB_SHA'));config=attempt_config(m,a,shard,ordinal,role,meta['runId'],meta['controllerSha']);config_path=output/f"sample-{case['sample']:03d}"/f'config-{role}.json';common.pinned.write_json(config_path,config);print(ACTIVE+json.dumps(meta),flush=True);target=output/f"sample-{case['sample']:03d}"/role
   record=common.pinned.run_sample(checkouts[role],config_path,target,args.dataset,case['sample'],360);record.update(meta,qualificationMode='full-original-population-triplet-shard',scenarioName=identity[case['sample']]['scenarioName']);common.declared.qualify_output(record,target,checkouts[role],a,ROOT,common.pinned.execute_with_deadline);record['phaseCheckpointAudit']=common.checkpoint_audit(target/'raw',config['phaseCheckpoint']);record['pointPairRequirementAudit']=audit_pointpairs(record,target/'raw');record['rawTransitionAudit']=audit_transitions(record,target/'raw')
   try:qualify(record,m,a,shard,ordinal,role,meta['runId'],meta['controllerSha'])
   except Exception as error:record['repeatQualificationError']=str(error);record['strictIntegrityQualified']=False;record['strictIntegrityIssues']=['Triplet attempt qualification failed:'+str(error)]
   records.append(record);common.pinned.write_json(target/'audit-result.json',record)
   with(output/'results.jsonl').open('a')as stream:stream.write(json.dumps(record)+'\n')
   print(RESULT+json.dumps(record,separators=(',',':')),flush=True);common.pinned.write_json(output/'summary.json',summarize(records,shard))
 summary=summarize(records,shard);common.pinned.write_json(output/'summary.json',summary);print(SUMMARY+json.dumps(summary,separators=(',',':')),flush=True);require(summary['populationComplete']and summary['sourceQualifiedRecordCount']==summary['expectedRecords'],'Triplet source population unqualified; every outcome retained')


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
    return {'schemaVersion':2,'campaign':CAMPAIGN,'runId':str(run_id),'controllerSha':controller,'shard':shard,'manifestSha256':sha(MANIFEST),'runtimeSha256':sha(Path(__file__)),'records':records,'summary':summary,'rawLogSha256':hashlib.sha256(text.encode()).hexdigest(),'sourceQualified':True,'requiresFullUnionRawReceiptCount':11,'timingsPooledWithPriorCampaigns':False}

def qualify_union(parsed,m,a,run_id,controller):
 require(len(parsed)==11,'All11 originalshards required');bykey={};records=[];triplets=[];pairs={'N/F':[],'P/F':[]}
 for value in parsed:
  s=obj(value.get('shard'));key=s.get('dataset'),s.get('shardIndex');require(key not in bykey,'Duplicate shard');bykey[key]=value
 require(set(bykey)=={(s['dataset'],s['shardIndex'])for s in m['shards']},'Missing/foreign shard')
 for shard in m['shards']:
  v=bykey[shard['dataset'],shard['shardIndex']];require(exact(v.get('shard'),shard)and v.get('runId')==str(run_id)and v.get('controllerSha')==controller and v.get('manifestSha256')==sha(MANIFEST)and v.get('runtimeSha256')==sha(Path(__file__)),'Foreign triplet authority');rows=v['records'];selected=[(i,role)for i,c in enumerate(shard['cases'])for role in c['order']];require(len(rows)==len(selected),'Incomplete triplet records')
  for row,(i,role)in zip(rows,selected):
   replay=copy.deepcopy(row);qualify(replay,m,a,shard,i,role,run_id,controller);require(all(exact(replay.get(k),row.get(k))for k in['strictIntegrityQualified','strictIntegrityIssues','featureCoverage','durableTimeoutSourceQualification','nonterminalFeatureObservations']),'Forged qualification')
  summary=summarize(rows,shard);require(exact(summary,v['summary'])and summary['populationComplete']and summary['sourceQualifiedRecordCount']==summary['expectedRecords'],'Unqualified triplet population');records.extend(rows);triplets.extend(dict(t,dataset=shard['dataset'],shardIndex=shard['shardIndex'])for t in summary['triplets'])
  for key in pairs:pairs[key].extend(dict(p,dataset=shard['dataset'],shardIndex=shard['shardIndex'])for p in summary['comparisons'][key]['pairs'])
 expected={(d,n,role)for d,count in[('srj18',16),('srj24',26)]for n in range(1,count+1)for role in ROLES};require(len(records)==len(expected)==126 and{(r['dataset'],r['sampleNumber'],r['arm'])for r in records}==expected and len(triplets)==42,'All126 explicit roles required')
 return {'schemaVersion':2,'campaign':CAMPAIGN,'runId':str(run_id),'controllerSha':controller,'manifestSha256':sha(MANIFEST),'recordCount':126,'orderCounts':{order:sum(t['order']==order for t in triplets)for order in PERMUTATIONS},'originalCaseCount':42,'shardCount':11,'sourceQualifiedLogUnion':True,'originalServerZipProofRequired':True,'requiredIndependentRawReceipts':11,'rawByteQualificationClaim':False,'triplets':triplets,'comparisons':{key:{'pairs':rows,'whole':clock_summary(rows,*key.split('/')),'wholeByRelativeOrder':{order:clock_summary([p for p in rows if p['relativeOrder']==order],*key.split('/'))for order in[key.replace('/',''),key.replace('/','')[::-1]]}}for key,rows in pairs.items()},'strictRecordCount':sum(r.get('strictIntegrityQualified')is True for r in records),'timingsPooledWithPriorCampaigns':False,'clockCorrectionApplied':False,'crossArmParityRequired':False}

def main():
 p=argparse.ArgumentParser();p.add_argument('--mode',choices=['plan','select','verify-checkouts','verify-dependencies','run','parse','union'],required=True)
 for role in['native','original','fast']:p.add_argument('--'+role,type=Path)
 p.add_argument('--dataset',choices=['srj18','srj24']);p.add_argument('--shard',type=int);p.add_argument('--output',type=Path);p.add_argument('--job-log',type=Path);p.add_argument('--parsed',action='append',type=Path,default=[]);p.add_argument('--run-id');p.add_argument('--controller-sha');args=p.parse_args();m,a=validate()
 if os.environ.get('GITHUB_ACTIONS')=='true':require(os.environ.get('GITHUB_EVENT_NAME')=='push'and os.environ.get('GITHUB_REF_NAME')==BRANCH and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','Only reviewed first branchpush may run')
 if args.mode=='plan':common.outputs({'matrix':json.dumps({'include':[{'dataset':s['dataset'],'shard':s['shardIndex']}for s in m['shards']]},separators=(',',':'))});return
 if args.mode=='union':require(not args.output.exists(),'Fresh union required');common.pinned.write_json(args.output,qualify_union([json.loads(p.read_text())for p in args.parsed],m,a,args.run_id,args.controller_sha));return
 shard=select_shard(m,args.dataset,args.shard);checkouts={'N':args.native,'P':args.original,'F':args.fast}
 if args.mode=='select':common.outputs({'native_sha':common.MAIN,'original_sha':P_SOURCE,'fast_sha':SOURCE,'harness_sha':common.MAIN})
 elif args.mode=='verify-checkouts':verify_checkouts(m,a,{k:p.resolve()for k,p in checkouts.items()})
 elif args.mode=='verify-dependencies':common.verify_dependencies(a,{k:p.resolve()for k,p in checkouts.items()})
 elif args.mode=='parse':require(not args.output.exists(),'Fresh parsed records required');common.pinned.write_json(args.output,parse_log(args.job_log.read_text(),m,a,shard,args.run_id,args.controller_sha))
 else:run(args,m,a)

if __name__=='__main__':main()
