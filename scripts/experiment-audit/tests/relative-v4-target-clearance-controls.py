"""One exact-margin pure test including adjacent closest-segment switches."""
import copy,importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('exact_literal_margin',ROOT/'replay-relative-v4-target-clearance.py');q=importlib.util.module_from_spec(s);s.loader.exec_module(q)
def fixture(x=0,y=.301):
 layers=['top','inner1','inner2','bottom'];route=[{'route_type':'wire','x':a,'y':b,'layer':'inner2','width':.1}for a,b in[(-1,0),(1,0),(1,1),(.32,1),(.32,.1)]];trace={'pcb_trace_id':'foreign','connection_name':'foreignRoot','route':route};via={'type':'pcb_via','pcb_via_id':'via','x':0,'y':.2615,'layers':layers,'outer_diameter':.3,'hole_diameter':.15};canonical=[via,{'type':'pcb_trace',**trace}];owners={'ownershipCoverageStatus':'COMPLETE','viaOwners':[{'originalId':'via','canonicalIndex':0,'status':'RESOLVED','owner':'ownA'}],'traceOwners':[{'originalId':'foreign','canonicalIndex':1,'status':'RESOLVED','owner':'ownB'}],'allFindings':[{'checkClass':'viaTrace','classification':'DECLARED_FOREIGN_COPPER','error':{'minimum_clearance':.1},'owners':[{'type':'pcb_via','id':'via'},{'type':'pcb_trace','id':'foreign'}]}]};before={'circuitJson':canonical,'copper':owners};after=copy.deepcopy(before);after['circuitJson'][0].update(x=x,y=y);after['copper']['allFindings']=[];trial={'stageSolveCalls':1,'routingExecutions':0,'localRepair':{'applied':True},'before':{'fullCertificate':before},'after':{'fullCertificate':after}};return{'layerCount':4},[trace],copy.deepcopy([trace]),trial
def main():
 checks=[]
 def test(label,value):assert value,label;checks.append(label)
 def reject(label,fn):
  try:fn()
  except(ValueError,TypeError,KeyError):checks.append(label);return
  raise AssertionError('Accepted forged target margin '+label)
 value=q.audit(*fixture());test('all-manufactured-layers-all-four-finite-segments-pass-literal-point101',value['status'].startswith('PASS_')and value['segmentsChecked']==4 and value['manufacturedLayers']==['top','inner1','inner2','bottom'])
 test('native-point005-tolerance-cannot-certify-point099',q.audit(*fixture(y=.299))['status']=='FAIL_LITERAL_TARGET_CLEARANCE')
 switched=q.audit(*fixture(x=.03));test('adjacent-closest-segment-switch-fails-even-selected-baseline-segment-passes',switched['status']=='FAIL_LITERAL_TARGET_CLEARANCE'and switched['segmentWitnesses'][0]['literalMinimumClearancePassed']and not switched['segmentWitnesses'][-1]['literalMinimumClearancePassed'])
 for label,mutate in[('missing-full-manufactured-layer',lambda a:a[3]['after']['fullCertificate']['circuitJson'][0].update(layers=['inner1','bottom'])),('changed-via-material',lambda a:a[3]['after']['fullCertificate']['circuitJson'][0].update(outer_diameter=.29)),('unknown-moving-owner',lambda a:a[3]['before']['fullCertificate']['copper']['viaOwners'][0].update(status='UNKNOWN')),('changed-foreign-geometry',lambda a:a[2][0]['route'][0].update(x=-2)),('canonical-raw-discrepancy',lambda a:a[3]['after']['fullCertificate']['circuitJson'][1]['route'][0].update(width=.2)),('false-literal-minimum',lambda a:a[3]['before']['fullCertificate']['copper']['allFindings'][0]['error'].update(minimum_clearance=.095))]:
  args=fixture();mutate(args);reject(label,lambda args=args:q.audit(*args))
 args=fixture();args[3]['localRepair']['applied']=False;test('unchanged-negative-no-margin-credit',q.audit(*args)['status']=='NO_LOCAL_REPAIR_OUTPUT_UNCHANGED')
 test('exact-finite-segment-projection-endcaps-and-degenerate',q.squared((q.F(1),q.F(1)),(q.F(0),q.F(0)),(q.F(0),q.F(0)))==2 and q.squared((q.F(2),q.F(1)),(q.F(0),q.F(0)),(q.F(1),q.F(0)))==2)
 print(json.dumps({'status':'PASS_EXACT_LITERAL_TARGET_MARGIN_SYNTHETIC_CONTROLS','count':len(checks),'checks':checks,'actualDatasetPredicates':0,'routingExecutions':0}))
if __name__=='__main__':main()
