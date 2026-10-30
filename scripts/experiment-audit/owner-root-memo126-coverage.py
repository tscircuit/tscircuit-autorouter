"""Explicit N/P/F source-bound observation; no role aliases or physical-grade invention."""
import copy,importlib.util,json,math,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
old=load('fast126_frozen_feedback',ROOT/'owner-feedback-coverage.py')
obj,same,integer=old.obj,old.same,old.integer
digest=old.mst.binding.digest
SOLVER=old.mst.binding.SOLVER
PATH,FLAG,STAGE=old.PATH,old.FLAG,old.STAGE
FEEDBACK_FLAG,FEEDBACK_PATH=old.FEEDBACK_FLAG,old.FEEDBACK_PATH
COUNTS,FIELDS=old.mst.COUNTS,old.mst.FIELDS
def contract():return old.contract()
def feedback_contract(version):
 fields=old.FIELDS if version==1 else [x if x!='completePredicateSuite'else'completeAdmissionPredicateSuite'for x in old.FIELDS]+['referencePredicateCount']
 return dict(old.feedback_contract(),schemaVersion=version,fields=fields,referencePredicateCount=7 if version==1 else 2,fullAdmissionPredicateCount=7)

def checkpoint_bound(record, item):
    """Bind snapshot attribution to a complete, nonmissing actual source identity."""
    cp = obj(record.get("phaseCheckpointAudit"))
    last = obj(cp.get("lastDurableCheckpoint"))
    status = obj(cp.get("status"))
    rows = cp.get("stageBoundaries")
    identities = [("campaign", "campaign"), ("arm", "arm"), ("algorithmSha", "sha"),
                  ("dataset", "dataset"), ("originalSample", "sampleNumber"),
                  ("inputSha256", "expectedInputHash"), ("executionOrder", "executionOrder"),
                  ("githubRunId", "runId"), ("controllerSha", "controllerSha")]
    present = isinstance(record.get("campaign"), str) and bool(record["campaign"].strip())
    present = present and record.get("arm") in ["N", "P", "F"] and digest(record.get("sha"), 40)
    present = present and record.get("dataset") in ["srj18", "srj24"] and integer(record.get("sampleNumber")) and record["sampleNumber"] > 0
    present = present and digest(record.get("expectedInputHash"), 64) and record.get("executionOrder") in ["NPF", "NFP", "PNF", "PFN", "FNP", "FPN"]
    present = present and isinstance(record.get("runId"), str) and re.fullmatch(r"[1-9][0-9]*", record["runId"]) is not None and digest(record.get("controllerSha"), 40)
    present = present and isinstance(record.get("requestedOptions"), dict)
    if record.get("arm") in ["N", "P", "F"]:
        present = present and digest(item.get("candidateSha"), 40) and record.get("sha") == item["candidateSha"]
    if not present or cp.get("errors") != [] or not all(same(last.get(key), record.get(field)) for key, field in identities):
        return False
    identity = last.get("observedObjectPath") == "solver" and last.get("observedConstructorName") == SOLVER and last.get("actualCacheProviderState") == "disabled"
    identity = identity and same(last.get("observedRequestedOptions"), record["requestedOptions"])
    status_valid = type(status.get("schemaVersion")) is int and status["schemaVersion"] == 1 and status.get("installed") is True and status.get("solveEntered") is True
    status_valid = status_valid and status.get("errors") == [] and status.get("truncated") is False and type(status.get("solveFinished")) is bool
    status_valid = status_valid and digest(last.get("observerSourceSha256"), 64) and status.get("observerSourceSha256") == last["observerSourceSha256"]
    sequence = isinstance(rows, list) and integer(cp.get("rowCount")) and 3 <= cp["rowCount"] <= 256 and len(rows) == cp["rowCount"]
    sequence = sequence and all(isinstance(row, dict) and type(row.get("sequence")) is int and row["sequence"] == index for index, row in enumerate(rows))
    if not sequence:
        return False
    sequence = [row.get("event") for row in rows[:3]] == ["pipeline_constructor_enter", "pipeline_constructor_exit", "solve_enter"]
    boundary_keys = ["sequence", "event", "phaseName", "officialStartOffsetMs", "solved", "failed"]
    sequence = sequence and same({key: last.get(key) for key in boundary_keys}, rows[-1])
    sequence = sequence and integer(status.get("rowsWritten")) and 3 <= status["rowsWritten"] <= len(rows)
    if status.get("solveFinished") is True:
        sequence = sequence and status["rowsWritten"] == len(rows)
    return bool(identity and status_valid and sequence)

