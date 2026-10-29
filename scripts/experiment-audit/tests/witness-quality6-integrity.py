#!/usr/bin/env python3
"""One pure synthetic integrity test for the selected quality6 controller; no routing/network."""
import ast,copy,importlib.util,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
s=importlib.util.spec_from_file_location('witness_quality6_test',ROOT/'run-witness-quality6.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
s=importlib.util.spec_from_file_location('witness_quality6_mask_test',ROOT/'witness-quality6-raw-proof.py');raw=importlib.util.module_from_spec(s);s.loader.exec_module(raw)
runtime=r.common
RUN='9001001';HEAD='c'*40

def stage_stats():
    return {'activated':True,'status':'NO_PROPOSAL','proposalCount':0,'acceptedCandidateCount':0,'certificateChecks':1,'demandsChecked':2}

def qualification():
    return {'status':'NO_PROPOSAL','initialForeignViaPadFindings':0,'lastForeignViaPadFindings':None,'bestForeignViaPadFindings':0,'proposals':0,'accepted':0,'rejectionClass':'NONE','protectedUnchanged':True,'lastReferenceErrors':0,'lastSrjObstacleViolations':0,'lastViaPadPolicyViolations':0,'lastViaInPadViolations':0,'lastProofReasonCount':0,'lastX':None,'lastY':None,'initialCertificateStatus':'PASS'}

def record_for(manifest, item, dataset, sample, arm, mode="solved"):
    pin = runtime.MAIN if arm == "A" else item["candidateSha"]
    options = copy.deepcopy(manifest["baseline"]["options"] if arm == "A" else item["options"])
    expected_input = manifest["expectedInputHashesByDataset"][dataset][str(sample)]
    campaign = manifest["campaign"] + ":" + item["id"]
    stage = r.STAGE
    evidence = {path: None if arm == "A" or path in r.PATHS[2:] else stage_stats() if path == r.PATHS[0] else qualification() for path in item["evidencePaths"]}
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
    record = {"campaign": campaign, "experiment": item["id"], "sourceIsCurrentPrHead": False,
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


def make(m,a,case,arm,mode='solved'):
    record=record_for(a,m['candidate'],case['dataset'],case['sample'],arm,mode)
    record.update(r.metadata(m,case,arm))
    record['phaseCheckpointAudit']['lastDurableCheckpoint'].update(r.expected_cp(m,case,arm,RUN,HEAD))
    if mode=='native-failure':
        cp=record['phaseCheckpointAudit'];cp['stageBoundaries']=[x for x in cp['stageBoundaries'] if x['event'] not in ['on_solved_enter','on_solved_exit']]
        for i,x in enumerate(cp['stageBoundaries']):x['sequence']=i
        cp['rowCount']=len(cp['stageBoundaries']);cp['lastDurableCheckpoint'].update(cp['stageBoundaries'][-1])
    return r.qualify(record,m,a,case,arm,RUN,HEAD)

def stream(rows,m,case):
    lines=[]
    for row in rows:
        lines += [r.ACTIVE+json.dumps(r.metadata(m,case,row['arm'])),r.RESULT+json.dumps(row)]
    return '\n'.join(lines+[r.SUMMARY+json.dumps(r.summarize(rows,case))])

def main():
    m,a=r.validate();checks=[]
    def rejected(label,fn):
        try:fn()
        except (ValueError,KeyError,TypeError,AssertionError):checks.append(label);return
        raise AssertionError('Accepted forged/unsafe '+label)
    for case in m['cases']:
        rows=[make(m,a,case,arm) for arm in case['order']]
        assert all(x['strictIntegrityQualified'] for x in rows)
        parsed=r.parse_log(stream(rows,m,case),m,a,case,RUN,HEAD)
        assert parsed['sourceQualified'] and parsed['summary']['populationComplete'] and parsed['summary']['noProposalHashAndReportParity'] is True and parsed['wholeOutputQualityCredit'] is False
        checks.append(case['dataset']+':'+str(case['sample'])+' exact-order/source/optional-null/noop')
    case=m['cases'][0];rows=[make(m,a,case,arm) for arm in case['order']]
    for field,value,label in [('sha','d'*40,'wrong-source'),('expectedInputHash','d'*64,'wrong-input'),('executionOrder','BA','wrong-order'),('requestedOptions',{'effort':1},'wrong-options')]:
        bad=copy.deepcopy(rows);bad[0][field]=value
        rejected(label,lambda bad=bad:r.parse_log(stream(bad,m,case),m,a,case,RUN,HEAD))
    rejected('missing-attempt',lambda:r.parse_log(stream(rows[:1],m,case),m,a,case,RUN,HEAD))
    rejected('duplicate-attempt',lambda:r.parse_log(stream(rows+[rows[1]],m,case),m,a,case,RUN,HEAD))
    rejected('foreign-run',lambda:r.parse_log(stream(rows,m,case),m,a,case,'9001002',HEAD))
    rejected('foreign-controller',lambda:r.parse_log(stream(rows,m,case),m,a,case,RUN,'e'*40))
    b=rows[1];e=b['official']['routingMetrics']['experimentAudit']['evidence'];q=e[r.PATHS[1]]
    q.update(initialCertificateStatus='UNKNOWN',initialForeignViaPadFindings=None,bestForeignViaPadFindings=None,rejectionClass='UNSUPPORTED_PROOF')
    r.qualify(b,m,a,case,'B',RUN,HEAD)
    assert b['strictIntegrityQualified'] and b['featureCoverage']['state']=='NO_PROPOSAL' and not b['featureCoverage']['sourceFinalCertificatePassBranch']
    assert r.summarize(rows,case)['noProposalHashAndReportParity'] is True
    checks.append('UNKNOWN-is-noop-not-certificate')
    e[r.PATHS[2]]='Unsupported declared rule';e[r.PATHS[3]]=None
    r.qualify(b,m,a,case,'B',RUN,HEAD);assert b['strictIntegrityQualified'];checks.append('optional-reason-string-or-null')
    del e[r.PATHS[1]]['lastProofReasonCount'];r.qualify(b,m,a,case,'B',RUN,HEAD)
    assert not b['strictIntegrityQualified'];checks.append('completed-missing-required-qualification-rejected')
    rows=[make(m,a,case,arm) for arm in case['order']];b=rows[1];q=b['official']['routingMetrics']['experimentAudit']['evidence'][r.PATHS[1]]
    q.update(status='ACCEPTED',initialCertificateStatus='FAIL',initialForeignViaPadFindings=1,lastForeignViaPadFindings=0,bestForeignViaPadFindings=0,proposals=1,accepted=1,lastX=-.1,lastY=-.2)
    b['official']['routingMetrics']['experimentAudit']['evidence'][r.PATHS[0]].update(status='ACCEPTED',proposalCount=1,acceptedCandidateCount=1)
    b['official']['routingMetrics']['experimentAudit']['rawNewTracesHash']='1'*64
    r.qualify(b,m,a,case,'B',RUN,HEAD)
    assert b['strictIntegrityQualified'] and b['featureCoverage']['sourceFinalCertificatePassBranch']
    summary=r.summarize(rows,case);assert summary['noProposalHashAndReportParity'] is None and not summary['wholeOutputQualityCredit'];checks.append('accepted-changed-hash-retained-not-parity-filtered-negativeXY')
    for mode in ['status-only', 'zero-accepted-with-positive-proposals']:
        forged=make(m,a,case,'B');fe=forged['official']['routingMetrics']['experimentAudit']['evidence']
        fe[r.PATHS[0]]['status']='ACCEPTED';fe[r.PATHS[1]]['status']='ACCEPTED'
        if mode=='zero-accepted-with-positive-proposals':
            fe[r.PATHS[1]].update(initialCertificateStatus='FAIL',initialForeignViaPadFindings=1,lastForeignViaPadFindings=0,bestForeignViaPadFindings=0,proposals=1,lastX=-.1,lastY=-.2)
            fe[r.PATHS[0]]['proposalCount']=1
        r.qualify(forged,m,a,case,'B',RUN,HEAD)
        assert not forged['strictIntegrityQualified'] and not forged['featureCoverage']['sourceFinalCertificatePassBranch']
        checks.append('reject-accepted-status-without-one-accepted-candidate-'+mode)
    q['lastForeignViaPadFindings']=None;r.qualify(b,m,a,case,'B',RUN,HEAD);assert not b['strictIntegrityQualified'];checks.append('unknown-check-count-is-not-zero')
    rows=[make(m,a,case,arm,'native-failure') for arm in case['order']]
    b=rows[1];last=b['phaseCheckpointAudit']['lastDurableCheckpoint'];q=last['evidence'][r.PATHS[1]]
    q.update(status='SEARCH_EXHAUSTED',initialForeignViaPadFindings=1,lastForeignViaPadFindings=0,bestForeignViaPadFindings=0,proposals=4,accepted=0,rejectionClass='SRJ_ENVELOPE',lastSrjObstacleViolations=1,lastX=.1,lastY=.2)
    last['evidence'][r.PATHS[0]].update(status='SEARCH_EXHAUSTED',proposalCount=4,acceptedCandidateCount=0)
    b['official']['routingMetrics']['experimentAudit']['evidence']=copy.deepcopy(last['evidence'])
    r.qualify(b,m,a,case,'B',RUN,HEAD)
    assert b['strictIntegrityQualified'] is True and b['official']['didSolve'] is False and b['featureCoverage']['state']=='SEARCH_EXHAUSTED' and not b['featureCoverage']['sourceFinalCertificatePassBranch']
    assert not r.summarize(rows,case)['wholeOutputQualityCredit'];checks.append('failed-search-witness-removal-retained-without-credit')
    for label,mutate in [('wrong-Bun',lambda x:x['officialReportRuntime'].update(bunVersion='1.4.3')),('missing-seven-check',lambda x:x['supplemental'].pop('boardCopperChecks')),('foreign-sidecar-source',lambda x:x['declaredIntentCopper'].update(sidecarSourceSha256='f'*64)),('foreign-checker-source',lambda x:x['declaredIntentCopper']['checker'].update(moduleSha256='f'*64)),('incomplete-owner',lambda x:x['declaredIntentCopper'].update(ownershipCoverageStatus='UNKNOWN')),('waived-check-coverage',lambda x:x['declaredIntentCopper'].update(allPublishedCopperChecksRun=False))]:
        value=make(m,a,case,'B');mutate(value);r.qualify(value,m,a,case,'B',RUN,HEAD)
        if label=='incomplete-owner':assert not r.common.physical_clean(value)
        else:assert not value['strictIntegrityQualified']
        checks.append(label)
    values=[make(m,a,case,arm) for arm in case['order']];values[1]['controllerError']='Benchmark command exited1'
    r.qualify(values[1],m,a,case,'B',RUN,HEAD)
    parsed=r.parse_log(stream(values,m,case),m,a,case,RUN,HEAD)
    assert len(parsed['records'])==2 and not parsed['sourceQualified'] and not parsed['wholeOutputQualityCredit'];checks.append('nonzero-error-retained-not-relabelled-or-discarded')
    # This fixture was emitted by actual frozen ebeb final-stage source through
    # the unchanged four-path observer on Bun1.4.2, not hand-authored zero counts.
    captured=json.loads((ROOT/'tests/fixtures/witness-quality6-source-unknown.json').read_text())
    assert captured['sourceTree']=='83d39c038ba8bdbb01fc53728e5069fd594d2d23' and captured['runtime']=='1.4.2' and captured['observerErrors']==[] and captured['outputSameObject'] is True
    assert captured['evidence'][r.PATHS[1]]['lastReferenceErrors']==-1
    def unknown_record():
        value=make(m,a,case,'B');value['official']['routingMetrics']['experimentAudit']['evidence']=copy.deepcopy(captured['evidence'])
        value['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence']=copy.deepcopy(captured['evidence'])
        return value
    value=unknown_record();r.qualify(value,m,a,case,'B',RUN,HEAD)
    assert value['strictIntegrityQualified'] and value['featureCoverage']['qualification']['lastReferenceErrors']==-1 and value['featureCoverage']['state']=='NO_PROPOSAL' and not value['featureCoverage']['sourceFinalCertificatePassBranch'] and value['featureCoverage']['qualityCredit'] is False
    pair=[make(m,a,case,'A'),value];assert r.summarize(pair,case)['noProposalHashAndReportParity'] is True and not r.summarize(pair,case)['wholeOutputQualityCredit'];checks.append('actual-source-observer-UNKNOWN-minus1-retained-no-quality-credit')
    for key,new in [('status','SEARCHING'),('status','ACCEPTED'),('initialCertificateStatus','PASS'),('initialCertificateStatus','FAIL'),('proposals',1),('accepted',1),('initialForeignViaPadFindings',0),('lastForeignViaPadFindings',0),('bestForeignViaPadFindings',0),('initialForeignViaPadFindings',-1),('lastForeignViaPadFindings',-1),('bestForeignViaPadFindings',-1),('rejectionClass','NONE'),('protectedUnchanged',False),('lastX',0),('lastY',0),('lastReferenceErrors',-2),('lastSrjObstacleViolations',-1),('lastViaPadPolicyViolations',-1),('lastViaInPadViolations',-1),('lastProofReasonCount',0),('lastProofReasonCount',-1)]:
        value=unknown_record();value['official']['routingMetrics']['experimentAudit']['evidence'][r.PATHS[1]][key]=new;r.qualify(value,m,a,case,'B',RUN,HEAD)
        assert not value['strictIntegrityQualified'],(key,new);checks.append('sentinel-reject-'+key+'-'+str(new))
    for key,new in [('status','SEARCHING'),('proposalCount',1),('acceptedCandidateCount',1),('certificateChecks',0),('certificateChecks',2),('demandsChecked',1),('initialCopperFindingCount',1),('initialCopperFindingCount',False),('initialReferenceErrorCount',0),('initialReferenceErrorCount',-1.0),('initialCertificateStatus','PASS'),('initialOwnershipCoverage','COMPLETE')]:
        value=unknown_record();value['official']['routingMetrics']['experimentAudit']['evidence'][r.PATHS[0]][key]=new;r.qualify(value,m,a,case,'B',RUN,HEAD)
        assert not value['strictIntegrityQualified'],(key,new);checks.append('sentinel-reject-stats-'+key+'-'+str(new))
    # Exact XY-only coupled-site mutation; all material/identity and terminal points protected.
    wire=lambda x,y,layer:{'route_type':'wire','x':x,'y':y,'width':.1,'layer':layer}
    a_tr=[{'pcb_trace_id':'t','connection_name':'N','route':[wire(-1,0,'top'),wire(0,0,'top'),{'route_type':'via','x':0,'y':0,'from_layer':'top','to_layer':'bottom'},wire(0,0,'bottom'),wire(1,0,'bottom')]}]
    b_tr=copy.deepcopy(a_tr)
    for i in [1,2,3]:b_tr[0]['route'][i]['y']=-.2
    via={'type':'pcb_via','pcb_via_id':'via_0','pcb_trace_id':'t','x':0,'y':0,'outer_diameter':.3,'hole_diameter':.15,'layers':['top','inner1','inner2','bottom']}
    ca=[via,{'type':'pcb_smtpad','pcb_smtpad_id':'p','x':5,'y':5},{'type':'pcb_trace','pcb_trace_id':'t','route':copy.deepcopy(a_tr[0]['route'])}];cb=copy.deepcopy(ca);cb[0]['y']=-.2;cb[2]['route']=copy.deepcopy(b_tr[0]['route'])
    owner={'traceOwners':[{'originalId':'t','status':'RESOLVED','owner':'O'}],'allFindings':[{'checkClass':'viaPad','classification':'DECLARED_FOREIGN_COPPER','owners':[{'type':'pcb_via','id':'via_0','owner':'O'},{'type':'pcb_smtpad','id':'p','owner':'P'}]}]}
    original={'layerCount':4,'minViaDiameter':.3,'minViaHoleDiameter':.15,'obstacles':[]}
    proof=raw.mutation_mask(original,a_tr,b_tr,ca,cb,owner,owner)
    assert proof['rawViaOccurrences']==1 and len(proof['changedRawPoints'])==3;checks.append('accepted-exact-fullspan-coupled-mask')
    unsupported=copy.deepcopy(owner);unsupported['allFindings'][0]['classification']='UNKNOWN_OWNERSHIP';rejected('unmapped-foreign-witness',lambda:raw.mutation_mask(original,a_tr,b_tr,ca,cb,unsupported,owner))
    rejected('accepted-zero-mutation',lambda:raw.mutation_mask(original,a_tr,a_tr,ca,ca,owner,owner))
    for label,mutate in [('width-change',lambda x:x[0]['route'][1].update(width=.2)),('endpoint-change',lambda x:x[0]['route'][0].update(y=-.2)),('missing-coupled-wire',lambda x:x[0]['route'][1].update(y=0)),('trace-ID-change',lambda x:x[0].update(pcb_trace_id='different')),('via-span-change',lambda x:x[0]['route'][2].update(to_layer='inner1'))]:
        bad=copy.deepcopy(b_tr);mutate(bad);rejected(label,lambda bad=bad:raw.mutation_mask(original,a_tr,bad,ca,cb,owner,owner))
    bad=copy.deepcopy(cb);bad[1]['x']=6;rejected('protected-pad-change',lambda:raw.mutation_mask(original,a_tr,b_tr,ca,bad,owner,owner))
    rejected('fixed-original-copper',lambda:raw.mutation_mask({**original,'traces':[{}]},a_tr,b_tr,ca,cb,owner,owner))
    for label,mutate in [('explicit-outer-drill-vs-canonical',lambda point:point.update(via_diameter=.6,via_hole_diameter=.3)),('explicit-drill-vs-canonical',lambda point:point.update(via_hole_diameter=.2)),('explicit-nonpositive-diameter',lambda point:point.update(via_diameter=0)),('explicit-drill-over-outer',lambda point:point.update(via_diameter=.3,via_hole_diameter=.4))]:
        aa,bb=copy.deepcopy(a_tr),copy.deepcopy(b_tr)
        mutate(aa[0]['route'][2]);mutate(bb[0]['route'][2]);rejected(label,lambda aa=aa,bb=bb:raw.mutation_mask(original,aa,bb,ca,cb,owner,owner))
    shortca,shortcb=copy.deepcopy(ca),copy.deepcopy(cb);shortca[0]['layers']=['top','bottom'];shortcb[0]['layers']=['top','bottom']
    rejected('throughvia-not-just-two-endpoint-layers',lambda:raw.mutation_mask(original,a_tr,b_tr,shortca,shortcb,owner,owner))
    aa,bb=copy.deepcopy(a_tr),copy.deepcopy(b_tr)
    for tt in [aa,bb]:tt[0]['route'][2].update(from_layer='top',to_layer='inner1',layers=['top','inner1'])
    rejected('blind-fullspan-mismatch',lambda:raw.mutation_mask({**original,'allowBlindAndBuriedVias':True},aa,bb,ca,cb,owner,owner))
    aa,bb=copy.deepcopy(a_tr),copy.deepcopy(b_tr)
    for tt in [aa,bb]:tt[0]['route'][2]['layers']=['top','bottom']
    rejected('blind-explicit-noncontiguous-span',lambda:raw.mutation_mask({**original,'allowBlindAndBuriedVias':True},aa,bb,shortca,shortcb,owner,owner))
    rejected('default-drill-derived-from-pointpair',lambda:raw.mutation_mask(original,a_tr,b_tr,ca,cb,owner,owner,{'minViaHoleDiameter':.2}))
    rejected('unprovable-nonfinite-default',lambda:raw.mutation_mask(original,a_tr,b_tr,ca,cb,owner,owner,{'minViaPadDiameter':float('nan')}))
    rejected('unprovable-null-default',lambda:raw.mutation_mask(original,a_tr,b_tr,ca,cb,owner,owner,{'minViaHoleDiameter':None}))
    assert raw.selected_via_material(original,original,a_tr[0]['route'][2])==(.3,.15,{'top','inner1','inner2','bottom'})
    assert raw.selected_via_material({'layerCount':4},{'minViaPadDiameter':.5,'minViaHoleDiameter':.2},a_tr[0]['route'][2])==(.5,.2,{'top','inner1','inner2','bottom'})
    checks.append('pinned-default-dimensions-and-full-through-span-positive-controls')
    candidate={'featureCoverage':{'qualification':{'initialForeignViaPadFindings':1,'lastX':proof['newXY'][0],'lastY':proof['newXY'][1]}}}
    assert raw.bind_source_proposal(candidate,proof)['bound'] is True;checks.append('source-proposal-exact-exported-XY-positive')
    for key,new in [('lastX',.123),('lastY',.123),('initialForeignViaPadFindings',2)]:
        bad=copy.deepcopy(candidate);bad['featureCoverage']['qualification'][key]=new;rejected('source-proposal-mismatch-'+key,lambda bad=bad:raw.bind_source_proposal(bad,proof))
    # Shared native structural qualifier is byte-identical except additive feature issues.
    def f(path,name):
        text=path.read_text();node=next(x for x in ast.parse(text).body if isinstance(x,ast.FunctionDef) and x.name==name)
        return '\n'.join(text.splitlines()[node.lineno-1:node.end_lineno])
    own=f(ROOT/'run-witness-quality6.py','qualify_record').replace('    problems.extend(record["featureCoverage"]["issues"])\n','')
    assert own==f(ROOT/'run-bottleneck-experiments.py','qualify_record');checks.append('frozen-structural-qualifier-exact-plus-feature-issues')
    for name in ['run_sample','execute_with_deadline']:
        assert name not in {x.name for x in ast.parse((ROOT/'run-witness-quality6.py').read_text()).body if isinstance(x,ast.FunctionDef)}
    workflow=r.WORKFLOW.read_text();assert 'max-parallel: 3\n' in workflow and 'max-parallel: 20\n' in workflow and 'bun-version: 1.4.2' in workflow
    assert 'framed-artifact-log' not in workflow and 'workflow_dispatch' not in workflow;checks.append('unchanged-native-harness-deadlines-originalZIP-only-workflow')
    print(json.dumps({'status':'PASS_QUALITY6_SYNTHETIC_POLICY_SOURCE_OPTIONAL_UNKNOWN_PHYSICAL_MASK_PARITY','checks':checks,'count':len(checks),'realBoards':0,'networkRequests':0}))

if __name__=='__main__':main()
