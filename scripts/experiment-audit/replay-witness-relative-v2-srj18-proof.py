"""Independent exact-rational data-only local proof replay; no production imports.

No candidate proposal or routing code is reproduced. This verifier consumes the
actual production stage output and emitted final movement mask.
"""
import argparse
from fractions import Fraction as F
import copy
import hashlib
import json
import math
import os
from pathlib import Path

def xy(p): return F(p['x']),F(p['y'])
def cross(a,b,c): return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def hull(points):
    points = sorted(set(points))
    if len(points) <= 1: return points
    lower,upper = [],[]
    for sequence,target in [(points,lower),(points[::-1],upper)]:
        for p in sequence:
            while len(target)>1 and cross(target[-2],target[-1],p)<=0: target.pop()
            target.append(p)
    return lower[:-1]+upper[:-1]
def edges(poly):
    if len(poly)==1: return [(poly[0],poly[0])]
    if len(poly)==2: return [(poly[0],poly[1])]
    return list(zip(poly,poly[1:]+poly[:1]))
def point_segment_squared(p,a,b):
    dx,dy = b[0]-a[0],b[1]-a[1]
    n = dx*dx+dy*dy
    if not n: return (p[0]-a[0])**2+(p[1]-a[1])**2
    t = max(F(0),min(F(1),((p[0]-a[0])*dx+(p[1]-a[1])*dy)/n))
    return (p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2
def on_segment(p,a,b): return cross(a,b,p)==0 and min(a[0],b[0])<=p[0]<=max(a[0],b[0]) and min(a[1],b[1])<=p[1]<=max(a[1],b[1])
def segments_intersect(a,b,c,d):
    x,y,u,v = cross(a,b,c),cross(a,b,d),cross(c,d,a),cross(c,d,b)
    if any([x==0 and on_segment(c,a,b),y==0 and on_segment(d,a,b),u==0 and on_segment(a,c,d),v==0 and on_segment(b,c,d)]): return True
    return (x<0<y or y<0<x) and (u<0<v or v<0<u)
def inside(point,poly):
    if len(poly)<3: return any(on_segment(point,a,b) for a,b in edges(poly))
    return all(cross(a,b,point)>=0 for a,b in edges(poly))
def polygon_squared(a,b):
    if any(inside(p,b) for p in a) or any(inside(p,a) for p in b): return F(0)
    if any(segments_intersect(p,q,r,s) for p,q in edges(a) for r,s in edges(b)): return F(0)
    return min([point_segment_squared(p,r,s) for p in a for r,s in edges(b)]+[point_segment_squared(p,r,s) for p in b for r,s in edges(a)])
def bounds(poly,radius): return [min(p[0] for p in poly)-radius,min(p[1] for p in poly)-radius,max(p[0] for p in poly)+radius,max(p[1] for p in poly)+radius]
def box_axis_gap(a,b): return max(a[0]-b[2],b[0]-a[2],a[1]-b[3],b[1]-a[3])
def ratio(value): return str(value.numerator)+'/'+str(value.denominator)
def describe(value):
    return {k:v for k,v in value.items() if k not in ['poly','radius','box']}
def primitive(kind,identity,layers,points,radius=F(0),**extra):
    value={'kind':kind,'id':identity,'layers':layers,'poly':hull(points),'radius':radius,**extra}
    value['box']=bounds(value['poly'],radius); return value


def require(value,message):
    if not value:raise ValueError(message)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def without(value,keys):return {k:v for k,v in value.items()if k not in keys}
def point_squared(a,b):return sum((a[k]-b[k])**2 for k in [0,1])


def replay(original,raw,output,canonical,trial):
    require(trial['stageSolveCalls']==trial['productionStage']['solveCalls']==1,'Actual production solve call absent')
    require(trial['accepted'] is False and trial['fullBoardRecovery'] is False and trial['qualityOrSpeedCredit'] is False and trial['routingExecutions']==0,'Global claim or routing is outside trial scope')
    require(len(raw)==len(output),'Raw trace population changed')
    movements=trial['productionStage']['selectedMoves'];allowed={};kind_points={'via':[],'wire':[]}
    for move in movements:
        require(move['kind']in kind_points and move['occurrences'],'Unsupported production movement record')
        maximum=F(.25 if move['kind']=='via'else .02)
        for occurrence in move['occurrences']:
            ti,pi=occurrence['traceIndex'],occurrence['pointIndex'];key=(ti,pi)
            require(type(ti)is int and type(pi)is int and key not in allowed,'Duplicate or invalid movement index')
            a,b=xy(occurrence['oldXY']),xy(occurrence['newXY'])
            require(all(math.isfinite(occurrence[p][k])for p in ['oldXY','newXY']for k in ['x','y']),'Nonfinite movement')
            require(0<point_squared(a,b)<=maximum**2,'Production movement exceeded its hard cap')
            require(0<=ti<len(raw)and 0<pi<len(raw[ti]['route'])-1,'Protected endpoint moved')
            p,q=raw[ti]['route'][pi],output[ti]['route'][pi]
            require(p['route_type']in ['wire','via']and not any('port'in name.lower()for name in p),'Protected or unsupported point moved')
            require(xy(p)==a and xy(q)==b and without(p,['x','y'])==without(q,['x','y']),'Movement mask does not bind raw point/material')
            require(all(xy(t)!=a for c in original['connections']for t in c['pointsToConnect']),'Original terminal coordinate moved')
            allowed[key]={'kind':move['kind'],'oldXY':occurrence['oldXY'],'newXY':occurrence['newXY']};kind_points[move['kind']].append(key)
    differences=[]
    for ti,(a,b)in enumerate(zip(raw,output)):
        require(without(a,['route'])==without(b,['route'])and len(a['route'])==len(b['route']),'Trace ID/metadata/route size changed')
        for pi,(p,q)in enumerate(zip(a['route'],b['route'])):
            if (ti,pi)not in allowed:require(p==q,'Unselected raw point changed')
            else:differences.append((ti,pi))
    require(len(differences)==len(allowed),'Output mask population differs')
    before=trial['before']['fullCertificate'];after=trial['after']['fullCertificate']
    require(before['circuitJson']==canonical,'Full baseline canonical differs from retained input')
    if not allowed:
        require(raw==output and before==after and trial['localRepair']['applied']is False,'Unchanged output control differs')
        return {'status':'NO_LOCAL_REPAIR_OUTPUT_UNCHANGED','productionStageSolveCalls':1,'sameOwnerPartitionProofApplied':False,'accepted':False,'fullBoardRecovery':False,'qualityOrSpeedCredit':False,'localDatasetCheckerExecutions':0,'routingExecutions':0}
    require(trial['localRepair']['applied']is True and trial['productionStage']['relativeProof']['status']=='PASS','Changed output lacks source relative proof')
    require(kind_points['via']and len(kind_points['wire'])in [0,2],'Trial requires one via site and optionally two wire vertices')
    via_old={xy(raw[ti]['route'][pi])for ti,pi in kind_points['via']};via_new={xy(output[ti]['route'][pi])for ti,pi in kind_points['via']}
    require(len(via_old)==len(via_new)==1,'Via site aliases separated')
    center_old,center_new=next(iter(via_old)),next(iter(via_new));stack=['top',*[f'inner{i+1}'for i in range(original['layerCount']-2)],'bottom']
    require(original['layerCount']in [2,4,6]and len(set(stack))==len(stack),'Unsupported stack')
    def owner(kind,identifier):
        records=[r for r in after['copper'][kind]if r['originalId']==identifier]
        require(len(records)==1 and records[0]['status']=='RESOLVED','Unknown or ambiguous contacted owner')
        record=records[0];element=after['circuitJson'][record['canonicalIndex']]
        field={'traceOwners':'pcb_trace_id','viaOwners':'pcb_via_id','padOwners':'pcb_smtpad_id'}[kind]
        require(element[field]==identifier,'Owner record canonical mismatch');return record
    raw_owners={ti:owner('traceOwners',trace['pcb_trace_id'])for ti,trace in enumerate(raw)}
    via_owner=raw_owners[kind_points['via'][0][0]]['owner']
    coupled=[]
    for ti,trace in enumerate(raw):
        for pi,point in enumerate(trace['route']):
            if xy(point)==center_old:
                require(point['route_type']in ['wire','via']and raw_owners[ti]['owner']==via_owner,'Foreign or unsupported via-site coupling')
                coupled.append((ti,pi))
    require(set(coupled)==set(kind_points['via']),'Incomplete via-site coupling')
    wire_points=sorted(kind_points['wire'])
    if wire_points:
        wire_ti,p=wire_points[0]
        require(wire_points==[(wire_ti,p),(wire_ti,p+1)],'Moved wire points are not consecutive on one trace')
    for wi,pi in wire_points:
        point=raw[wi]['route'][pi]
        require(point['route_type']=='wire'and sum(xy(q)==xy(point)for t in raw for q in t['route'])==1,'Moved wire is coupled or unsupported')
    if wire_points:require(raw[wire_ti]['route'][p]['layer']==raw[wire_ti]['route'][p+1]['layer'],'Moved wire layer mismatch')
    indices={t['pcb_trace_id']:i for i,t in enumerate(raw)};require(len(indices)==len(raw),'Duplicate raw IDs')
    selected_vias=[v for v in canonical if v['type']=='pcb_via'and xy(v)==center_old]
    require(selected_vias,'Missing manufactured via mapping')
    via_ids={v['pcb_via_id']for v in selected_vias}
    require(all(owner('viaOwners',v['pcb_via_id'])['owner']==via_owner for v in selected_vias),'Via alias owner differs')
    require(len({(v['outer_diameter'],v['hole_diameter'])for v in selected_vias})==1,'Via alias material differs')
    outer=F(selected_vias[0]['outer_diameter'])/2;inner=F(selected_vias[0]['hole_diameter'])/2
    require(0<inner<outer,'Unsupported generated via annulus')
    require(all(F(raw[t]['route'][i]['via_diameter'])/2==outer and F(raw[t]['route'][i]['via_hole_diameter'])/2==inner for t,i in kind_points['via']if raw[t]['route'][i]['route_type']=='via'),'Raw/canonical via material differs')
    require(len(canonical)==len(after['circuitJson']),'Canonical element count changed')
    for circuit,traces in [(canonical,raw),(after['circuitJson'],output)]:
        ts=[v for v in circuit if v['type']=='pcb_trace'];require(len(ts)==len(raw)and len({v['pcb_trace_id']for v in ts})==len(raw),'Canonical trace population differs')
        for trace in ts:
            ri=indices[trace['pcb_trace_id']];require(len(trace['route'])==len(traces[ri]['route']),'Canonical route size differs')
            for point,raw_point in zip(trace['route'],traces[ri]['route']):
                fields=['route_type','x','y','width','layer']if raw_point['route_type']=='wire'else ['route_type','x','y','from_layer','to_layer']
                require(all(point[k]==raw_point[k]for k in fields),'Canonical geometry differs from actual raw output')
    def strip(circuit):
        result=copy.deepcopy(circuit)
        for element in result:
            if element['type']=='pcb_via'and element['pcb_via_id']in via_ids:
                element.pop('x');element.pop('y')
            if element['type']=='pcb_trace':
                ri=indices[element['pcb_trace_id']];element['route']=[without(q,['x','y'])if (ri,pi)in allowed else q for pi,q in enumerate(element['route'])]
        return result
    require(strip(canonical)==strip(after['circuitJson']),'Protected canonical material/geometry/metadata changed')
    require(all(xy(v)==center_new for v in after['circuitJson']if v.get('pcb_via_id')in via_ids),'Canonical via aliases did not move together')
    # Derive mutable bundles independently from the actual output. In particular,
    # absorb unchanged-coordinate fanout copper whose material a moving drill cuts.
    via_bundle={'id':'via','owner':via_owner,'segments':set(),'boundaries':[],'vias':via_ids};bundles=[via_bundle]
    wire_bundle=None
    if wire_points:
        wire_bundle={'id':'wire','owner':raw_owners[wire_ti]['owner'],'segments':set(),'boundaries':[],'vias':set()};bundles.append(wire_bundle)
    def segment(ti,pi):
        a,b=raw[ti]['route'][pi:pi+2]
        require(a['route_type']==b['route_type']=='wire'and a['layer']==b['layer']and a['width']==b['width']and a['width']>0,'Unsupported mutable straight wire material')
        return primitive('raw-segment',[ti,pi,pi+1],[a['layer']],[xy(a),xy(b),xy(output[ti]['route'][pi]),xy(output[ti]['route'][pi+1])],F(a['width'])/2)
    for ri,vi in kind_points['via']:
        via=raw[ri]['route'][vi]
        if via['route_type']!='via':continue
        require(via['from_layer']in stack and via['to_layer']in stack,'Unsupported via span')
        for direction,layer in [(-1,via['from_layer']),(1,via['to_layer'])]:
            current=vi+direction;point=raw[ri]['route'][current]
            require(point['route_type']=='wire'and point['layer']==layer and xy(point)==center_old and xy(output[ri]['route'][current])==center_new,'Uncoupled incident fanout')
            while True:
                next_index=current+direction
                require(0<=next_index<len(raw[ri]['route']),'Via fanout has no exterior boundary')
                low=min(current,next_index);item=segment(ri,low);require(item['layers']==[layer],'Fanout changed layer')
                via_bundle['segments'].add((ri,low));endpoint=raw[ri]['route'][next_index]
                radius=F(endpoint['width'])/2
                if endpoint==output[ri]['route'][next_index]and point_segment_squared(xy(endpoint),center_old,center_new)>(outer+radius)**2:
                    via_bundle['boundaries'].append({'traceIndex':ri,'pointIndex':next_index,'direction':direction,'layer':layer,'radius':radius,'adjacentSegment':(ri,low)})
                    break
                current=next_index
    require(via_bundle['boundaries'],'Via annulus has no incident-layer attachment witnesses')
    if wire_bundle is not None:
        for pi in [p-1,p,p+1]:wire_bundle['segments'].add((wire_ti,pi));segment(wire_ti,pi)
        for pi,direction,adjacent in [(p-1,-1,p-1),(p+2,1,p+1)]:
            point=raw[wire_ti]['route'][pi]
            require(point==output[wire_ti]['route'][pi],'Wire bundle boundary moved')
            wire_bundle['boundaries'].append({'traceIndex':wire_ti,'pointIndex':pi,'direction':direction,'layer':point['layer'],'radius':F(point['width'])/2,'adjacentSegment':(wire_ti,adjacent)})
    mutable_segments=set().union(*(b['segments']for b in bundles));require(sum(len(b['segments'])for b in bundles)==len(mutable_segments),'Mutable bundles overlap raw segments')
    for bundle in bundles:
        bundle['primitives']=[segment(ri,pi)for ri,pi in sorted(bundle['segments'])]
        if bundle['id']=='via':
            bundle['primitives'] += [primitive('generated-via',v['pcb_via_id'],stack,[center_old,center_new],outer)for v in selected_vias]
    fixed=[]
    for ri,trace in enumerate(raw):
        for pi,(a,b)in enumerate(zip(trace['route'],trace['route'][1:])):
            if a['route_type']!='wire'or b['route_type']!='wire':
                if a['route_type']=='via'or b['route_type']=='via':require(xy(a)==xy(b),'Hidden noncoincident transition segment')
                continue
            require(a['layer']==b['layer']and a['width']>0 and b['width']>0,'Unsupported fixed wire material')
            if (ri,pi)not in mutable_segments:
                require(a==output[ri]['route'][pi]and b==output[ri]['route'][pi+1],'Fixed wire geometry changed outside derived mutable bundles')
                fixed.append(primitive('raw-segment',[ri,pi,pi+1],[a['layer']],[xy(a),xy(b)],max(F(a['width']),F(b['width']))/2,traceIndex=ri,owner=raw_owners[ri]['owner']))
    for via in canonical:
        if via['type']!='pcb_via'or via['pcb_via_id']in via_ids:continue
        require(0<via['hole_diameter']<via['outer_diameter'],'Unsupported fixed generated via material')
        fixed.append(primitive('generated-via',via['pcb_via_id'],stack,[xy(via)],F(via['outer_diameter'])/2))
    for oi,obstacle in enumerate(original['obstacles']):
        require(obstacle['type']in ['rect','oval']and obstacle['width']>0 and obstacle['height']>0 and set(obstacle['layers'])<=set(stack),'Unsupported original occupied outer envelope')
        w,h=F(obstacle['width'])/2,F(obstacle['height'])/2
        rotation=obstacle.get('ccwRotationDegrees',0);require(math.isfinite(rotation),'Nonfinite original rotation')
        if rotation:w=h=w+h
        elif obstacle.get('shape')=='circle'or obstacle['type']=='oval'or obstacle.get('circuitJsonMetadata',{}).get('pcb_plated_hole_id')and abs(obstacle['width']-obstacle['height'])<.001:w=h=max(w,h)
        x,y=xy(obstacle['center']);fixed.append(primitive('original-obstacle-outer-envelope',oi,obstacle['layers'],[(x-w,y-h),(x-w,y+h),(x+w,y-h),(x+w,y+h)]))
    for ci,connection in enumerate(original['connections']):
        for pi,point in enumerate(connection['pointsToConnect']):
            require(point['layer']in stack,'Unknown original terminal layer')
            fixed.append(primitive('original-required-terminal',[ci,pi],[point['layer']],[xy(point)]))
    def separated(a,b):
        gap=box_axis_gap(a['box'],b['box'])
        if gap>0:return True,{'method':'EXACT_AXIS_GAP','lowerBound':ratio(gap)}
        slack=polygon_squared(a['poly'],b['poly'])-(a['radius']+b['radius'])**2
        return slack>0,{'method':'EXACT_SQUARED_DISTANCE_SLACK','slack':ratio(slack)}
    tails={};tail_records=[]
    for bundle in bundles:
        for boundary in bundle['boundaries']:
            ri,pi,direction=boundary['traceIndex'],boundary['pointIndex'],boundary['direction'];low=pi if direction==1 else pi-1
            require(0<=low<len(raw[ri]['route'])-1 and (ri,low)not in mutable_segments,'Boundary lacks one immediate fixed tail')
            tail=next((v for v in fixed if v['kind']=='raw-segment'and v['id']==[ri,low,low+1]),None)
            require(tail is not None and tail['layers']==[boundary['layer']]and tail['radius']==boundary['radius'],'Boundary tail differs in layer/material')
            require(tail['owner']==bundle['owner'],'Fixed boundary tail has a foreign owner')
            for via in via_bundle['primitives']:
                if via['kind']=='generated-via':require(separated(via,tail)[0],'Moving drill can cut the admitted fixed tail')
            key=(ri,low,low+1);require(key not in tails,'Two bundles share one fixed tail')
            tails[key]=(bundle,boundary);tail_records.append({'id':list(key),'bundle':bundle['id'],'fixedBoundaryPoint':pi,'selectedViaSweptOuterDiskSeparated':True})
    pairs=0;axis_count=0;exact_separations=[];admitted=[];pad_ids=set();nearest={}
    for bundle in bundles:
        for moving in bundle['primitives']:
            for stationary in fixed:
                if not set(moving['layers']).intersection(stationary['layers']):continue
                pairs+=1;is_separated,witness=separated(moving,stationary)
                if is_separated:
                    if witness['method']=='EXACT_AXIS_GAP':axis_count+=1
                    else:exact_separations.append({'bundle':bundle['id'],'mutable':describe(moving),'fixed':describe(stationary),'witness':witness})
                    continue
                if stationary['kind']=='raw-segment':
                    tail=tails.get(tuple(stationary['id']));require(tail is not None,'Nonincident fixed copper contacts a mutable bundle')
                    tail_bundle,boundary=tail
                    require(tail_bundle is bundle and moving['kind']=='raw-segment'and moving['id']==[boundary['adjacentSegment'][0],boundary['adjacentSegment'][1],boundary['adjacentSegment'][1]+1],'A nonadjacent mutable primitive touches an admitted tail')
                    admitted.append({'kind':'IMMEDIATE_UNCUT_SAME_OWNER_BOUNDARY_TAIL','bundle':bundle['id'],'mutable':describe(moving),'fixed':describe(stationary),'boundaryPoint':boundary['pointIndex']})
                elif stationary['kind']=='original-obstacle-outer-envelope':
                    oi=stationary['id'];pad=original['obstacles'][oi];metadata=pad.get('circuitJsonMetadata',{});padid=metadata.get('pcb_smtpad_id')
                    require(pad['type']=='rect'and ('shape'not in pad or pad['shape']=='rect')and not pad.get('isNonPlatedHole')and not pad.get('isCopperPour')and 'pcb_plated_hole_id'not in metadata and pad.get('ccwRotationDegrees',0)==0 and len(pad['layers'])==1 and isinstance(padid,str)and padid,'Unknown/PTH/non-solid original copper overlaps a mutable bundle')
                    binding=owner('padOwners',padid);require(binding['owner']==bundle['owner'],'Contacted original SMT has foreign owner')
                    matches=[]
                    for boundary in bundle['boundaries']:
                        ri,pi=boundary['traceIndex'],boundary['pointIndex'];point=raw[ri]['route'][pi];x,y=xy(point);cx,cy=xy(pad['center'])
                        slack=min(F(pad['width'])/2-abs(x-cx),F(pad['height'])/2-abs(y-cy))-boundary['radius']
                        if boundary['layer']==pad['layers'][0]and slack>0 and moving['kind']=='raw-segment'and moving['id']==[boundary['adjacentSegment'][0],boundary['adjacentSegment'][1],boundary['adjacentSegment'][1]+1]:matches.append((boundary,slack))
                    require(len(matches)==1,'Original SMT contact lacks one contained fixed boundary disk')
                    boundary,slack=matches[0];pad_ids.add(padid);require(len(pad_ids)<=1,'More than one original SMT contact is outside trial domain')
                    admitted.append({'kind':'SAME_OWNER_SOLID_SMT_CONTAINING_FIXED_BOUNDARY_DISK','bundle':bundle['id'],'mutable':describe(moving),'originalObstacleIndex':oi,'originalPadId':padid,'originalOwnerRecord':binding,'boundaryPoint':boundary['pointIndex'],'strictDiskContainmentSlackExact':ratio(slack)})
                else:raise ValueError('Unknown/PTH/terminal/via contact is outside the relative proof domain')
    cross_pairs=[]
    for i,a in enumerate(bundles):
        for b in bundles[i+1:]:
            for x in a['primitives']:
                for y in b['primitives']:
                    if not set(x['layers']).intersection(y['layers']):continue
                    ok,witness=separated(x,y);require(ok,'Mutable bundles can create an unproved contact')
                    cross_pairs.append({'leftBundle':a['id'],'left':describe(x),'rightBundle':b['id'],'right':describe(y),'witness':witness})
    # Each layer fanout is a connected positive-width stroke containing its via
    # center and one unchanged exterior boundary. After drill subtraction every
    # retained fanout component meets positive annular land, and the declared
    # plated barrel joins the incident-layer lands. No via center is called metal.
    for boundary in via_bundle['boundaries']:
        ri,pi=boundary['traceIndex'],boundary['pointIndex'];point=xy(raw[ri]['route'][pi])
        require(point_segment_squared(point,center_old,center_new)>(outer+boundary['radius'])**2,'Via fanout boundary disk can be cut by the moving via')
    require(trial['productionStage']['baselineCertificateMatchesIndependentBefore']is True and trial['productionStage']['finalCertificateMatchesIndependentAfter']is True,'Stage full certificates do not bind independent returns')
    return {'status':'PASS_INDEPENDENT_RELATIVE_SAME_OWNER_ORIGINAL_TERMINAL_PARTITION_REPLAY','productionStageSolveCalls':1,'proposalOrRoutingCodeReimplemented':False,'arithmetic':'Exact rational binary64 source numbers; convex whole-motion stroke envelopes; strict axis or squared-distance separation.','actualMovedRawPointCount':len(allowed),'actualMoves':movements,'viaMaximumMove':.25,'wireMaximumMove':.02,'fullRawAndCanonicalProtectedMasksVerified':True,'coupledViaAliasesVerified':True,'mutableBundles':[{'id':b['id'],'owner':b['owner'],'rawSegments':[list(p)for p in sorted(b['segments'])],'viaAliases':sorted(b['vias']),'fixedBoundaries':[{k:(ratio(v)if isinstance(v,F)else v)for k,v in p.items()}for p in b['boundaries']],'primitives':[describe(v)for v in b['primitives']]}for b in bundles],'fixedPrimitiveCount':len(fixed),'fixedKinds':{k:sum(v['kind']==k for v in fixed)for k in sorted({v['kind']for v in fixed})},'originalPTHOuterEnvelopeCount':sum('pcb_plated_hole_id'in p.get('circuitJsonMetadata',{})for p in original['obstacles']),'originalRequiredTerminalCount':sum(len(c['pointsToConnect'])for c in original['connections']),'sharedLayerFixedPairs':pairs,'strictAxisSeparatedPairs':axis_count,'exactSeparatedBroadPhaseOverlaps':exact_separations,'admittedFixedInterfaces':admitted,'uncutImmediateFixedTailCapsules':tail_records,'crossBundleSeparationPairs':cross_pairs,'annulus':{'outerRadiusExact':ratio(outer),'innerDrillRadiusExact':ratio(inner),'incidentLayers':sorted({b['layer']for b in via_bundle['boundaries']}),'drillSubtractionAccountedForAllAbsorbedStrokes':True,'proof':'For any point of an incident-layer connected stroke K outside drill D, a path in K toward its center first meets annular land before D. All retained pieces attach to land; the generated plated barrel joins incident lands. Only fixed exterior boundary disks attach to unchanged components.'},'relativePartitionStatement':'For every same fixed unknown material completion within authoritative original outer envelopes, the replacement bundles have the same anchored fixed-interface relation; same-owner original-terminal partitions are preserved. Fixed unknown original PTH barrels/drills are not inferred. This does not certify the existing global partition.','sameOwnerOriginalTerminalPartitionsPreservedConditionally':True,'fullCertificateBeforeStatus':before['status'],'fullCertificateAfterStatus':after['status'],'accepted':False,'fullBoardRecovery':False,'qualityOrSpeedCredit':False,'localDatasetCheckerExecutions':0,'routingExecutions':0}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    require(os.environ.get('GITHUB_ACTIONS')=='true','Actual retained proof replay is Blacksmith-only')
    root=args.output
    read=lambda name:json.loads((root/name).read_bytes())
    value=replay(read('original-input.json'),read('raw-new-traces.json'),read('production-stage-output-traces.json'),read('canonical-circuit-json.json'),read('production-stage-trial.json'))
    target=root/'independent-relative-proof-replay.json';require(not target.exists(),'Fresh proof replay output required');target.write_text(json.dumps(value,indent=2)+'\n')
    print(json.dumps({'status':value['status'],'receiptSha256':sha(target.read_bytes()),'productionStageSolveCalls':1,'accepted':False,'fullBoardRecovery':False,'qualityOrSpeedCredit':False}))


if __name__=='__main__':main()