def mst_coverage(record, item):
    if item.get('option') != FLAG or item.get('evidencePaths') != [PATH] or not same(item.get('coverageContract'), contract()): raise ValueError('Wrong exact MST option/ledger contract')
    cp = obj(record.get('phaseCheckpointAudit')); last = obj(cp.get('lastDurableCheckpoint'))
    audit = obj(obj(obj(record.get('official')).get('routingMetrics')).get('experimentAudit'))
    terminal, durable = obj(audit.get('evidence')), obj(last.get('evidence'))
    evidence, source = (terminal, 'TERMINAL_FACTORY_AUDIT') if PATH in terminal else (durable, 'DURABLE_PHASE_CHECKPOINT')
    value = evidence.get(PATH); ledger = obj(value); bound = checkpoint_bound(record, item)
    requested, observed = obj(record.get('requestedOptions')), obj(last.get('observedRequestedOptions'))
    issues = []; mechanism_issues = []; baseline = record.get('arm') == 'N'
    absence = value is None and FLAG not in requested and FLAG not in observed
    typed = isinstance(value, dict) and set(value) == set(FIELDS) and type(value.get('completed')) is bool and all(integer(value.get(key)) for key in COUNTS)
    coherent = typed and ledger['inputDistinctLayerKeys'] <= ledger['inputPointOccurrences'] and ledger['mstCoveredLayerKeys'] <= ledger['inputDistinctLayerKeys'] and ledger['missingLayerKeys'] == ledger['inputDistinctLayerKeys'] - ledger['mstCoveredLayerKeys'] and ledger['zeroDistanceLayerEdges'] <= ledger['mstSelectedEdges']
    entered = finished = threw = False
    for row in cp.get('stageBoundaries', []):
        if row.get('phaseName') == STAGE:
            entered = True
            if row.get('event') in ['phase_failed', 'lifecycle_throw', 'step_throw']: threw = True
            if row.get('event') == 'on_solved_exit' and not threw: finished = True
        elif entered and row.get('event') == 'phase_setup_enter' and not threw: finished = True
    if baseline:
        if not absence: issues.append('Native baseline unexpectedly exposes MST flag/ledger')
        status = 'BASELINE_FEATURE_ABSENT' if absence else 'BASELINE_UNEXPECTED_FEATURE'
        final = False
    else:
        if requested.get(FLAG) is not True or observed.get(FLAG) is not True: issues.append('Actual requested/observed MST flag is not true')
        if isinstance(value, dict) and not coherent: mechanism_issues.append('MST ledger is not the exact coherent typed nine-field source schema')
        if (finished or obj(record.get('official')).get('didSolve') is True) and (not coherent or ledger.get('completed') is not True): mechanism_issues.append('Completed MST phase lacks a completed source ledger')
        final = bool(bound and finished and coherent and ledger.get('completed') is True)
        status = 'COMPLETE_MST_REQUIREMENTS_COVERED' if final and ledger['missingLayerKeys'] == 0 else 'COMPLETE_MST_REQUIREMENTS_MISSING' if final else 'PARTIAL_MST_LEDGER' if coherent else 'MST_NOT_REACHED_OR_UNAVAILABLE'
    if not bound: issues.append('MST observation source/input/checkpoint binding is incomplete')
    return {'status': status, 'statsPath': PATH, 'evidenceSource': source, 'sourceBound': bound, 'actualEvidence': evidence, 'issues': issues, 'mechanismIssues': mechanism_issues,
            'stageEntered': entered, 'stageCompleted': bool(final), 'ledgerTypedAndCoherent': bool(coherent), 'ledger': ledger if coherent else None,
            'completedMstLogicalCoverageObserved': bool(final and ledger['missingLayerKeys'] == 0), 'zeroDistanceLayerEdgesObserved': ledger['zeroDistanceLayerEdges'] if coherent else None,
            'intermediateMstMarkerIsNotEmittedDemandOrElectricalProof': True, 'outputOrTimingCredit': False, 'qualityOrSpeedClaim': False}

