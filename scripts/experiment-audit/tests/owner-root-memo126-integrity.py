"""One synthetic tripletintegrity control: no actualrouter/checker/network."""
import copy,importlib.util,json,tempfile,types,contextlib,io
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
s=importlib.util.spec_from_file_location('fast126_synthetic_runtime',ROOT/'run-owner-root-memo126.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
runtime=r.common
RUN='9001001';HEAD='c'*40
def synthetic_manifest():
 m=json.loads(r.MANIFEST.read_text());m['roles']['F']['candidateSha']='f'*40
 return m
def ledger(item):return dict(completed=True,connectionsProcessed=2,inputPointOccurrences=6,inputDistinctLayerKeys=6,mstCoveredLayerKeys=6,missingLayerKeys=0,coincidentCrossLayerGroups=1,zeroDistanceLayerEdges=1,mstSelectedEdges=4)
def record_for(manifest, item, dataset, sample, arm, mode="solved"):
    pin = item["candidateSha"]
    options = copy.deepcopy(item["options"])
    expected_input = manifest["expectedInputHashesByDataset"][dataset][str(sample)]
    campaign = manifest["campaign"] + ":" + item["id"]
    stage = item["coverageContract"]["stageName"]
    evidence = {path: None if arm == "N" else ledger(item) if path == item["coverageContract"]["statsPath"] else {} for path in item["evidencePaths"]}
    metadata = {"campaign": campaign, "arm": arm, "algorithmSha": pin,
                "dataset": dataset, "originalSample": sample,
                "inputSha256": expected_input,
                "observerSourceSha256": manifest["runtimeSourceHashes"]["phase-checkpoint-observer.ts"],
                "executionOrder": "NPF", "githubRunId": RUN, "controllerSha": HEAD}
    events = [("pipeline_constructor_enter", None, None),
              ("pipeline_constructor_exit", None, None), ("solve_enter", None, 0),
              ("phase_setup_enter", stage, 10), ("phase_run_enter", stage, 20)]
    if mode != "timeout":
        events += [("on_solved_enter", stage, 60), ("on_solved_exit", stage, 70),
                   ("solve_exit", None, 90)]
    rows = [{**metadata, "sequence": index, "event": event, "phaseName": phase,
             "officialStartOffsetMs": elapsed, "solved": mode == "solved" and event == "solve_exit",
             "failed": mode == "native-failure" and event == "solve_exit"}
            for index, (event, phase, elapsed) in enumerate(events)]
    last = {**rows[-1], "observedObjectPath": "solver",
            "observedConstructorName": runtime.SOLVER, "actualCacheProviderState": "disabled",
            "observedRequestedOptions": copy.deepcopy(options), "evidence": copy.deepcopy(evidence)}
    fields = ["sequence", "event", "phaseName", "officialStartOffsetMs", "solved", "failed"]
    checkpoint = {"errors": [], "rowCount": len(rows), "lastDurableCheckpoint": last,
                  "stageBoundaries": [{key: row[key] for key in fields} for row in rows],
                  "status": {"schemaVersion": 1, "observerSourceSha256": metadata["observerSourceSha256"],
                             "installed": True, "solveEntered": True, "solveFinished": mode != "timeout",
                             "errors": [], "truncated": False}}
    elapsed = 360000 if mode == "timeout" else 100
    audit = {"inputHash": expected_input, "inputMutated": False, "options": copy.deepcopy(options),
             "actualCacheProviderState": "disabled", "actualConstructorName": runtime.SOLVER,
             "actualSolverName": runtime.SOLVER, "solverModule": runtime.MODULE,
             "solverSolved": mode == "solved", "solverFailed": mode == "native-failure",
             "solverError": "Preserved native failure" if mode == "native-failure" else None,
             "constructorTimeMs": 1, "rawOutputHash": "0" * 64,
             "rawNewTracesHash": "0" * 64, "evidence": copy.deepcopy(evidence)}
    record = {"campaign": campaign, "experiment": item["id"],
              "dataset": dataset, "round": 1, "qualificationMode": "full", "executionOrder": "NPF",
              "sampleNumber": sample, "arm": arm, "requestedOptions": options,
              "expectedInputHash": expected_input, "sha": pin, "solverName": runtime.SOLVER,
              "externalBenchmarkProcessWallMs": elapsed + 200, "controllerError": None,
              "supplementalValidationError": None, "declaredIntentValidationError": None,
              "phaseCheckpointAudit": checkpoint,
              "officialReportRuntime": {"threadsPerSample": 1, "effectiveThreadsPerSample": 1,
                                        "cpuBudgetPerSample": 1, "requestedConcurrency": 1,
                                        "workerCount": 1, "bunVersion": "1.4.2"},
              "official": {"solverName": runtime.SOLVER, "sampleNumber": sample,
                           "sampleTimeoutMs": 360000, "didSolve": mode == "solved",
                           "didTimeout": mode == "timeout", "relaxedDrcPassed": mode == "solved",
                           "elapsedTimeMs": elapsed,
                           "routingMetrics": None if mode == "timeout" else {"experimentAudit": audit}}}
    if mode == "solved":
        record["supplemental"] = {name: {"count": 0, "byType": {}} for name in runtime.CHECKS}
        record["supplemental"].update(canonicalCircuitJsonSha256="0" * 64,
                                    physicalCopper={"combinedRouteViaCount": 0,
                                                    "uniqueOwnedViaSiteSpanCount": 0,
                                                    "uniqueOwnedManufacturedViaSiteCount": 0,
                                                    "foreignOwnerCoincidentViaSiteSpans": 0,
                                                    "combinedRoutePointCount": 2,
                                                    "combinedCopperLength": 1.0,
                                                    "exactSegmentDeduplicatedCopperLength": 1.0})
        record["declaredIntentCopper"] = {"schemaVersion": 2, "status": "PASS",
                                           "qualifiedSupportedCopper": True,
                                           "ownershipCoverageStatus": "COMPLETE",
                                           "allPublishedCopperChecksRun": True,
                                           "checksRun": sorted(runtime.declared.CHECKS),
                                           "geometryUnchanged": True, "exactRetainedInputBytesVerified": True,
                                           "canonicalSemanticSha256": "0" * 64,
                                           "copperGeometrySha256": "0" * 64,
                                           "reportSha256": "0" * 64, "findingInventorySha256": "0" * 64,
                                           "sidecarSourceSha256": runtime.DECLARED_SOURCE_SHA256,
                                           "checker": {"moduleSha256": runtime.CHECKER_SOURCE_SHA256,
                                                       "version": "0.0.259"},
                                           "inputHashes": {name: expected_input if name == "original-input.json" else "0" * 64 for name in runtime.declared.INPUTS},
                                           "originalObstacleCoverage": {"unmappedDeclaredCopperCount": 0},
                                           **{key: 0 for key in runtime.declared.COUNTS}}
    return record

def make(m,a,shard,ordinal,role,mode='solved'):
 item=m['roles'][role];case=shard['cases'][ordinal];v=record_for(a,item,shard['dataset'],case['sample'],role,mode);v.update(r.metadata(m,shard,ordinal,role,RUN,HEAD));cp=v['phaseCheckpointAudit'];cp['lastDurableCheckpoint'].update(r.expected_cp(m,shard,ordinal,role,RUN,HEAD));cp['status']['rowsWritten']=cp['rowCount']
 if role!='N':
  cold={'version':item['feedbackVersion'],'enabled':True,'status':'SUPPORTED','reason':None,'originalOwnershipCoverage':'COMPLETE','selectedCheckCount':2,'completePredicateSuite':True,'baselineIssueCount':0,'initialIssueCount':2,'referenceEvaluations':5,'appendedIssueCount':2,'baselineMatchesFiltered':0,'unsupportedOwnerCount':0,'latestIssueCount':0}
  if item['feedbackVersion']==2:cold['completeAdmissionPredicateSuite']=cold.pop('completePredicateSuite');cold['referencePredicateCount']=2
  cp['lastDurableCheckpoint']['evidence'][r.FEEDBACK_PATH]=copy.deepcopy(cold)
  audit=(v['official'].get('routingMetrics')or{}).get('experimentAudit')
  if audit:audit['evidence'][r.FEEDBACK_PATH]=copy.deepcopy(cold)
 # Distinct valid copper/pointpair identities areoutcomes, no crossroleparitygate.
 if mode=='solved':
  marker={'N':'0','P':'1','F':'2'}[role];audit=v['official']['routingMetrics']['experimentAudit'];audit['rawOutputHash']=marker*64
 v['pointPairRequirementAudit']={'status':'UNKNOWN_SYNTHETIC_CONTEXT_NOT_PROVIDED','electricalPass':'UNPROVEN','requiresOriginalServerZipReplay':True};v['rawTransitionAudit']={'status':'UNKNOWN_SYNTHETIC_CONTEXT_NOT_PROVIDED','electricalPass':'UNPROVEN'}
 return r.qualify(v,m,a,shard,ordinal,role,RUN,HEAD)
def stream(rows,m,shard):
 lines=[]
 for v in rows:lines.extend([r.ACTIVE+json.dumps(r.metadata(m,shard,v['ordinalWithinShard'],v['arm'],RUN,HEAD)),r.RESULT+json.dumps(v)])
 return '\n'.join(lines+[r.SUMMARY+json.dumps(r.summarize(rows,shard))])
def main():
 m=synthetic_manifest();a=r.common.validate_manifest(r.AUTHORITY);checks=[];parsed=[];mixed=[]
 def checked(label,v):assert v,label;checks.append(label)
 def reject(label,fn):
  try:fn()
  except(ValueError,TypeError,KeyError,AttributeError,AssertionError):checks.append(label);return
  raise AssertionError('Accepted forgedtriplet '+label)
 for shard in m['shards']:
  rows=[make(m,a,shard,i,role)for i,c in enumerate(shard['cases'])for role in c['order']];p=r.parse_log(stream(rows,m,shard),m,a,shard,RUN,HEAD);parsed.append(p);checked(shard['dataset']+str(shard['shardIndex'])+'-allroles-qualified',p['summary']['populationComplete']and p['summary']['sourceQualifiedRecordCount']==len(rows)and all(p['summary']['comparisons'][key]['whole']['matchedPhysicalCleanCases']==len(shard['cases'])for key in['N/F','P/F']))
  bad=[]
  for i,c in enumerate(shard['cases']):
   mode='timeout'if shard['dataset']=='srj24'and c['sample']in[1,3,4,11,18,24]else'native-failure'if shard['dataset']=='srj24'and c['sample']==13 else'solved';bad.extend(make(m,a,shard,i,role,mode)for role in c['order'])
  mixed.append(r.parse_log(stream(bad,m,shard),m,a,shard,RUN,HEAD))
 union=r.qualify_union(parsed,m,a,RUN,HEAD);checked('126freshroles42cases11shards',union['recordCount']==126 and len(union['triplets'])==42 and union['requiredIndependentRawReceipts']==11 and union['rawByteQualificationClaim']is False);checked('sixpermutations7each',union['orderCounts']=={o:7 for o in r.PERMUTATIONS})
 for key in['N/F','P/F']:
  values=union['comparisons'][key]['pairs'];checked(key+'-pairorder21each',{o:sum(p['relativeOrder']==o for p in values)for o in[key.replace('/',''),key.replace('/','')[::-1]]}=={key.replace('/',''):21,key.replace('/','')[::-1]:21});checked(key+'-all42matchedvalid',union['comparisons'][key]['whole']['matchedPhysicalCleanCases']==42)
 other=r.qualify_union(mixed,m,a,RUN,HEAD);checked('failures-timeouts-all126-retained',other['recordCount']==126 and other['strictRecordCount']==108);checked('18durabletimeouts-retained',sum(r.source_qualified(v)and v['official']['didTimeout']is True for p in mixed for v in p['records'])==18);checked('invalidoutputs-noclockcredit',all(other['comparisons'][key]['whole']['matchedPhysicalCleanCases']==35 for key in['N/F','P/F']))
 reject('missing-shard',lambda:r.qualify_union(parsed[:-1],m,a,RUN,HEAD));reject('duplicate-shard',lambda:r.qualify_union(parsed[:-1]+[parsed[0]],m,a,RUN,HEAD));shard=m['shards'][0];rows=copy.deepcopy(parsed[0]['records'])
 for label,values in[('missingrole',rows[:-1]),('duplicaterole',rows+[rows[0]]),('reorderedroles',rows[::-1])]:reject(label,lambda values=values:r.parse_log(stream(values,m,shard),m,a,shard,RUN,HEAD))
 for field,bad in[('runId','1'),('controllerSha','d'*40),('manifestSha256','e'*64),('runtimeSha256','f'*64)]:
  changed=copy.deepcopy(parsed);changed[0][field]=bad;reject('foreign-'+field,lambda changed=changed:r.qualify_union(changed,m,a,RUN,HEAD))
 for role in r.ROLES:
  for field,bad in[('campaign','foreign'),('algorithmSha','d'*40),('inputSha256','e'*64),('githubRunId','1'),('controllerSha','f'*40),('arm','A'),('executionOrder','AB')]:
   v=make(m,a,shard,0,role);v['phaseCheckpointAudit']['lastDurableCheckpoint'][field]=bad;reject(role+'-checkpoint-'+field,lambda v=v,role=role:r.qualify(v,m,a,shard,0,role,RUN,HEAD))
  v=make(m,a,shard,0,role);v['official']['routingMetrics']['experimentAudit']['options']['effort']=2;r.qualify(v,m,a,shard,0,role,RUN,HEAD);checked(role+'-actualoptionmismatch-rejected',not v['strictIntegrityQualified'])
 for role in['P','F']:
  v=make(m,a,shard,0,role);v['official']['routingMetrics']['experimentAudit']['evidence'][r.FEEDBACK_PATH]['version']=1;r.qualify(v,m,a,shard,0,role,RUN,HEAD);checked(role+'-wrongcoldschema-no-mechanism-credit',v['featureCoverage']['originalOwnerFeedbackObservation']['supportedSourceObserved']is False and v['featureCoverage']['mechanismIssues'])
  v=make(m,a,shard,0,role);d=v['declaredIntentCopper'];d.update(status='FAIL_FOREIGN_COPPER',qualifiedSupportedCopper=False,knownForeignCopperFindingCount=1,perCheckCounts={name:{key:int(name=='viaPad'and key in['count','knownForeignFindingCount'])for key in['count','knownForeignFindingCount','unknownFindingCount','sameOwnerRuleFindingCount']}for name in r.common.declared.CHECKS});r.qualify(v,m,a,shard,0,role,RUN,HEAD);checked(role+'-realphysicalregression-retained',v['strictIntegrityQualified']and not r.common.physical_clean(v))
 # Exercise unchanged logical helper through new24:8 API with allsix distinct originalidentities.
 req=json.loads((ROOT/'layer-aware-mst-case8-terminal-requirements.json').read_text());conns={};pairs=[]
 for i,e in enumerate(req['sixDroppedDemands']):
  name=e['original'][0]['connection'];points=[copy.deepcopy(v['point'])for v in e['original']];conns.setdefault(name,{'name':name,'pointsToConnect':[]})['pointsToConnect'].extend(points);pairs.append({'name':name+'_synthetic'+str(i),'__rootConnectionNames':[name],'pointsToConnect':points})
 for c in conns.values():c['pointsToConnect']=list({p['pointId']:p for p in c['pointsToConnect']}.values())
 checked('newcoverage-exactfrozen-sixlogical-helper',r.coverage.audit_case8({'connections':list(conns.values())},{'connections':pairs},req)['retained']==6)
 harness={'dependencyResolution':{'directDependencies':{},'installedPackages':[]}};hs={role:copy.deepcopy(harness)for role in r.ROLES};checked('three-role-dependencies-all3pairs',set(r.compare_dependencies(hs))=={'N/P','N/F','P/F'})
 hs['F']['dependencyResolution']['directDependencies']={'same':{'declaration':'1','resolvedName':'x'}};hs['P']['dependencyResolution']['directDependencies']={'same':{'declaration':'1','resolvedName':'y'}};reject('same-declaration-resolution-mismatch',lambda:r.compare_dependencies(hs))
 # Run-level synthetic transport: all126 fresh calls across11shards, no router/checker invoked.
 total_calls=[];timeout_calls=[];failure_calls=[]
 with tempfile.TemporaryDirectory()as folder:
  base=Path(folder);checkouts={role:base/role for role in r.ROLES}
  for role,path in checkouts.items():
   path.mkdir();(path/'experiment-harness-provenance.json').write_text(json.dumps(dict(a['expectedHarnessSourceHashes'],checkoutSha=m['roles'][role]['candidateSha'],validators=a['expectedValidatorHashes'],dependencyResolution=harness['dependencyResolution'])))
  for run_shard in m['shards']:
   dataset=run_shard['dataset'];identities=[{'sampleNumber':n,'inputHash':a['expectedInputHashesByDataset'][dataset][str(n)],'scenarioName':'synthetic'}for n in range(1,r.common.COUNTS[dataset]+1)]
   def mode(sample,role):
    if dataset=='srj24'and sample in[1,3,4,11,18,24]:return'timeout'
    if dataset=='srj24'and(sample==13 or sample==14 and role in['P','F']):return'native-failure'
    return'solved'
   pending=[make(m,a,run_shard,i,role,mode(c['sample'],role))for i,c in enumerate(run_shard['cases'])for role in c['order']];calls=[];current={};saved=[]
   def patch(obj,name,value):saved.append((obj,name,getattr(obj,name)));setattr(obj,name,value)
   def sample(path,config,target,dataset,n,timeout):
    value=copy.deepcopy(pending[len(calls)]);calls.append(value['arm']);total_calls.append((dataset,n,value['arm']));current['v']=value;assert timeout==360;assert json.loads(config.read_text())['role']==value['arm']
    if value['official']['didTimeout']:timeout_calls.append((dataset,n,value['arm']))
    if value['official']['routingMetrics']and value['official']['routingMetrics']['experimentAudit']['solverFailed']:failure_calls.append((dataset,n,value['arm']))
    return value
   patch(r,'verify_checkouts',lambda *args:None);patch(r.common,'verify_dependencies',lambda *args:None);patch(r.common.pinned,'read_identity',lambda *args:identities);patch(r.common.pinned,'run_sample',sample);patch(r.common.declared,'qualify_output',lambda *args:None);patch(r.common,'checkpoint_audit',lambda *args:current['v']['phaseCheckpointAudit']);patch(r,'audit_pointpairs',lambda *args:current['v']['pointPairRequirementAudit']);patch(r,'audit_transitions',lambda *args:current['v']['rawTransitionAudit']);patch(r.os,'environ',dict(r.os.environ,GITHUB_RUN_ID=RUN,GITHUB_SHA=HEAD,GITHUB_RUN_ATTEMPT='1'))
   try:
    output=base/('out-'+dataset+'-'+str(run_shard['shardIndex']))
    with contextlib.redirect_stdout(io.StringIO()):r.run(types.SimpleNamespace(dataset=dataset,shard=run_shard['shardIndex'],output=output,native=checkouts['N'],original=checkouts['P'],fast=checkouts['F']),m,a)
    checked('actualrun-transport-'+dataset+'-'+str(run_shard['shardIndex'])+'-everyrole',calls==[role for c in run_shard['cases']for role in c['order']]and json.loads((output/'summary.json').read_text())['sourceQualifiedRecordCount']==len(calls))
   finally:
    for obj,name,value in reversed(saved):setattr(obj,name,value)
 checked('actualrun-all126-freshcalls-all42-original-case-roles',len(total_calls)==126 and len(set(total_calls))==126)
 checked('actualrun-18timeouts5finitefailures-retained',len(timeout_calls)==18 and len(failure_calls)==5)
 print(json.dumps({'status':'PASS_EXPLICIT_N_P_F_126_SOURCE_OUTCOME_PROVENANCE_AND_RUN_TRANSPORT','count':len(checks),'checks':checks,'actualBoards':0,'checkerExecutions':0,'networkRequests':0,'syntheticFreshProcessCalls':len(total_calls),'syntheticTimeoutCalls':len(timeout_calls),'syntheticFiniteFailureCalls':len(failure_calls)}))
if __name__=='__main__':main()
