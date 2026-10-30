"""One targeted four-attempt provenance/retention test; no routing/checker/network."""
import copy,importlib.util,json,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
r=load('stable4_target_runtime',ROOT/'run-owner-feedback4.py');fixture=load('stable4_immutable_record_fixture',ROOT/'tests/layer-aware-mst84-integrity.py');fixture.r=r;fixture.runtime=r.common
RUN,HEAD=fixture.RUN,fixture.HEAD
make,stream=fixture.make,fixture.stream

def main():
 m=json.loads(r.MANIFEST.read_text());a=r.common.validate_manifest(r.AUTHORITY);checks=[];parsed=[]
 def test(name,value):assert value,name;checks.append(name)
 def reject(name,fn):
  try:fn()
  except(ValueError,TypeError,KeyError,AssertionError):checks.append(name);return
  raise AssertionError('Accepted invalid targeted data '+name)
 test('prospective-exact-two-development-cases-and-opposite-order',[(s['dataset'],s['cases'][0]['sample'],s['cases'][0]['order'])for s in m['shards']]==[('srj18',11,'AB'),('srj24',8,'BA')])
 for shard in m['shards']:
  rows=[make(m,a,shard,0,arm)for arm in shard['cases'][0]['order']];p=r.parse_log(stream(rows,m,shard),m,a,shard,RUN,HEAD);parsed.append(p);test(shard['dataset']+'-changed-valid-output-retained-no-parity-gate',p['summary']['populationComplete']and p['summary']['whole']['pairCount']==1 and not p['summary']['pairs'][0]['crossArmOutputHashEquality']['rawOutputHash'])
 union=r.qualify_union(parsed,m,a,RUN,HEAD);test('exact-four-fresh-attempts-not-full-corpus-claim',union['recordCount']==4 and union['originalCaseCount']==2 and union['fullCorpusClaim']is False and union['orderCounts']=={'AB':1,'BA':1});test('two-original-zip-independent-receipts-still-required',union['requiredIndependentRawReceipts']==2 and union['rawByteQualificationClaim']is False)
 reject('missing-shard',lambda:r.qualify_union(parsed[:1],m,a,RUN,HEAD));reject('duplicate-shard',lambda:r.qualify_union([parsed[0],parsed[0]],m,a,RUN,HEAD))
 for field,bad in[('runId','1'),('controllerSha','d'*40),('manifestSha256','e'*64),('runtimeSha256','f'*64)]:
  value=copy.deepcopy(parsed);value[0][field]=bad;reject('foreign-'+field,lambda value=value:r.qualify_union(value,m,a,RUN,HEAD))
 shard=m['shards'][0];rows=copy.deepcopy(parsed[0]['records']);reject('missing-arm',lambda:r.parse_log(stream(rows[:1],m,shard),m,a,shard,RUN,HEAD));reject('duplicate-arm',lambda:r.parse_log(stream(rows+[rows[0]],m,shard),m,a,shard,RUN,HEAD))
 for field,bad in[('algorithmSha','d'*40),('inputSha256','e'*64),('executionOrder','BA')]:
  value=copy.deepcopy(rows);value[0]['phaseCheckpointAudit']['lastDurableCheckpoint'][field]=bad;reject('foreign-checkpoint-'+field,lambda value=value:r.parse_log(stream(value,m,shard),m,a,shard,RUN,HEAD))
 mixed=copy.deepcopy(parsed);badrows=[make(m,a,shard,0,'A','timeout'),make(m,a,shard,0,'B','native-failure')];mixed[0]=r.parse_log(stream(badrows,m,shard),m,a,shard,RUN,HEAD);v=r.qualify_union(mixed,m,a,RUN,HEAD);test('native-failure-and-strictfalse-timeout-retained-with-completed-ledger',v['recordCount']==4 and v['strictRecordCount']==3 and v['separatelyCheckpointProvenTimeoutCount']==1 and v['whole']['pairCount']==1 and badrows[1]['featureCoverage']['completedMstLogicalCoverageObserved'])
 altered=copy.deepcopy(parsed);b=next(x for x in altered[0]['records']if x['arm']=='B');b['declaredIntentCopper'].update(status='FAIL_FOREIGN_COPPER',qualifiedSupportedCopper=False,knownForeignCopperFindingCount=1);r.qualify(b,m,a,shard,0,'B',RUN,HEAD);altered[0]=r.parse_log(stream(altered[0]['records'],m,shard),m,a,shard,RUN,HEAD);v=r.qualify_union(altered,m,a,RUN,HEAD);test('physical-regression-retained-not-integrity-rejected',v['recordCount']==4 and v['strictRecordCount']==4 and v['identitySets']['srj18']['physical']['lost']==[11]and v['whole']['pairCount']==1)
 b=make(m,a,shard,0,'B');b['official']['routingMetrics']['experimentAudit']['evidence'][r.PATH]=None;b['phaseCheckpointAudit']['lastDurableCheckpoint']['evidence'][r.PATH]=None;r.qualify(b,m,a,shard,0,'B',RUN,HEAD);test('missing-mechanism-ledger-UNKNOWN-with-physical-outcome-retained',b['strictIntegrityQualified']and r.common.physical_clean(b)and not b['featureCoverage']['completedMstLogicalCoverageObserved'])
 with tempfile.TemporaryDirectory()as folder:
  raw=Path(folder);(raw/'original-input.json').write_text('{}');record={'dataset':'srj24','sampleNumber':8,'expectedInputHash':'a'*64}
  for label,auditor in[('pointpair',r.audit_pointpairs),('transition',r.audit_transitions)]:test('foreign-retained-original-'+label+'-UNKNOWN',auditor(record,raw)['status']=='UNKNOWN_RETAINED_ORIGINAL_INPUT_HASH_MISMATCH')
 print(json.dumps({'status':'PASS_PROSPECTIVE_TARGETED_STABLE4_SOURCE_AND_ALL_OUTCOME_RETENTION','count':len(checks),'checks':checks,'actualBoards':0,'checkerExecutions':0,'networkRequests':0}))
if __name__=='__main__':main()
