"""Exact binary64-rational final target margin; no predicates, proposals or routing."""
import math
from fractions import Fraction as F

def require(value,message):
 if not value:raise ValueError(message)
def number(value):
 require(type(value)in[int,float]and math.isfinite(value),'Finite scalar geometry required');return F(value)
def xy(point):return(number(point['x']),number(point['y']))
def squared(point,start,end):
 dx,dy=end[0]-start[0],end[1]-start[1];wx,wy=point[0]-start[0],point[1]-start[1];norm=dx*dx+dy*dy;dot=wx*dx+wy*dy
 if norm==0 or dot<=0:return wx*wx+wy*wy
 if dot>=norm:return(point[0]-end[0])**2+(point[1]-end[1])**2
 return(wx*dy-wy*dx)**2/norm
def exact(value):return{'numerator':str(value.numerator),'denominator':str(value.denominator)}
def only(values,message):
 require(len(values)==1,message);return values[0]
def audit(original,raw,output,trial):
 if trial.get('localRepair',{}).get('applied')is not True:return{'status':'NO_LOCAL_REPAIR_OUTPUT_UNCHANGED','clearanceCredit':False,'sourcePredicatesChanged':False}
 before,after=trial['before']['fullCertificate'],trial['after']['fullCertificate'];require(trial.get('stageSolveCalls')==1 and trial.get('routingExecutions')==0,'Actual production stage only')
 require(before['copper']['ownershipCoverageStatus']==after['copper']['ownershipCoverageStatus']=='COMPLETE','Source-bound original ownership required')
 finding=only(before['copper']['allFindings'],'Exactly one target finding required');require(finding['checkClass']=='viaTrace'and finding['classification']=='DECLARED_FOREIGN_COPPER','Target must be strict original-foreign viaTrace')
 minimum=number(finding['error']['minimum_clearance']);require(minimum==number(.1),'This retained trial requires the literal declared .1mm threshold')
 via_member=only([v for v in finding['owners']if v['type']=='pcb_via'],'One target via required');trace_member=only([v for v in finding['owners']if v['type']=='pcb_trace'],'One target foreign trace required')
 def owner(cert,kind,identity):return only([v for v in cert['copper'][kind]if v['originalId']==identity],'Original target owner binding absent')
 vo=owner(before,'viaOwners',via_member['id']);to=owner(before,'traceOwners',trace_member['id']);require(vo['status']==to['status']=='RESOLVED'and vo['owner']!=to['owner'],'Moving and foreign target owners must be distinct resolved original owners')
 require(owner(after,'viaOwners',via_member['id'])==vo and owner(after,'traceOwners',trace_member['id'])==to,'Target original owner bindings changed')
 oldvia=before['circuitJson'][vo['canonicalIndex']];newvia=after['circuitJson'][vo['canonicalIndex']];require(oldvia['type']==newvia['type']=='pcb_via'and oldvia['pcb_via_id']==newvia['pcb_via_id']==via_member['id'],'Canonical target via identity changed')
 require({k:v for k,v in oldvia.items()if k not in['x','y']}=={k:v for k,v in newvia.items()if k not in['x','y']},'Target via material/span changed')
 layers=['top']if original['layerCount']==1 else['top']+['inner'+str(i+1)for i in range(original['layerCount']-2)]+['bottom'];require(len(newvia['layers'])==len(set(newvia['layers']))==len(layers)and set(newvia['layers'])==set(layers),'Every full manufactured target layer required')
 outer,hole=number(newvia['outer_diameter']),number(newvia['hole_diameter']);require(0<hole<outer,'Target manufactured annular material unsupported');center=xy(newvia)
 foreign=only([(i,t)for i,t in enumerate(raw)if t['pcb_trace_id']==trace_member['id']],'Target foreign raw trace missing');ti,trace=foreign;require(len(raw)==len(output)and output[ti]==trace,'Target foreign raw trace must remain exact unchanged')
 for cert in[before,after]:
  canonical=cert['circuitJson'][to['canonicalIndex']];require(canonical['type']=='pcb_trace'and canonical['pcb_trace_id']==trace['pcb_trace_id']and len(canonical['route'])==len(trace['route']),'Target canonical/raw trace identity or population differs')
  for cp,rp in zip(canonical['route'],trace['route']):
   keys=['route_type','x','y','layer','width']if rp['route_type']=='wire'else['route_type','x','y','from_layer','to_layer'];require(all(cp[k]==rp[k]for k in keys),'Target canonical/raw trace geometry differs')
 records=[]
 require(all(p.get('route_type')in['wire','via']for p in trace['route']),'Unsupported target foreign trace primitive')
 for pi,(a,b)in enumerate(zip(trace['route'],trace['route'][1:])):
  if a['route_type']!='wire'or b['route_type']!='wire':continue
  require(a['layer']==b['layer']and a['layer']in layers,'Foreign segment has unexplained layer transition')
  width=max(number(a['width']),number(b['width']));require(width>0,'Positive foreign wire width required');threshold=outer/2+width/2+minimum;distance=squared(center,xy(a),xy(b));slack=distance-threshold*threshold
  records.append({'traceIndex':ti,'pointIndex':pi,'layer':a['layer'],'distanceSquaredExact':exact(distance),'requiredCenterDistanceExact':exact(threshold),'squaredMarginSlackExact':exact(slack),'literalMinimumClearancePassed':slack>=0})
 require(records,'No target foreign shared-layer segment found')
 return{'status':'PASS_LITERAL_TARGET_CLEARANCE_ALL_MANUFACTURED_LAYERS'if all(v['literalMinimumClearancePassed']for v in records)else'FAIL_LITERAL_TARGET_CLEARANCE','literalMinimumClearanceMm':.1,'arithmetic':'Exact rational source binary64 values; point-to-finite-segment projection; maximum endpoint wire width; full manufactured via outer radius. No native checker tolerance used.','targetViaId':via_member['id'],'foreignTraceId':trace_member['id'],'targetOriginalOwner':vo['owner'],'foreignOriginalOwner':to['owner'],'manufacturedLayers':layers,'segmentsChecked':len(records),'segmentWitnesses':records,'sourcePredicatesChanged':False,'sourceContactProofOrGlobalPassInferred':False,'accepted':False,'qualityOrSpeedCredit':False}