def feedback_observation(record,item):
 cp=obj(record.get('phaseCheckpointAudit'));last=obj(cp.get('lastDurableCheckpoint'));audit=obj(obj(obj(record.get('official')).get('routingMetrics')).get('experimentAudit'));terminal=obj(audit.get('evidence'));durable=obj(last.get('evidence'));evidence,source=(terminal,'TERMINAL_FACTORY_AUDIT')if FEEDBACK_PATH in terminal else(durable,'DURABLE_PHASE_CHECKPOINT');value=evidence.get(FEEDBACK_PATH);ledger=obj(value);bound=checkpoint_bound(record,item);issues=[];mechanism=[];native=record['arm']=='N';version=item['feedbackVersion'];fields=feedback_contract(version)['fields'];counts=old.COUNTS;admission='completePredicateSuite'if version==1 else'completeAdmissionPredicateSuite'
 typed=isinstance(value,dict)and set(value)==set(fields)and type(ledger.get('version'))is int and ledger['version']==version and ledger.get('enabled')is True and ledger.get('status')in['SUPPORTED','NOT_APPLICABLE']and(ledger.get('reason')is None or isinstance(ledger.get('reason'),str))and ledger.get('originalOwnershipCoverage')in['COMPLETE','UNKNOWN']and type(ledger.get('selectedCheckCount'))is int and ledger['selectedCheckCount']==2 and type(ledger.get(admission))is bool and all(ledger.get(k)is None or integer(ledger[k])for k in counts)and(version==1 or type(ledger.get('referencePredicateCount'))is int and ledger['referencePredicateCount']==2)
 coherent=typed and all(integer(ledger[k])for k in['referenceEvaluations','appendedIssueCount','baselineMatchesFiltered'])and(ledger['status']=='SUPPORTED'and ledger['originalOwnershipCoverage']=='COMPLETE'and ledger[admission]is True and all(integer(ledger[k])for k in counts)or ledger['status']=='NOT_APPLICABLE'and ledger['originalOwnershipCoverage']=='UNKNOWN'and isinstance(ledger['reason'],str)and bool(ledger['reason']))
 if native:
  absent=value is None and FEEDBACK_FLAG not in obj(record.get('requestedOptions'))and FEEDBACK_FLAG not in obj(last.get('observedRequestedOptions'))
  if not absent:issues.append('Native role unexpectedly exposes feedback flag or evidence')
  status='NATIVE_FEEDBACK_ABSENT'if absent else'NATIVE_UNEXPECTED_FEEDBACK'
 else:
  if obj(record.get('requestedOptions')).get(FEEDBACK_FLAG)is not True or obj(last.get('observedRequestedOptions')).get(FEEDBACK_FLAG)is not True:issues.append('Actual feedback options missing')
  if not bound:issues.append('Feedback source/input/checkpoint binding incomplete')
  if value is not None and not coherent:mechanism.append('Feedback ledger lacks exact role-specific coherent scalar projection')
  status='SOURCE_BOUND_SUPPORTED_FEEDBACK'if bound and coherent and not issues and ledger['status']=='SUPPORTED'else'SOURCE_BOUND_NOT_APPLICABLE'if bound and coherent and not issues else'PARTIAL_OR_UNKNOWN_FEEDBACK'
 return {'role':record['arm'],'schemaVersionExpected':None if native else version,'status':status,'sourceBound':bound,'evidenceSource':source,'actualEvidence':value,'ledgerTypedAndCoherent':bool(coherent),'supportedSourceObserved':bool(not native and bound and coherent and not issues and ledger['status']=='SUPPORTED'),'notApplicableFeatureCredit':False,'issues':issues,'mechanismIssues':mechanism,'independentOutputOrContactProof':False,'qualityOrSpeedClaim':False}
def coverage(record,item):
 if item.get('evidencePaths')!=[PATH,FEEDBACK_PATH]or not same(item.get('secondaryCoverageContract'),feedback_contract(item['feedbackVersion'])):raise ValueError('Exact role-specific contract required')
 primary=mst_coverage(record,old.project(item));secondary=feedback_observation(record,item);primary['role']=record['arm'];primary['originalOwnerFeedbackObservation']=secondary;primary['issues'].extend(secondary['issues']);primary['mechanismIssues'].extend(secondary['mechanismIssues']);return primary
def nonterminal_observations(record,item):
 if record['arm']=='N':return []
 value=coverage(record,item);return [{'role':record['arm'],'sourceBound':value['sourceBound'],'ledger':value['ledger'],'completedMstLogicalCoverageObserved':value['completedMstLogicalCoverageObserved'],'feedbackObservation':value['originalOwnerFeedbackObservation'],'outputOrTimingCredit':False,'emittedDemandProof':'REQUIRES_INDEPENDENT_RETAINED_POINT_PAIR_CONTEXT'}]

audit_case8=old.audit_case8
