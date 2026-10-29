"""Pure full84/shard synthetic integrity tests; no solver, boards, timings or network."""
import contextlib,copy,importlib.util,io,json,os,tempfile,types
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
s=importlib.util.spec_from_file_location('pruning_shard_fixture',ROOT/'run-pruning-sharded.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
runtime=r.common
RUN='9001001';HEAD='c'*40
def ledger(item):return {'instances':1,'contextsPruned':1}

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
    record = {"campaign": campaign, "experiment": item["id"], "pr": item["pr"],
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

def make(m,a,shard,ordinal,arm,mode='solved',complete_hd=True,zero=False):
    case=shard['cases'][ordinal];value=record_for(a,m['candidate'],shard['dataset'],case['sample'],arm,mode);value.update(r.metadata(m,shard,ordinal,arm,RUN,HEAD));cp=value['phaseCheckpointAudit'];cp['lastDurableCheckpoint'].update(r.expected_cp(m,shard,ordinal,arm,RUN,HEAD));stage='highDensityRouteSolver'
    events=[('pipeline_constructor_enter',None,None),('pipeline_constructor_exit',None,None),('solve_enter',None,0),('phase_setup_enter',stage,5),('constructor_params_enter',stage,6),('constructor_params_exit',stage,7),('active_subsolver_constructed',stage,8),('phase_run_enter',stage,9)]
    if complete_hd:events += [('on_solved_enter',stage,20),('on_solved_exit',stage,25),('phase_setup_enter','pipeline9JointDrcRepairSolver',30),('constructor_params_enter','pipeline9JointDrcRepairSolver',31),('constructor_params_exit','pipeline9JointDrcRepairSolver',32),('active_subsolver_constructed','pipeline9JointDrcRepairSolver',40),('phase_run_enter','pipeline9JointDrcRepairSolver',41)]
    if mode!='timeout':events += [('on_solved_enter','pipeline9JointDrcRepairSolver',60),('on_solved_exit','pipeline9JointDrcRepairSolver',70),('phase_setup_enter','effortCleanupSolver',75),('solve_exit',None,90)]
    rows=[{'sequence':i,'event':event,'phaseName':phase,'officialStartOffsetMs':stamp,'solved':event=='solve_exit' and mode=='solved','failed':event=='solve_exit' and mode=='native-failure'} for i,(event,phase,stamp) in enumerate(events)];cp['stageBoundaries']=rows;cp['rowCount']=len(rows);cp['lastDurableCheckpoint'].update(rows[-1]);cp['status']['rowsWritten']=len(rows) if mode!='timeout' else 3
    if arm=='B' and zero:
        cp['lastDurableCheckpoint']['evidence'][r.PATH]={'instances':0,'contextsPruned':0}
        audit=(value['official'].get('routingMetrics') or {}).get('experimentAudit')
        if audit:audit['evidence'][r.PATH]={'instances':0,'contextsPruned':0}
    r.qualify(value,m,a,shard,ordinal,arm,RUN,HEAD);return value

def stream(rows,m,shard,summary=None):
    lines=[]
    for row in rows:
        lines.append('2026-10-29T12:00:00Z '+r.ACTIVE+json.dumps(r.metadata(m,shard,row['ordinalWithinShard'],row['arm'],RUN,HEAD)))
        lines.append('2026-10-29T12:00:01Z '+r.RESULT+json.dumps(row))
    lines.append(r.SUMMARY+json.dumps(r.summarize(rows,shard) if summary is None else summary));return '\n'.join(lines)

checks=[]
def checked(label,condition):
    assert condition,label
    checks.append(label)
def rejected(label,fn):
    try:fn()
    except (ValueError,TypeError,KeyError,AttributeError):checks.append(label);return
    raise AssertionError('Accepted forged shard: '+label)

if __name__=='__main__':
    m,a=r.validate();all_parsed=[];mixed_parsed=[]
    for shard in m['shards']:
        rows=[make(m,a,shard,ordinal,arm,zero=case['sample']%3==0) for ordinal,case in enumerate(shard['cases']) for arm in case['order']]
        parsed=r.parse_log(stream(rows,m,shard),m,a,shard,RUN,HEAD);all_parsed.append(parsed);tag=shard['dataset']+':'+str(shard['shardIndex'])
        checked(tag+'exact-record-count',parsed['summary']['populationComplete'] and parsed['summary']['sourceQualifiedRecordCount']==len(shard['cases'])*2)
        checked(tag+'zero-marker-cases-still-clock-qualified',parsed['summary']['whole']['pairCount']==len(shard['cases']))
        checked(tag+'markers-not-inferred-operations',all(p['actualCandidateContextCensus']['workProofKind']=='ACTUAL_PRUNING_CONTEXT_MARKERS' for p in parsed['summary']['pairs']))
        checked(tag+'post-timing-adapter-restored',r.common.feature_coverage.__module__!='actual_pruning_context_census')
        mixed=[]
        for ordinal,case in enumerate(shard['cases']):
            mode='timeout' if shard['dataset']=='srj24' and case['sample'] in [1,3,4,11,18,24] else 'native-failure' if shard['dataset']=='srj24' and case['sample']==13 else 'solved'
            for arm in case['order']:mixed.append(make(m,a,shard,ordinal,arm,mode,complete_hd=case['sample']!=1,zero=case['sample']%3==0))
        mixed_parsed.append(r.parse_log(stream(mixed,m,shard),m,a,shard,RUN,HEAD))
    union=r.qualify_union(all_parsed,m,a,RUN,HEAD)
    checked('full84-exact42-original-union',union['recordCount']==84 and union['originalCaseCount']==42 and union['shardCount']==11)
    checked('prospective21-21-order-count',union['orderCounts']=={'AB':21,'BA':21})
    checked('all42-physical-clock-pairs-including-zero',union['whole']['pairCount']==42 and len(union['contextCaseIdsByActivation']['UNEXERCISED'])==13)
    checked('no-raw-byte-authority-in-log-union',union['rawByteQualificationClaim'] is False and union['requiredIndependentRawReceipts']==11)
    mixed=r.qualify_union(mixed_parsed,m,a,RUN,HEAD)
    checked('mixed84-all-attempts-retained',mixed['recordCount']==84 and mixed['strictRecordCount']==72 and mixed['separatelyCheckpointProvenTimeoutCount']==12)
    checked('mixed-timeouts-failures-not-whole-clock-credit',mixed['whole']['pairCount']==35)
    checked('timeout-flags-stay-false',all(not row['strictIntegrityQualified'] for p in mixed_parsed for row in p['records'] if row['official']['didTimeout']))
    checked('completed-HD-before-later-timeout-retained',any(p['actualCandidateContextCensus']['counterCensusFinal'] and not p['wholeQualityQualified'] for p in mixed['pairs']))
    checked('partial-HD-not-final',any(not p['actualCandidateContextCensus']['counterCensusFinal'] and p['contextActivationClassification']=='PARTIAL_OR_UNKNOWN' for p in mixed['pairs'] if p['sample']==1 and p['dataset']=='srj24'))
    rejected('missing-whole-shard',lambda:r.qualify_union(all_parsed[:-1],m,a,RUN,HEAD))
    rejected('duplicate-shard',lambda:r.qualify_union(all_parsed[:-1]+[all_parsed[0]],m,a,RUN,HEAD))
    for field,bad in [('runId','1'),('controllerSha','d'*40),('manifestSha256','e'*64),('runtimeSha256','f'*64)]:
        changed=copy.deepcopy(all_parsed);changed[0][field]=bad
        rejected('foreign-union-'+field,lambda changed=changed:r.qualify_union(changed,m,a,RUN,HEAD))
    shard=m['shards'][0];rows=copy.deepcopy(all_parsed[0]['records'])
    rejected('per-shard-missing-attempt',lambda:r.parse_log(stream(rows[:-1],m,shard),m,a,shard,RUN,HEAD))
    rejected('per-shard-extra-attempt',lambda:r.parse_log(stream(rows+[rows[0]],m,shard),m,a,shard,RUN,HEAD))
    changed=copy.deepcopy(rows);changed[0],changed[1]=changed[1],changed[0]
    rejected('prospective-arm-order-not-observed',lambda:r.parse_log(stream(changed,m,shard),m,a,shard,RUN,HEAD))
    for field,bad in [('campaign','foreign'),('executionOrder','BA'),('algorithmSha','d'*40),('inputSha256','e'*64),('githubRunId','1'),('controllerSha','f'*40)]:
        changed=copy.deepcopy(rows);changed[0]['phaseCheckpointAudit']['lastDurableCheckpoint'][field]=bad
        rejected('foreign-durable-'+field,lambda changed=changed:r.parse_log(stream(changed,m,shard),m,a,shard,RUN,HEAD))
    for field,bad in [('shardIndex',1),('shardCount',7),('ordinalWithinShard',1),('sampleNumber',2),('dataset','srj24'),('executionOrder','BA')]:
        changed=copy.deepcopy(rows);changed[0][field]=bad
        rejected('foreign-record-'+field,lambda changed=changed:r.parse_log(stream(changed,m,shard),m,a,shard,RUN,HEAD))
    changed=copy.deepcopy(rows);changed[0]['phaseCheckpointAudit']['lastDurableCheckpoint'].pop('inputSha256')
    rejected('missing-durable-identity',lambda:r.parse_log(stream(changed,m,shard),m,a,shard,RUN,HEAD))
    changed=copy.deepcopy(all_parsed);changed[0]['summary']['whole']['weightedBdivA']=.5
    rejected('self-reported-union-clock',lambda:r.qualify_union(changed,m,a,RUN,HEAD))
    changed=copy.deepcopy(rows);changed[1]['official']['routingMetrics']['highDensityIterations']=1
    checked('nonclock-iteration-parity-gates-speed',r.parse_log(stream(changed,m,shard),m,a,shard,RUN,HEAD)['summary']['whole']['pairCount']==3)
    changed=copy.deepcopy(rows);changed[1]['official']['routingMetrics']['experimentAudit']['rawOutputHash']='1'*64
    checked('exact-output-parity-gates-speed',r.parse_log(stream(changed,m,shard),m,a,shard,RUN,HEAD)['summary']['whole']['pairCount']==3)
    changed=copy.deepcopy(rows);changed[1]['official']['routingMetrics']['experimentAudit']['evidence'][r.PATH]['contextsPruned']=True;r.qualify(changed[1],m,a,shard,0,'B',RUN,HEAD)
    parsed=r.parse_log(stream(changed,m,shard),m,a,shard,RUN,HEAD)
    checked('counter-invalid-distinct-from-physical-quality',parsed['summary']['whole']['pairCount']==4 and not parsed['records'][1]['featureCoverage']['counterEvidenceComplete'])
    print(json.dumps({'status':'PASS_FULL84_SHARD_SYNTHETIC_CONTROLS','checks':len(checks),'labels':checks,'syntheticOriginalCases':42,'syntheticAttempts':84,'boardsRouted':0,'networkCalls':0}))

