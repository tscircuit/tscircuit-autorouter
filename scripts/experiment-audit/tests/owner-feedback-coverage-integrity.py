"""One source-observation control; no real boards, source solvers or predicates."""
import copy,importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
r=load('feedback_observation_test_runtime',ROOT/'run-owner-feedback4.py');f=load('feedback_observation_immutable_fixture',ROOT/'tests/layer-aware-mst84-integrity.py');f.r=r;f.runtime=r.common
def main():
 m=json.loads(r.MANIFEST.read_text());a=r.common.validate_manifest(r.AUTHORITY);shard=m['shards'][0];checks=[]
 def test(name,condition):assert condition,name;checks.append(name)
 def row(arm='B',status='SUPPORTED'):
  value=f.make(m,a,shard,0,arm)
  ledger={'version':1,'enabled':True,'status':status,'reason':None,'originalOwnershipCoverage':'COMPLETE','selectedCheckCount':2,'completePredicateSuite':True,'baselineIssueCount':0,'initialIssueCount':1,'referenceEvaluations':3,'appendedIssueCount':2,'baselineMatchesFiltered':0,'unsupportedOwnerCount':0,'latestIssueCount':0}
  if status=='NOT_APPLICABLE':ledger.update(reason='Original ownership declarations incomplete',originalOwnershipCoverage='UNKNOWN',completePredicateSuite=False,baselineIssueCount=None,initialIssueCount=None,unsupportedOwnerCount=1,latestIssueCount=None)
  for e in [value['official']['routingMetrics']['experimentAudit']['evidence'],value['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence']]:e[r.FEEDBACK_PATH]=ledger if arm=='B'else None
  return value
 def observe(value):return r.coverage.feedback_observation(value,m['candidate'])
 b=row();out=observe(b);test('complete-flat-supported-ledger-source-observed-only',out['supportedSourceObserved']and out['status']=='SOURCE_BOUND_SUPPORTED_FEEDBACK'and not out['independentOutputOrContactProof']and not out['qualityOrSpeedClaim'])
 out=observe(row('A'));test('native-baseline-evidence-and-feedback-flag-absent',out['status']=='BASELINE_FEEDBACK_ABSENT'and out['issues']==[])
 out=observe(row(status='NOT_APPLICABLE'));test('declared-unsupported-domain-recorded-with-no-feature-credit',out['status']=='SOURCE_BOUND_NOT_APPLICABLE'and not out['supportedSourceObserved']and not out['notApplicableFeatureCredit'])
 for key,bad in [('version',True),('enabled',1),('selectedCheckCount',True),('selectedCheckCount',1),('referenceEvaluations',True),('referenceEvaluations',-1),('latestIssueCount',None),('initialIssueCount',-1),('originalOwnershipCoverage','UNKNOWN'),('completePredicateSuite',False),('reason',{}),('status','PASS')]:
  v=row()
  for e in[v['official']['routingMetrics']['experimentAudit']['evidence'],v['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence']]:e[r.FEEDBACK_PATH][key]=bad
  o=observe(v);test('malformed-'+key+'-'+str(bad)+'-no-supported-credit',not o['supportedSourceObserved']and o['mechanismIssues'])
 for variant in ['missing','extra','nested-selected-predicates']:
  v=row()
  for e in[v['official']['routingMetrics']['experimentAudit']['evidence'],v['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence']]:
   if variant=='missing':e[r.FEEDBACK_PATH]=None
   elif variant=='extra':e[r.FEEDBACK_PATH]['extra']=1
   else:e[r.FEEDBACK_PATH]['selectedCheckCount']=['viaTrace','traceOverlap']
  test(variant+'-projection-UNKNOWN',not observe(v)['supportedSourceObserved'])
 v=row();v['phaseCheckpointAudit']['lastDurableCheckpoint']['algorithmSha']='f'*40;test('foreign-source-unbound-no-credit',not observe(v)['supportedSourceObserved'])
 v=row();v['phaseCheckpointAudit']['lastDurableCheckpoint']['observedRequestedOptions']=dict(v['requestedOptions'],experimentOriginalOwnerCopperFeedback=False);test('actual-disabled-flag-source-issue',bool(observe(v)['issues']))
 v=row('A');v['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence'][r.FEEDBACK_PATH]={'version':1};v['official']['routingMetrics']['experimentAudit']['evidence'][r.FEEDBACK_PATH]={'version':1};test('native-unexpected-feature-source-issue',bool(observe(v)['issues']))
 v=row();project=r.coverage.project(m['candidate']);test('original-mst-schema-unmodified-by-feedback',project['evidencePaths']==[r.PATH]and project['coverageContract']==r.coverage.mst.contract())
 v=row();result=r.coverage.coverage(v,m['candidate']);test('separate-primary-secondary-source-observations',result['completedMstLogicalCoverageObserved']and result['originalOwnerFeedbackObservation']['supportedSourceObserved'])
 print(json.dumps({'status':'PASS_SOURCE_BOUND_FOURTEEN_SCALAR_FEEDBACK_OBSERVATION','count':len(checks),'checks':checks,'realBoards':0,'checkerExecutions':0}))
if __name__=='__main__':main()
