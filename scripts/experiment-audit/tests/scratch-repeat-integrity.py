"""Pure synthetic repeated populations; no board routing, network or measured timings."""
import contextlib,copy,importlib.util,io,json,os,tempfile,types
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
s=importlib.util.spec_from_file_location('repeat_integrity',ROOT/'run-scratch-repeat.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
runtime=r.common
RUN='9001001';HEAD='c'*40

def ledger(item):
    contract = item["coverageContract"]
    value = {key: 0 for key in contract["countFields"] + contract["timeFields"]}
    if item["id"] == "lazy-hd":
        value.update(lazyHdCandidates=10, lazyHdA01Candidates=6, lazyHdA03Candidates=4,
                     lazyHdEagerCandidates=2, lazyHdDeferredCandidates=8,
                     lazyHdMaterializedCandidates=3, lazyHdDeferredA01Candidates=5,
                     lazyHdDeferredA03Candidates=3, lazyHdMaterializedA01Candidates=2,
                     lazyHdMaterializedA03Candidates=1, lazyHdDeferredGridCells=800,
                     lazyHdDeferredGridStates=1600, lazyHdMaterializedGridCells=300,
                     lazyHdMaterializedGridStates=600, lazyHdBudgetWitnesses=8)
    elif item["id"] == "repair-preparation":
        value.update(preparationCalls=4, preparedInputsBuilt=3, preparedHandoffUses=1,
                     indexedEvaluations=2, referenceEvaluations=1)
    else:
        value.update(searchInstances=1, neighborListsServed=10,
                     neighborScratchBuffersCreated=1, kernelInstances=1,
                     costQueriesServed=10, costScratchFramesCreated=1,
                     costHitRecordsCreated=2, costHitRecordsReused=18,
                     ownerAccumulatorsServed=10, publicHitArraysCreated=0)
    for key in contract["timeFields"]:
        value[key] = 1.25
    return value

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
    runtime.qualify_record(record, manifest, item)
    record["durableTimeoutSourceQualification"] = runtime.timeout_checkpoint_qualification(record)
    record["nonterminalFeatureObservations"] = runtime.coverage_module.nonterminal_observations(record, item)
    return record

def make(m,a,case,pair,arm,mode='solved'):
    item=m['candidate'];value=record_for(a,item,case['dataset'],case['sample'],arm,mode)
    value.update(r.metadata(m,case,pair,arm));value['pairIndex']=pair
    expected=r.expected_cp(m,case,pair,arm,RUN,HEAD)
    value['phaseCheckpointAudit']['lastDurableCheckpoint'].update(expected)
    stage='pipeline9JointDrcRepairSolver'
    events=[('pipeline_constructor_enter',None,None),('pipeline_constructor_exit',None,None),('solve_enter',None,0),
            ('phase_setup_enter','highDensityRouteSolver',5),('constructor_params_exit','highDensityRouteSolver',6),('active_subsolver_constructed','highDensityRouteSolver',8),('phase_run_enter','highDensityRouteSolver',9),('on_solved_enter','highDensityRouteSolver',20),('on_solved_exit','highDensityRouteSolver',25),
            ('phase_setup_enter',stage,30),('constructor_params_enter',stage,31),('constructor_params_exit',stage,32),('active_subsolver_constructed',stage,40),('phase_run_enter',stage,41),('on_solved_enter',stage,60),('on_solved_exit',stage,70),('phase_setup_enter','effortCleanupSolver',75)]
    if mode!='timeout':events.append(('solve_exit',None,90))
    rows=[{'sequence':i,'event':event,'phaseName':phase,'officialStartOffsetMs':stamp,'solved':event=='solve_exit' and mode=='solved','failed':event=='solve_exit' and mode=='native-failure'} for i,(event,phase,stamp) in enumerate(events)]
    cp=value['phaseCheckpointAudit'];cp['stageBoundaries']=rows;cp['rowCount']=len(rows);cp['lastDurableCheckpoint'].update(rows[-1]);cp['status']['rowsWritten']=len(rows) if mode!='timeout' else 3
    r.qualify(value,m,a,case,pair,arm,RUN,HEAD)
    return value

def stream(rows,case,summary=None,active=None):
    active=rows if active is None else active
    lines=[]
    for row,header in zip(rows,active):
        lines.append('2026-10-29T12:00:00Z '+r.ACTIVE+json.dumps(r.metadata(m,case,header['pairIndex'],header['arm'])))
        lines.append('2026-10-29T12:00:01Z '+r.RESULT+json.dumps(row))
    lines.append(r.SUMMARY+json.dumps(r.summarize(rows,case) if summary is None else summary))
    return '\n'.join(lines)

checks=[]
def checked(label,condition):
    assert condition,label
    checks.append(label)
def rejected(label,fn):
    try:fn()
    except (ValueError,TypeError,KeyError,AttributeError):checks.append(label);return
    raise AssertionError('Accepted forged repeated study: '+label)

if __name__=='__main__':
    m,a=r.validate()
    for case in m['cases']:
        rows=[make(m,a,case,pair,arm) for pair,order in enumerate(r.ORDERS,1) for arm in order]
        result=r.parse_log(stream(rows,case),m,a,case,RUN,HEAD);summary=result['summary'];tag=case['dataset']
        checked(tag+'exact8-source-qualified',summary['populationComplete'] and summary['sourceQualifiedRecordCount']==8)
        checked(tag+'four-pairs-no-new-board-credit',summary['wholeQualityQualifiedPairs']==4 and summary['uniqueBoardDenominatorIncrease'] is False)
        checked(tag+'balanced-order-strata',all(summary['wholeByOrder'][order]['pairCount']==2 for order in ['AB','BA']))
        checked(tag+'constructorinclusive-estimators',summary['wholeQualityQualifiedComponentClocks']['Joint.nativeConstructorMs']['wholeQualityQualified']['pairedSumsMs']=={'A':32,'B':32})
        checked(tag+'whole-ownpair-clock',summary['whole']['pairedSumsMs']=={'A':404,'B':404})
        rejected(tag+'missing-record',lambda:r.parse_log(stream(rows[:-1],case),m,a,case,RUN,HEAD))
        rejected(tag+'duplicate-record',lambda:r.parse_log(stream(rows+[rows[0]],case),m,a,case,RUN,HEAD))
        swapped=copy.deepcopy(rows);swapped[0],swapped[1]=swapped[1],swapped[0]
        rejected(tag+'reordered-arm',lambda:r.parse_log(stream(swapped,case),m,a,case,RUN,HEAD))
        for field,bad in [('campaign','foreign'),('executionOrder','BA'),('algorithmSha','b'*40),('githubRunId','1'),('controllerSha','d'*40),('inputSha256','e'*64),('arm','B')]:
            changed=copy.deepcopy(rows);changed[0]['phaseCheckpointAudit']['lastDurableCheckpoint'][field]=bad
            rejected(tag+'foreign-checkpoint-'+field,lambda changed=changed:r.parse_log(stream(changed,case),m,a,case,RUN,HEAD))
        changed=copy.deepcopy(rows);changed[0]['phaseCheckpointAudit']['lastDurableCheckpoint']['campaign']=changed[2]['campaign']
        rejected(tag+'cross-round-census',lambda:r.parse_log(stream(changed,case),m,a,case,RUN,HEAD))
        changed=copy.deepcopy(rows);changed[0]['phaseCheckpointAudit']['lastDurableCheckpoint'].pop('inputSha256')
        rejected(tag+'missing-durable-input',lambda:r.parse_log(stream(changed,case),m,a,case,RUN,HEAD))
        changed=copy.deepcopy(summary);changed['whole']['weightedBdivA']=.5
        rejected(tag+'resealed-summary',lambda:r.parse_log(stream(rows,case,summary=changed),m,a,case,RUN,HEAD))
        changed=copy.deepcopy(rows);changed[0]['strictIntegrityQualified']=False
        rejected(tag+'self-reported-strictflag',lambda:r.parse_log(stream(changed,case),m,a,case,RUN,HEAD))
        mixed=copy.deepcopy(rows);mixed[0]=make(m,a,case,1,'A','timeout');mixed[3]=make(m,a,case,2,'A','native-failure')
        parsed=r.parse_log(stream(mixed,case),m,a,case,RUN,HEAD);sm=parsed['summary']
        checked(tag+'timeout-false-strict-preserved',mixed[0]['strictIntegrityQualified'] is False and len(mixed[0]['strictIntegrityIssues'])==3 and mixed[0]['durableTimeoutSourceQualification']['sourceAndInputProvenByBoundedCheckpoints'])
        checked(tag+'failed-attempts-retained-no-whole-credit',len(parsed['records'])==8 and sm['sourceQualifiedRecordCount']==8 and sm['whole']['pairCount']==2)
        checked(tag+'completed-component-before-failure-retained',sm['pairs'][0]['componentIntervalsMs']['Joint.nativeConstructorMs']=={'A':8,'B':8} and sm['pairs'][0]['wholeClockMs'] is None)
        checked(tag+'later-failure-not-in-target-primary-cohort',sm['wholeQualityQualifiedComponentClocks']['Joint.nativeConstructorMs']['sourceBoundIntervalsRetainedBeforeLaterFailure']==2)
        changed=copy.deepcopy(rows);changed[1]['supplemental']['libraryRoutingChecks']['count']=1;changed[1]['supplemental']['libraryRoutingChecks']['byType']={'pcb_trace_error':1};r.qualify(changed[1],m,a,case,1,'B',RUN,HEAD)
        checked(tag+'detailed-report-facts-before-clock',r.parse_log(stream(changed,case),m,a,case,RUN,HEAD)['summary']['whole']['pairCount']==3)
        changed=copy.deepcopy(rows);changed[1]['official']['routingMetrics']['highDensityIterations']=1
        checked(tag+'iteration-parity-before-clock',r.parse_log(stream(changed,case),m,a,case,RUN,HEAD)['summary']['whole']['pairCount']==3)
        changed=copy.deepcopy(rows);changed[1]['official']['routingMetrics']['experimentAudit']['rawOutputHash']='1'*64
        checked(tag+'output-parity-before-clock',r.parse_log(stream(changed,case),m,a,case,RUN,HEAD)['summary']['whole']['pairCount']==3)
        changed=copy.deepcopy(rows);changed[1]['official']['routingMetrics']['experimentAudit']['evidence'][m['candidate']['evidencePaths'][0]]['neighborListsServed']=True;r.qualify(changed[1],m,a,case,1,'B',RUN,HEAD)
        parsed=r.parse_log(stream(changed,case),m,a,case,RUN,HEAD)
        checked(tag+'invalid-counter-not-fabricated-quality-loss',parsed['summary']['whole']['pairCount']==4 and not parsed['records'][1]['featureCoverage']['counterEvidenceComplete'])
    # Exercise the actual live loop with synthetic child results: one invalid
    # census must be retained and must not suppress the remaining attempts.
    case=m['cases'][0];saved={};seen=[]
    def replace(owner,key,value):saved[owner,key]=getattr(owner,key);setattr(owner,key,value)
    with tempfile.TemporaryDirectory(prefix='scratch-repeat-loop-') as directory:
        temp=Path(directory);paths={arm:temp/arm for arm in 'AB'}
        for arm,path in paths.items():
            path.mkdir();h=dict(a['expectedHarnessSourceHashes'],checkoutSha=runtime.MAIN if arm=='A' else m['candidate']['candidateSha'],validators=a['expectedValidatorHashes']);(path/'experiment-harness-provenance.json').write_text(json.dumps(h))
        identities=[{'sampleNumber':int(n),'inputHash':h,'scenarioName':'synthetic'} for n,h in a['expectedInputHashesByDataset'][case['dataset']].items()]
        def child(checkout,config_path,target,dataset,sample,deadline):
            config=json.loads(config_path.read_text());pair=config['repeatStudy']['pairIndex'];arm=Path(checkout).name;seen.append((pair,arm));value=make(m,a,case,pair,arm)
            if len(seen)==1:value['phaseCheckpointAudit']['lastDurableCheckpoint']['campaign']='foreign-round'
            child.last=value['phaseCheckpointAudit'];return value
        previous={key:os.environ.get(key) for key in ['GITHUB_RUN_ID','GITHUB_SHA']};os.environ['GITHUB_RUN_ID']=RUN;os.environ['GITHUB_SHA']=HEAD
        try:
            replace(runtime,'verify_checkouts',lambda *x:None);replace(runtime,'verify_dependencies',lambda *x:None);replace(runtime.pinned,'read_identity',lambda *x:identities);replace(runtime.pinned,'compare_dependency_resolutions',lambda *x:{'status':'synthetic'});replace(runtime.pinned,'run_sample',child);replace(runtime.declared,'qualify_output',lambda *x:None);replace(runtime,'checkpoint_audit',lambda *x:copy.deepcopy(child.last))
            args=types.SimpleNamespace(dataset=case['dataset'],sample=case['sample'],baseline=paths['A'],candidate=paths['B'],output=temp/'results')
            with contextlib.redirect_stdout(io.StringIO()):rejected('live-invalid-source-population-fails-after-retention',lambda:r.run(args,m,a))
            rows=[json.loads(line) for line in (args.output/'results.jsonl').read_text().splitlines()]
            checked('live-invalid-first-attempt-still-retains-all8',len(rows)==8 and len(seen)==8 and rows[0]['repeatQualificationError'])
            checked('live-exact-balanced-fresh-child-call-order',seen==[(p,arm) for p,order in enumerate(r.ORDERS,1) for arm in order])
        finally:
            for (owner,key),value in saved.items():setattr(owner,key,value)
            for key,value in previous.items():
                if value is None:os.environ.pop(key,None)
                else:os.environ[key]=value
    print(json.dumps({'status':'PASS_SYNTHETIC_SCRATCH_REPEAT16','checks':len(checks),'labels':checks,'actualBoardRuns':0,'networkCalls':0}))
