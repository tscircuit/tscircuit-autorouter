"""Separate original-MST logical ledger and source-bound strict feedback counters."""
import copy,importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('feedback_primary_mst',ROOT/'layer-aware-mst-coverage.py');mst=importlib.util.module_from_spec(s);s.loader.exec_module(mst)
PATH,FLAG,STAGE=mst.PATH,mst.FLAG,mst.STAGE
FEEDBACK_FLAG='experimentOriginalOwnerCopperFeedback'
FEEDBACK_PATH='pipeline9JointDrcRepairSolver.stats.originalOwnerCopperFeedback'
FIELDS=['version','enabled','status','reason','originalOwnershipCoverage','selectedCheckCount','completePredicateSuite','baselineIssueCount','initialIssueCount','referenceEvaluations','appendedIssueCount','baselineMatchesFiltered','unsupportedOwnerCount','latestIssueCount']
COUNTS=['baselineIssueCount','initialIssueCount','referenceEvaluations','appendedIssueCount','baselineMatchesFiltered','unsupportedOwnerCount','latestIssueCount']
obj,same,integer=mst.obj,mst.same,mst.integer
def contract():return mst.contract()
def feedback_contract():return {'statsPath':FEEDBACK_PATH,'option':FEEDBACK_FLAG,'fields':FIELDS,'selectedPredicates':['viaTrace','traceOverlap'],'notApplicableIsNotFeatureCredit':True,'sourceBoundObservationOnly':True,'independentOutputGradeRequired':True}
def project(item):
 value=copy.deepcopy(item);value['evidencePaths']=[PATH];return value
def feedback_observation(record,item):
 cp=obj(record.get('phaseCheckpointAudit'));last=obj(cp.get('lastDurableCheckpoint'));audit=obj(obj(obj(record.get('official')).get('routingMetrics')).get('experimentAudit'));terminal=obj(audit.get('evidence'));durable=obj(last.get('evidence'));evidence,source=(terminal,'TERMINAL_FACTORY_AUDIT')if FEEDBACK_PATH in terminal else(durable,'DURABLE_PHASE_CHECKPOINT');value=evidence.get(FEEDBACK_PATH);ledger=obj(value);requested,observed=obj(record.get('requestedOptions')),obj(last.get('observedRequestedOptions'));bound=mst.binding.checkpoint_bound(record,item);issues=[];mechanism=[];baseline=record.get('arm')=='A'
 typed=isinstance(value,dict)and set(value)==set(FIELDS)and type(ledger.get('version'))is int and ledger['version']==1 and ledger.get('enabled')is True and ledger.get('status')in['SUPPORTED','NOT_APPLICABLE']and(ledger.get('reason')is None or isinstance(ledger.get('reason'),str))and ledger.get('originalOwnershipCoverage')in['COMPLETE','UNKNOWN']and type(ledger.get('selectedCheckCount'))is int and ledger['selectedCheckCount']==2 and type(ledger.get('completePredicateSuite'))is bool and all(ledger.get(k)is None or integer(ledger[k])for k in COUNTS)
 coherent=typed and all(integer(ledger[k])for k in['referenceEvaluations','appendedIssueCount','baselineMatchesFiltered'])and(ledger['status']=='SUPPORTED'and ledger['originalOwnershipCoverage']=='COMPLETE'and ledger['completePredicateSuite']is True and all(integer(ledger[k])for k in COUNTS)or ledger['status']=='NOT_APPLICABLE'and ledger['originalOwnershipCoverage']=='UNKNOWN'and isinstance(ledger['reason'],str)and bool(ledger['reason']))
 if baseline:
  absent=value is None and FEEDBACK_FLAG not in requested and FEEDBACK_FLAG not in observed
  if not absent:issues.append('Native baseline unexpectedly exposes feedback flag or evidence')
  status='BASELINE_FEEDBACK_ABSENT'if absent else'BASELINE_UNEXPECTED_FEEDBACK'
 else:
  if requested.get(FEEDBACK_FLAG)is not True or observed.get(FEEDBACK_FLAG)is not True:issues.append('Actual requested/observed feedback flag is not true')
  if not bound:issues.append('Feedback observation source/input/checkpoint binding incomplete')
  if value is not None and not coherent:mechanism.append('Feedback ledger lacks exact coherent fourteen-field source projection')
  status='SOURCE_BOUND_SUPPORTED_FEEDBACK'if bound and coherent and not issues and ledger['status']=='SUPPORTED'else'SOURCE_BOUND_NOT_APPLICABLE'if bound and coherent and not issues else'PARTIAL_OR_UNKNOWN_FEEDBACK'
 return {'status':status,'sourceBound':bound,'evidenceSource':source,'actualEvidence':value,'ledgerTypedAndCoherent':bool(coherent),'supportedSourceObserved':bool(not baseline and bound and coherent and not issues and ledger['status']=='SUPPORTED'),'notApplicableFeatureCredit':False,'issues':issues,'mechanismIssues':mechanism,'independentOutputOrContactProof':False,'qualityOrSpeedClaim':False}
def coverage(record,item):
 if item.get('evidencePaths')!=[PATH,FEEDBACK_PATH]or not same(item.get('secondaryCoverageContract'),feedback_contract()):raise ValueError('Exact two frozen feedback evidence paths/contracts required')
 primary=mst.coverage(record,project(item));secondary=feedback_observation(record,item);primary['originalOwnerFeedbackObservation']=secondary;primary['issues'].extend(secondary['issues']);primary['mechanismIssues'].extend(secondary['mechanismIssues']);return primary
def nonterminal_observations(record,item):
 values=mst.nonterminal_observations(record,project(item))
 if record.get('arm')=='B':values.append({'feedbackObservation':feedback_observation(record,item),'outputOrTimingCredit':False})
 return values
audit_case8=mst.audit_case8
