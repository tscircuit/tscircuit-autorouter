"""One pure semantic full84 union and provenance test; no router/checker/network."""
import copy,importlib.util,json,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
s=importlib.util.spec_from_file_location('mst84_synthetic',ROOT/'run-layer-aware-mst84.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
runtime=r.common
RUN='9001001';HEAD='c'*40
def ledger(item):return dict(completed=True,connectionsProcessed=2,inputPointOccurrences=6,inputDistinctLayerKeys=6,mstCoveredLayerKeys=6,missingLayerKeys=0,coincidentCrossLayerGroups=1,zeroDistanceLayerEdges=1,mstSelectedEdges=4)

def record_for(manifest, item, dataset, sample, arm, mode="solved"):
    pin = runtime.MAIN if arm == "A" else item["candidateSha"]
    options = copy.deepcopy(manifest["baseline"]["options"] if arm == "A" else item["options"])
    expected_input = manifest["expectedInputHashesByDataset"][dataset][str(sample)]
    campaign = manifest["campaign"] + ":" + item["id"]
    stage = item["coverageContract"]["stageName"]
    evidence = {path: None if arm == "A" else ledger(item) if path == item["coverageContract"]["statsPath"] else {} for path in item["evidencePaths"]}
    metadata = {"campaign": campaign, "arm": arm, "algorithmSha": pin,
                "dataset": dataset, "originalSample": sample,
                "inputSha256": expected_input,
                "observerSourceSha256": manifest["runtimeSourceHashes"]["phase-checkpoint-observer.ts"],
                "executionOrder": "BA", "githubRunId": RUN, "controllerSha": HEAD}
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
              "dataset": dataset, "round": 1, "qualificationMode": "full", "executionOrder": "BA",
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

def make(m,a,shard,ordinal,arm,mode='solved',completed_mst=True):
    case=shard['cases'][ordinal];v=record_for(a,m['candidate'],shard['dataset'],case['sample'],arm,mode);v.update(r.metadata(m,shard,ordinal,arm,RUN,HEAD));cp=v['phaseCheckpointAudit'];cp['lastDurableCheckpoint'].update(r.expected_cp(m,shard,ordinal,arm,RUN,HEAD));stage=r.coverage.STAGE
    events=[('pipeline_constructor_enter',None,None),('pipeline_constructor_exit',None,None),('solve_enter',None,0),('phase_setup_enter',stage,5),('constructor_params_enter',stage,6),('constructor_params_exit',stage,7),('active_subsolver_constructed',stage,8),('phase_run_enter',stage,9)]
    if completed_mst:events += [('on_solved_enter',stage,20),('on_solved_exit',stage,25),('phase_setup_enter','highDensityRouteSolver',30),('phase_run_enter','highDensityRouteSolver',31)]
    if mode!='timeout':events += [('phase_setup_enter','effortCleanupSolver',75),('solve_exit',None,90)]
    rows=[dict(sequence=i,event=event,phaseName=phase,officialStartOffsetMs=stamp,solved=event=='solve_exit'and mode=='solved',failed=event=='solve_exit'and mode=='native-failure')for i,(event,phase,stamp)in enumerate(events)];cp['stageBoundaries']=rows;cp['rowCount']=len(rows);cp['lastDurableCheckpoint'].update(rows[-1]);cp['status']['rowsWritten']=len(rows)if mode!='timeout'else 3
    if arm=='B':
        stats=ledger(m['candidate']);stats['completed']=completed_mst;cp['lastDurableCheckpoint']['evidence'][r.PATH]=copy.deepcopy(stats)
        audit=(v['official'].get('routingMetrics')or{}).get('experimentAudit')
        if audit:audit['evidence'][r.PATH]=copy.deepcopy(stats)
        if mode=='solved':
            audit.update(rawOutputHash='1'*64,rawNewTracesHash='2'*64);v['supplemental']['canonicalCircuitJsonSha256']='3'*64;d=v['declaredIntentCopper'];d.update(canonicalSemanticSha256='3'*64,copperGeometrySha256='4'*64,reportSha256='5'*64);d['inputHashes'].update({'raw-new-traces.json':'2'*64,'canonical-circuit-json.json':'3'*64,'point-pair-context.json':'6'*64})
    v['pointPairRequirementAudit']={'status':'UNKNOWN_SYNTHETIC_CONTEXT_NOT_PROVIDED','electricalPass':'UNPROVEN','requiresOriginalServerZipReplay':True}
    return r.qualify(v,m,a,shard,ordinal,arm,RUN,HEAD)

def stream(rows,m,shard,summary=None):
    lines=[]
    for row in rows:lines += [r.ACTIVE+json.dumps(r.metadata(m,shard,row['ordinalWithinShard'],row['arm'],RUN,HEAD)),r.RESULT+json.dumps(row)]
    return '\n'.join(lines+[r.SUMMARY+json.dumps(r.summarize(rows,shard)if summary is None else summary)])

def main():
    m=json.loads(r.MANIFEST.read_text());a=r.common.validate_manifest(r.AUTHORITY);checks=[];all_parsed=[];mixed=[]
    def checked(label,value):assert value,label;checks.append(label)
    def reject(label,fn):
        try:fn()
        except(ValueError,TypeError,KeyError,AttributeError,AssertionError):checks.append(label);return
        raise AssertionError('Accepted forged semantic run '+label)
    for shard in m['shards']:
        rows=[make(m,a,shard,i,arm)for i,c in enumerate(shard['cases'])for arm in c['order']];p=r.parse_log(stream(rows,m,shard),m,a,shard,RUN,HEAD);all_parsed.append(p)
        checked(shard['dataset']+str(shard['shardIndex'])+'-changed-output-accepted',p['summary']['populationComplete']and p['summary']['whole']['pairCount']==len(shard['cases'])and all(not x['crossArmOutputHashEquality']['rawOutputHash']for x in p['summary']['pairs']))
        bad=[]
        for i,c in enumerate(shard['cases']):
            mode='timeout'if shard['dataset']=='srj24'and c['sample']in[1,3,4,11,18,24]else'native-failure'if shard['dataset']=='srj24'and c['sample']==13 else'solved'
            bad.extend(make(m,a,shard,i,arm,mode)for arm in c['order'])
        mixed.append(r.parse_log(stream(bad,m,shard),m,a,shard,RUN,HEAD))
    union=r.qualify_union(all_parsed,m,a,RUN,HEAD);checked('full84-exact42-changed-physical-pairs',union['recordCount']==84 and union['originalCaseCount']==42 and union['whole']['pairCount']==42);checked('prospective21AB21BA',union['orderCounts']=={'AB':21,'BA':21});checked('all11rawproofsrequired',union['requiredIndependentRawReceipts']==11 and union['rawByteQualificationClaim']is False)
    other=r.qualify_union(mixed,m,a,RUN,HEAD);checked('all84-nativefailures-timeouts-kept',other['recordCount']==84 and other['strictRecordCount']==72 and other['separatelyCheckpointProvenTimeoutCount']==12);checked('failures-nophysicalclock-credit',other['whole']['pairCount']==35)
    checked('completedMSTbeforelaterfailure-retained',any(p['candidateMstLedger']['completedMstLogicalCoverageObserved']and not p['wholeQualityQualified']for p in other['pairs']))
    reject('missing-shard',lambda:r.qualify_union(all_parsed[:-1],m,a,RUN,HEAD));reject('duplicate-shard',lambda:r.qualify_union(all_parsed[:-1]+[all_parsed[0]],m,a,RUN,HEAD))
    shard=m['shards'][0];rows=copy.deepcopy(all_parsed[0]['records']);reject('missing-attempt',lambda:r.parse_log(stream(rows[:-1],m,shard),m,a,shard,RUN,HEAD));reject('duplicate-attempt',lambda:r.parse_log(stream(rows+[rows[0]],m,shard),m,a,shard,RUN,HEAD))
    for field,bad in[('runId','1'),('controllerSha','d'*40),('manifestSha256','e'*64),('runtimeSha256','f'*64)]:
        changed=copy.deepcopy(all_parsed);changed[0][field]=bad;reject('foreign-'+field,lambda changed=changed:r.qualify_union(changed,m,a,RUN,HEAD))
    for field,bad in[('campaign','foreign'),('algorithmSha','d'*40),('inputSha256','e'*64),('githubRunId','1'),('controllerSha','f'*40)]:
        changed=copy.deepcopy(rows);changed[0]['phaseCheckpointAudit']['lastDurableCheckpoint'][field]=bad;reject('foreign-checkpoint-'+field,lambda changed=changed:r.parse_log(stream(changed,m,shard),m,a,shard,RUN,HEAD))
    candidate=make(m,a,shard,0,'B');candidate['official']['routingMetrics']['experimentAudit']['evidence'][r.PATH]=None;candidate['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence'][r.PATH]=None;r.qualify(candidate,m,a,shard,0,'B',RUN,HEAD);checked('changed-valid-output-missing-ledger-remains-physical-assessable',candidate['strictIntegrityQualified']and r.common.physical_clean(candidate)and not candidate['featureCoverage']['completedMstLogicalCoverageObserved']and candidate['featureCoverage']['mechanismIssues'])
    with tempfile.TemporaryDirectory()as folder:
        raw=Path(folder);(raw/'original-input.json').write_text('{"connections":');(raw/'point-pair-context.json').write_text('{');result=r.audit_pointpairs({'dataset':'srj24','sampleNumber':8,'expectedInputHash':r.sha(raw/'original-input.json')},raw);checked('partial-malformed-retained-context-UNKNOWN-does-not-abort',result['status']=='UNKNOWN_RETAINED_POINT_PAIR_CONTEXT_UNREADABLE')
    invalid=copy.deepcopy(all_parsed);failed=next(row for row in invalid[0]['records']if row['arm']=='B');d=failed['declaredIntentCopper'];d.update(status='FAIL_FOREIGN_COPPER',qualifiedSupportedCopper=False,knownForeignCopperFindingCount=1,perCheckCounts={name:{key:int(name=='viaPad'and key in['count','knownForeignFindingCount'])for key in['count','knownForeignFindingCount','unknownFindingCount','sameOwnerRuleFindingCount']}for name in r.common.declared.CHECKS});r.qualify(failed,m,a,m['shards'][0],failed['ordinalWithinShard'],'B',RUN,HEAD);invalid[0]=r.parse_log(stream(invalid[0]['records'],m,m['shards'][0]),m,a,m['shards'][0],RUN,HEAD);lost=r.qualify_union(invalid,m,a,RUN,HEAD);checked('source-qualified-physical-foreign-copper-failure-retained-as-loss-no-clock-credit',failed['strictIntegrityQualified']and not r.common.physical_clean(failed)and lost['recordCount']==84 and lost['strictRecordCount']==84 and lost['whole']['pairCount']==41 and lost['identitySets']['srj18']['physical']['lost']==[failed['sampleNumber']])
    with tempfile.TemporaryDirectory()as folder:
        raw=Path(folder);(raw/'original-input.json').write_text('{}');record={'dataset':'srj24','sampleNumber':8,'expectedInputHash':'a'*64}
        for name,auditor in [('pointpair',r.audit_pointpairs),('transition',r.audit_transitions)]:
            value=auditor(record,raw);checked('foreign-retained-original-'+name+'-UNKNOWN-no-mechanism-credit',value['status']=='UNKNOWN_RETAINED_ORIGINAL_INPUT_HASH_MISMATCH'and value['electricalPass']=='UNPROVEN'and value['completedMstLedgerPreservedSeparately'])
    print(json.dumps({'status':'PASS_SEMANTIC_FULL84_CHANGED_OUTPUT_AND_ALL_OUTCOME_PROVENANCE','count':len(checks),'checks':checks,'actualBoards':0,'checkerExecutions':0,'networkRequests':0}))
if __name__=='__main__':main()
