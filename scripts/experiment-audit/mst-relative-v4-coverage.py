"""Separate source-bound MST ledger and local relative-repair observations."""
import copy,importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('combined_immutable_mst_ledger',ROOT/'layer-aware-mst-coverage.py');mst=importlib.util.module_from_spec(s);s.loader.exec_module(mst)
PATH,FLAG,STAGE=mst.PATH,mst.FLAG,mst.STAGE
RELATIVE_FLAG='experimentRelativeWitnessRepair';RELATIVE_STAGE='relativeWitnessRepairSolver'
QUAL=RELATIVE_STAGE+'.qualification';STATS=RELATIVE_STAGE+'.stats';PROOF=RELATIVE_STAGE+'.relativeProof'
EVIDENCE_PATHS=[PATH,QUAL,STATS,PROOF]
QUAL_FIELDS=['status','localRepaired','accepted','initialFullCertificateStatus','finalFullCertificateStatus','relativeStatus','proposals','beforeGeometryFindings','afterGeometryFindings','protectedUnchanged']
PROOF_FIELDS=['status','reason','bundleCount','boundaryCount','primitivePairs']
obj,same,integer=mst.obj,mst.same,mst.integer

def contract():return mst.contract()
def relative_contract():return {'stageName':RELATIVE_STAGE,'option':RELATIVE_FLAG,'qualificationPath':QUAL,'qualificationFields':QUAL_FIELDS,'statsPath':STATS,'proofPath':PROOF,'proofFields':PROOF_FIELDS,'maximumProposals':16,'maximumStageIterations':20,'observerPaths':EVIDENCE_PATHS,'sourceBoundObservationOnly':True,'globalAcceptedAlwaysFalse':True,'independentBeforeAfterSnapshotAvailable':False,'fullCertificateUnknownNeverPromoted':True,'exactUntargetedMode':'EXACT_UNTARGETED_FINDINGS','exactUntargetedScalarStats':['acceptanceMode','targetFindingCountBefore','targetFindingCountAfter','untargetedFindingsPreserved'],'positiveRemainingFindingsAllowedOnlyInExactUntargetedMode':True}
def project(item):
 value=copy.deepcopy(item);value['evidencePaths']=[PATH];return value

