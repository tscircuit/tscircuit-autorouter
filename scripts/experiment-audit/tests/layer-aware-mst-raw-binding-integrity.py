"""One synthetic changed-geometry originalZIP content binding and forgery test."""
import copy,importlib.util,io,json,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
t=load('mst_raw_fixture',ROOT/'tests/layer-aware-mst84-integrity.py');q=load('mst_raw_proof_test',ROOT/'layer-aware-mst84-raw-proof.py');r=t.r

def encoded(value):return json.dumps(value,separators=(',',':')).encode()
def main():
 m=json.loads(r.MANIFEST.read_text());a=r.common.validate_manifest(r.AUTHORITY);shard=m['shards'][0];files={};records={};checks=[]
 original={'layerCount':2,'obstacles':[],'connections':[{'name':'N','pointsToConnect':[{'x':-1,'y':0,'layer':'top','pointId':'p1'},{'x':1,'y':0,'layer':'top','pointId':'p2'}]}]}
 for arm in 'AB':
  record=t.make(m,a,shard,0,arm);target=arm+'/';raw={'original-input.json':original,'point-pair-context.json':original}
  trace={'pcb_trace_id':'t','connection_name':'N','route':[{'route_type':'wire','x':x,'y':y,'width':.1,'layer':'top'}for x,y in[(-1,0),(0,0 if arm=='A'else .2),(1,0)]]}
  raw.update({'raw-new-traces.json':[trace],'canonical-circuit-json.json':[{'type':'pcb_trace',**trace}],'raw-solver-output.json':{**original,'traces':[trace]}})
  for name,value in raw.items():files[target+name]=encoded(value)
  hashes={name:q.digest(files[target+name])for name in r.common.declared.INPUTS};record['expectedInputHash']=hashes['original-input.json'];audit=record['official']['routingMetrics']['experimentAudit'];audit.update(inputHash=record['expectedInputHash'],rawNewTracesHash=hashes['raw-new-traces.json'],rawOutputHash=q.digest(files[target+'raw-solver-output.json']))
  compact=record['declaredIntentCopper'];compact.update(inputHashes=hashes,canonicalSemanticSha256=hashes['canonical-circuit-json.json'],findingInventorySha256=q.digest(b'[]'),perCheckCounts={n:{k:0 for k in['count','knownForeignFindingCount','unknownFindingCount','sameOwnerRuleFindingCount']}for n in q.CHECKS},originalObstacleCoverage={k:0 for k in['originalCount','representedCount','unmappedCount','unmappedDeclaredCopperCount']})
  report=copy.deepcopy(compact);report.update(checks={n:{**counts,'findings':[]}for n,counts in compact['perCheckCounts'].items()},allFindings=[],traceOwners=[{'originalId':'t','owner':'N','status':'RESOLVED'}],padOwners=[],viaOwners=[])
  files[target+'declared-intent-via-pad.json']=encoded(report);compact['reportSha256']=q.digest(files[target+'declared-intent-via-pad.json'])
  record['supplemental'].update(canonicalCircuitJsonSha256=hashes['canonical-circuit-json.json'],validationTimeMs=0)
  full={**copy.deepcopy(record['supplemental']),**audit,'supplementalValidationTimeMs':0}
  for name in r.common.CHECKS:full[name]['errors']=[]
  files[target+'capture-provenance.json']=encoded(audit);files[target+'supplemental-validation.json']=encoded(full);records[arm]=record
 def audit(arm,changes=None,record=None):
  contents={**files,**(changes or{})};stream=io.BytesIO()
  with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED)as z:
   for name,value in contents.items():z.writestr(name,value)
  with zipfile.ZipFile(io.BytesIO(stream.getvalue()))as z:return q.output_facts(z,arm+'/',record or records[arm],r.common)
 facts={arm:audit(arm)for arm in'AB'};assert facts['A']['rawInputFileSha256']['raw-new-traces.json']!=facts['B']['rawInputFileSha256']['raw-new-traces.json'];checks.append('genuinely-changed-straight-versus-bent-valid-same-layer-geometry-each-byte-bound-without-crossarm-parity')
 v=copy.deepcopy(records['B']);report=json.loads(files['B/declared-intent-via-pad.json']);finding={'rule':'viaPad','classification':'knownForeignCopper'};report.update(status='FAIL_FOREIGN_COPPER',qualifiedSupportedCopper=False,knownForeignCopperFindingCount=1,allFindings=[finding]);report['checks']['viaPad'].update(count=1,knownForeignFindingCount=1,findings=[finding]);data=encoded(report);d=v['declaredIntentCopper'];d.update(status='FAIL_FOREIGN_COPPER',qualifiedSupportedCopper=False,knownForeignCopperFindingCount=1,reportSha256=q.digest(data),findingInventorySha256=q.digest(json.dumps([finding],sort_keys=True,separators=(',',':')).encode()));d['perCheckCounts']['viaPad'].update(count=1,knownForeignFindingCount=1);assert audit('B',{'B/declared-intent-via-pad.json':data},v)['declaredIntentStatus']=='FAIL_FOREIGN_COPPER'and not r.common.physical_clean(v);checks.append('coherent-nonzero-foreign-copper-report-byte-retained-without-physical-credit')
 def reject(label,fn):
  try:fn()
  except(AssertionError,ValueError,KeyError,TypeError):checks.append(label);return
  raise AssertionError('Accepted raw forgery '+label)
 for name in ['original-input.json','point-pair-context.json','raw-new-traces.json','canonical-circuit-json.json','raw-solver-output.json','capture-provenance.json','supplemental-validation.json']:
  reject('tampered-'+name,lambda name=name:audit('B',{'B/'+name:b'{}'}))
 for label,mutate in [('per-check-count',lambda d:d['checks']['viaPad'].update(count=1)),('obstacle-coverage',lambda d:d['originalObstacleCoverage'].update(originalCount=1)),('schema-version',lambda d:d.update(schemaVersion=99))]:
  report=json.loads(files['B/declared-intent-via-pad.json']);mutate(report);data=encoded(report);v=copy.deepcopy(records['B']);v['declaredIntentCopper']['reportSha256']=q.digest(data);reject('refreshed-report-digest-cannot-hide-'+label,lambda data=data,v=v:audit('B',{'B/declared-intent-via-pad.json':data},v))
 print(json.dumps({'status':'PASS_CHANGED_GEOMETRY_ORIGINAL_ZIP_FACTS_AND_FULL_REPORT_PROJECTIONS','count':len(checks),'checks':checks,'checkerExecutions':0,'actualBoards':0}))
if __name__=='__main__':main()
