"""One pure logical-demand/ledger audit test, separate from physical contact."""
import copy,importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
t=load('mst_coverage_fixture',ROOT/'tests/layer-aware-mst-transition-audit-integrity.py');u=load('mst_ledger_fixture',ROOT/'tests/layer-aware-mst84-integrity.py');q=u.r.coverage

def main():
 values=t.fixture();original,pairs=values[:2];requirements=values[-1];checks=[]
 def test(label,value):assert value,label;checks.append(label)
 x=q.audit_case8(original,pairs,requirements);test('all-six-exact-original-layer-IDs-and-emitted-crosslayer-paths-retained',x['status']=='COVERED_LOGICAL_REQUIREMENTS'and x['retained']==6 and x['electricalPass']=='UNPROVEN')
 test('no-emitted-demand-means-six-missing-never-electrical-pass',q.audit_case8(original,{'connections':[]},requirements)['status']=='MISSING_LOGICAL_REQUIREMENTS')
 for key,value in [('layer','top'),('pointId','forged'),('pcb_port_id','forged'),('x',.01)]:
  p=copy.deepcopy(pairs);p['connections'][0]['pointsToConnect'][1][key]=value;test('forged-required-'+key,q.audit_case8(original,p,requirements)['status']!='COVERED_LOGICAL_REQUIREMENTS')
 for key,value in [('layers',['bottom']),('layer','')]:
  p=copy.deepcopy(pairs);p['connections'][0]['pointsToConnect'][1][key]=value;test('ambiguous-or-empty-layer-'+key,q.audit_case8(original,p,requirements)['status']=='UNKNOWN')
 p=copy.deepcopy(pairs);p['connections'][0]['__rootConnectionNames']=['OTHER'];test('wrong-original-root-not-covered',q.audit_case8(original,p,requirements)['status']!='COVERED_LOGICAL_REQUIREMENTS')
 for key,value in [('isOffBoard',True),('externallyConnectedPointIds',[['port0top','port0bottom']])]:
  o=copy.deepcopy(original);o['connections'][0][key]=value;test('native-equivalence-'+key+'-UNKNOWN',q.audit_case8(o,pairs,requirements)['status']=='UNKNOWN')
 o=copy.deepcopy(original);o['traces']=[{'connectsTo':['port0top','port0bottom']}];test('original-preconnected-trace-UNKNOWN',q.audit_case8(o,pairs,requirements)['status']=='UNKNOWN')
 m=json.loads(u.r.MANIFEST.read_text());a=u.r.common.validate_manifest(u.r.AUTHORITY);shard=m['shards'][0]
 for label,mutation in [('missing',lambda v:v.clear()),('extra',lambda v:v.update(forged=1)),('wrong-type',lambda v:v.update(mstSelectedEdges=True)),('incomplete',lambda v:v.update(completed=False)),('missing-requirements',lambda v:v.update(mstCoveredLayerKeys=5,missingLayerKeys=1))]:
  r=u.make(m,a,shard,0,'B');audit=r['official']['routingMetrics']['experimentAudit'];v=audit['evidence'][q.PATH];mutation(v);r['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence'][q.PATH]=copy.deepcopy(v);u.r.qualify(r,m,a,shard,0,'B',u.RUN,u.HEAD);test('ledger-'+label+'-preserves-source-and-independent-physical-assessment',r['strictIntegrityQualified']and u.r.common.physical_clean(r)and not r['featureCoverage']['completedMstLogicalCoverageObserved'])
 print(json.dumps({'status':'PASS_LOGICAL_REQUIREMENT_AND_SEPARATE_LEDGER_MECHANISM','count':len(checks),'checks':checks,'actualBoards':0,'checkerExecutions':0}))
if __name__=='__main__':main()