def relative_observation(record,item):
 cp=obj(record.get('phaseCheckpointAudit'));last=obj(cp.get('lastDurableCheckpoint'));audit=obj(obj(obj(record.get('official')).get('routingMetrics')).get('experimentAudit'));terminal=obj(audit.get('evidence'));durable=obj(last.get('evidence'));evidence,source=(terminal,'TERMINAL_FACTORY_AUDIT')if QUAL in terminal else(durable,'DURABLE_PHASE_CHECKPOINT');value=evidence.get(QUAL);stats=evidence.get(STATS);proof=evidence.get(PROOF);q,t,p=obj(value),obj(stats),obj(proof);bound=mst.binding.checkpoint_bound(record,item);requested,observed=obj(record.get('requestedOptions')),obj(last.get('observedRequestedOptions'));baseline=record.get('arm')=='A';issues=[];mechanism=[]
 entered=finished=threw=False
 for row in cp.get('stageBoundaries',[]):
  if row.get('phaseName')==RELATIVE_STAGE:
   entered=True
   if row.get('event')in['phase_failed','lifecycle_throw','step_throw']:threw=True
   if row.get('event')=='on_solved_exit'and not threw:finished=True
  elif entered and row.get('event')=='phase_setup_enter'and not threw:finished=True
 states=['UNINITIALIZED','SEARCHING','NO_PROPOSAL','SEARCH_EXHAUSTED_UNCHANGED','LOCAL_REPAIRED'];full=['PASS','FAIL','UNKNOWN']
 typed=isinstance(value,dict)and set(value)==set(QUAL_FIELDS)and q.get('status')in states and all(type(q.get(key))is bool for key in['localRepaired','accepted','protectedUnchanged'])and all(q.get(key)in full for key in['initialFullCertificateStatus','finalFullCertificateStatus'])and q.get('relativeStatus')in['PASS','UNKNOWN']and integer(q.get('proposals'))and q['proposals']<=16 and all(q.get(key)is None or integer(q.get(key))for key in['beforeGeometryFindings','afterGeometryFindings'])
 stats_typed=isinstance(stats,dict)and t.get('status')in states and integer(t.get('certificateChecks'))and t['certificateChecks']<=17 and integer(t.get('proposalCount'))and t['proposalCount']<=16 and type(t.get('localRepaired'))is bool and type(t.get('globalAccepted'))is bool
 proof_typed=isinstance(proof,dict)and set(proof)==set(PROOF_FIELDS)and p.get('status')in['PASS','UNKNOWN']and isinstance(p.get('reason'),str)and all(integer(p.get(key))for key in['bundleCount','boundaryCount','primitivePairs'])
 coherent=typed and stats_typed and q['status']==t['status']and q['proposals']==t['proposalCount']and q['localRepaired']==t['localRepaired']and q['accepted']is False and t['globalAccepted']is False
 mode=t.get('acceptanceMode');clean=bool(typed and mode is None and integer(q['beforeGeometryFindings'])and q['beforeGeometryFindings']>0 and q['afterGeometryFindings']==0)
 incremental=bool(typed and mode=='EXACT_UNTARGETED_FINDINGS'and type(t.get('targetFindingCountBefore'))is int and t['targetFindingCountBefore']==1 and type(t.get('targetFindingCountAfter'))is int and t['targetFindingCountAfter']==0 and t.get('untargetedFindingsPreserved')is True and integer(q['beforeGeometryFindings'])and integer(q['afterGeometryFindings'])and q['beforeGeometryFindings']==q['afterGeometryFindings']+1 and q['initialFullCertificateStatus']==q['finalFullCertificateStatus']=='UNKNOWN')
 local=bool(bound and finished and not threw and coherent and q['status']=='LOCAL_REPAIRED'and q['localRepaired']is True and q['relativeStatus']=='PASS'and q['protectedUnchanged']is True and(clean or incremental)and 1<=q['proposals']<=16 and proof_typed and p['status']=='PASS')
 if baseline:
  absent=all(evidence.get(path)is None for path in[QUAL,STATS,PROOF])and RELATIVE_FLAG not in requested and RELATIVE_FLAG not in observed
  if not absent:issues.append('Native baseline unexpectedly exposes the relative flag or evidence')
  status='BASELINE_RELATIVE_FEATURE_ABSENT'if absent else'BASELINE_UNEXPECTED_RELATIVE_FEATURE'
 else:
  if requested.get(RELATIVE_FLAG)is not True or observed.get(RELATIVE_FLAG)is not True:issues.append('Actual requested/observed relative flag is not true')
  if not bound:issues.append('Relative observation source/input/checkpoint binding is incomplete')
  if value is not None and not coherent:mechanism.append('Relative qualification/stat scalar projection is not coherent with the unchanged source contract')
  if(finished or obj(record.get('official')).get('didSolve')is True)and not coherent:mechanism.append('Completed pipeline lacks a coherent relative qualification/stat observation')
  if typed and q['status']=='LOCAL_REPAIRED'and not local:mechanism.append('LOCAL_REPAIRED observation lacks all source-local conditions; no local repair attribution')
  status='SOURCE_BOUND_LOCAL_REPAIR_OBSERVATION'if local else'SOURCE_BOUND_UNCHANGED_RELATIVE_OBSERVATION'if bound and finished and coherent and q['status']in['NO_PROPOSAL','SEARCH_EXHAUSTED_UNCHANGED']and q['localRepaired']is False else'PARTIAL_OR_UNKNOWN_RELATIVE_OBSERVATION'
 return {'status':status,'sourceBound':bound,'evidenceSource':source,'stageEntered':entered,'stageCompleted':bool(bound and finished and not threw),'actualQualification':value,'actualScalarStats':stats,'actualScalarRelativeProof':proof,'qualificationTyped':bool(typed),'statsProjectionTyped':bool(stats_typed),'sourceScalarsCoherent':bool(coherent),'localRepairSourceObserved':local,'sourceObservedRepairMode':'EXACT_UNTARGETED_FINDINGS'if local and incremental else'CLEAN_GEOMETRY'if local and clean else None,'exactUntargetedScalarStatsCoherent':incremental,'initialFullCertificateStatus':q.get('initialFullCertificateStatus'),'finalFullCertificateStatus':q.get('finalFullCertificateStatus'),'fullUnknownPreserved':q.get('finalFullCertificateStatus')=='UNKNOWN','issues':issues,'mechanismIssues':mechanism,'independentLocalBeforeAfterOrContactProof':'UNKNOWN_NO_WITHIN_B_PRE_REPAIR_RAW_SNAPSHOT','sourceObservationIsNotIndependentLocalProof':True,'globalElectricalPass':'UNPROVEN','outputOrTimingCredit':False,'qualityOrSpeedClaim':False}

def coverage(record,item):
 if item.get('evidencePaths')!=EVIDENCE_PATHS or not same(item.get('secondaryCoverageContract'),relative_contract()):raise ValueError('Exact four frozen observer paths and separate relative contract required')
 primary=mst.coverage(record,project(item));secondary=relative_observation(record,item);primary['relativeRepairObservation']=secondary;primary['issues'].extend(secondary['issues']);primary['mechanismIssues'].extend(secondary['mechanismIssues']);primary['localRepairTelemetryNeverPromotesFullCertificate']=True;return primary

def nonterminal_observations(record,item):
 values=mst.nonterminal_observations(record,project(item))
 if record.get('arm')=='B':values.append({'relativeRepairObservation':relative_observation(record,item),'outputOrTimingCredit':False,'sourceObservedOnly':True})
 return values

audit_case8=mst.audit_case8
