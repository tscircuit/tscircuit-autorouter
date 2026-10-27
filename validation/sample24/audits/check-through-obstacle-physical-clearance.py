#!/usr/bin/env python3
"""Targeted clearance audit of ACTUAL projected through_obstacle wires only.

Consumes collect-through-obstacle-projections.ts output. Streams all raw
obstacles and routed peer copper, without evaluating unrelated board pairs.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
import resource
import sys

SPEC = importlib.util.spec_from_file_location("raw_geometry", os.path.join(os.path.dirname(__file__), "check-sample24-final-vias-raw.py"))
G = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(G)
G.META_KEYS.update({"bounds", "outline", "defaultObstacleMargin", "minTraceToPadEdgeClearance", "minTraceToHoleEdgeClearance", "minBoardEdgeClearance"})
EPS = 1e-6


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def source_nets(route):
    aliases = G.route_nets({**route, "connectsTo": [*route.get("connectsTo", []), *route.get("rootAliases", [])]})
    roots = {G.re.sub(r"_mst\d+(?:_.*)?$", "", name) for name in aliases if name.startswith("source_net_")}
    return roots or aliases


def finite_point(point):
    if not all(isinstance(point.get(k), (int, float)) and math.isfinite(point[k]) for k in ["x", "y"]):
        raise ValueError("Physical segment endpoint is not finite")


def cross(a, b, c):
    return (b["x"]-a["x"])*(c["y"]-a["y"]) - (b["y"]-a["y"])*(c["x"]-a["x"])


def segment_distance(a, b, c, d):
    ca, cb, cc, cd = cross(a,b,c), cross(a,b,d), cross(c,d,a), cross(c,d,b)
    if ca*cb <= 0 and cc*cd <= 0 and max(min(a["x"],b["x"]),min(c["x"],d["x"])) <= min(max(a["x"],b["x"]),max(c["x"],d["x"])) + 1e-12 and max(min(a["y"],b["y"]),min(c["y"],d["y"])) <= min(max(a["y"],b["y"]),max(c["y"],d["y"])) + 1e-12:
        return 0.0
    return min(G.point_segment_distance(p["x"],p["y"],(u["x"],u["y"]),(v["x"],v["y"])) for p,u,v in [(a,c,d),(b,c,d),(c,a,b),(d,a,b)])


def polygon_segment_distance(a, b, points):
    if G.polygon_distance(a["x"],a["y"],points) <= 1e-12 or G.polygon_distance(b["x"],b["y"],points) <= 1e-12:
        return 0.0
    return min(segment_distance(a,b,{"x":p[0],"y":p[1]},{"x":q[0],"y":q[1]}) for p,q in zip(points,points[1:]+points[:1]))


def raw_segment_distance(a, b, obstacle):
    g = obstacle["geometry"]
    if g[0] == "polygon":
        return polygon_segment_distance(a,b,g[1])
    if g[0] == "circle":
        return max(0.0,G.point_segment_distance(g[1],g[2],(a["x"],a["y"]),(b["x"],b["y"]))-g[3])
    _,cx,cy,hx,hy,cosine,sine = g
    def local(p):
        dx,dy=p["x"]-cx,p["y"]-cy
        return {"x":dx*cosine+dy*sine,"y":-dx*sine+dy*cosine}
    a,b=local(a),local(b)
    if g[0] == "oval":
        r=min(hx,hy)
        c,d=({"x":-(hx-hy),"y":0},{"x":hx-hy,"y":0}) if hx>=hy else ({"x":0,"y":-(hy-hx)},{"x":0,"y":hy-hx})
        return max(0.0,segment_distance(a,b,c,d)-r)
    return polygon_segment_distance(a,b,[(-hx,-hy),(hx,-hy),(hx,hy),(-hx,hy)])


def bounds(a,b,radius=0):
    return (min(a["x"],b["x"])-radius,min(a["y"],b["y"])-radius,max(a["x"],b["x"])+radius,max(a["y"],b["y"])+radius)


def intersects(a,b):
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def peer_wires(route,count):
    points=route.get("route",[])
    for index,(a,b) in enumerate(zip(points,points[1:])):
        if a.get("route_type") is not None:
            if a.get("route_type") != "wire" or b.get("route_type") != "wire" or a["layer"] != b["layer"]:
                continue
            z=G.z_index(a["layer"],count)
            width=max(G.number_from(a.get("width")),G.number_from(b.get("width")))
        else:
            if a.get("toNextSegmentType") == "through_obstacle":
                continue  # Compared separately from actual-helper projections.
            za,zb=G.z_index(a["z"],count),G.z_index(b["z"],count)
            width=max(G.number_from(a.get("traceThickness"),route.get("traceThickness")),G.number_from(b.get("traceThickness"),route.get("traceThickness")))
            z=za
            if za != zb:
                if math.hypot(a["x"]-b["x"],a["y"]-b["y"]) <= 1e-9:
                    continue
                at_a=any(math.hypot(v["x"]-a["x"],v["y"]-a["y"])<1e-6 for v in route.get("vias",[]))
                at_b=any(math.hypot(v["x"]-b["x"],v["y"]-b["y"])<1e-6 for v in route.get("vias",[]))
                if at_a == at_b:
                    raise ValueError("Peer diagonal layer transition has ambiguous/missing physical via")
                z=zb if at_a else za
        finite_point(a);finite_point(b)
        if math.hypot(a["x"]-b["x"],a["y"]-b["y"]) > 1e-12:
            yield {"start":a,"end":b,"z":z,"width":width,"segmentIndex":index}


def validate_peer_format(route,metadata):
    if route.get("jumpers"):
        raise ValueError("Peer jumper copper is unsupported by this targeted audit")
    points=route.get("route",[])
    if not points:return
    if all(point.get("route_type") is None for point in points):
        if any(point.get("toNextSegmentType") not in [None,"through_obstacle"] for point in points):
            raise ValueError("Unsupported HD peer segment type")
        return
    count=metadata["layerCount"]
    def primitive(point):
        kind=point.get("route_type")
        if kind=="wire":
            finite_point(point)
            return kind,[point],{G.z_index(point["layer"],count)}
        if kind=="via":
            finite_point(point)
            ends=[G.z_index(point["from_layer"],count),G.z_index(point["to_layer"],count)]
            return kind,[point],set(range(count)) if metadata.get("allowBlindAndBuriedVias") is not True else set(range(min(ends),max(ends)+1))
        if kind=="through_obstacle":
            finite_point(point["start"]);finite_point(point["end"])
            ends=[G.z_index(point["from_layer"],count),G.z_index(point["to_layer"],count)]
            G.number_from(point.get("width"))
            return kind,[point["start"],point["end"]],set(range(min(ends),max(ends)+1))
        raise ValueError(f"Unsupported peer route-point type {kind!r}; refusing an incomplete clearance audit")
    primitives=[primitive(point) for point in points]
    for left,right in zip(primitives,primitives[1:]):
        if left[0]==right[0]=="wire":
            if not left[2]&right[2]:raise ValueError("Peer wire changes layer without a represented connector")
            continue
        if not left[2]&right[2] or not any(math.hypot(a["x"]-b["x"],a["y"]-b["y"])<1e-6 for a in left[1] for b in right[1]):
            raise ValueError("Peer wire/connector adjacency lacks a coincident physical anchor")


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input",default="/workspace/sample24-audit-original.srj.json")
    parser.add_argument("--routes",required=True)
    parser.add_argument("--projections",required=True)
    parser.add_argument("--report",required=True)
    parser.add_argument("--final",action="store_true")
    args=parser.parse_args()
    projected=json.load(open(args.projections))
    routes_hash=sha256(args.routes)
    if projected.get("routesSha256") != routes_hash:
        raise ValueError("Projection provenance does not match the routed file")
    metadata={}
    for key,value in G.JsonStream(args.input).records(set()):metadata[key]=value
    count=metadata["layerCount"]
    if projected.get("layerCount") != count:
        raise ValueError("Projection and original board stacks differ")
    trace_gap=metadata.get("minTraceToPadEdgeClearance",0.1)
    if not isinstance(trace_gap,(int,float)) or not math.isfinite(trace_gap) or trace_gap<0:
        raise ValueError("Declared trace clearance is invalid")
    obstacles=[]
    for key,value in G.JsonStream(args.input).records({"obstacles"}):
        if key=="obstacles":
            o=G.compile_obstacle(value,len(obstacles),count)
            o["hole"]=value.get("isNonPlatedHole",False)
            obstacles.append(o)
    wires=list(projected.get("projectedWires",[]))
    if not wires and not projected.get("projectedVias"):
        raise ValueError("No through_obstacle projection; refusing a vacuous certification")
    # The actual helper represents a zero-XY through marker as copper disks.
    # A degenerate round-capped wire is exactly that disk on each occupied Z.
    projected_disk_count=0
    for disk in projected.get("projectedVias",[]):
        for z in range(G.z_index(disk["minZ"],count),G.z_index(disk["maxZ"],count)+1):
            wires.append({**disk,"start":{**disk["center"],"z":z},"end":{**disk["center"],"z":z},"z":z,"width":G.number_from(disk["diameter"]),"projectionType":"ZERO_XY_COPPER_DISK"})
            projected_disk_count+=1
    for i,wire in enumerate(wires):
        finite_point(wire["start"]);finite_point(wire["end"])
        wire["z"]=G.z_index(wire["z"],count)
        wire["width"]=G.number_from(wire["width"])
        wire["nets"]=source_nets(wire)
        wire["id"]=f"trace{wire['traceIndex']}:{wire['traceId']}:{wire['markerIndex']}:z{wire['z']}"
        wire["box"]=bounds(wire["start"],wire["end"],wire["width"]/2+trace_gap)
    markers=projected.get("markers",[])
    if len(markers)!=projected.get("markerCount"):
        raise ValueError("Projection marker count is inconsistent")
    barrel_proofs=[]
    for marker in markers:
        members=[w for w in wires if w["traceIndex"]==marker["traceIndex"] and w["markerIndex"]==marker["markerIndex"]]
        start,end=marker["markerStart"],marker["markerEnd"]
        finite_point(start);finite_point(end)
        from_z,to_z=G.z_index(marker["fromZ"],count),G.z_index(marker["toZ"],count)
        physical_span=set(range(min(from_z,to_z),max(from_z,to_z)+1))
        if len(members)!=len(physical_span) or {w["z"] for w in members}!=physical_span:
            raise ValueError("Actual-helper projection is missing a physical wire layer")
        if any(math.hypot(w["start"]["x"]-start["x"],w["start"]["y"]-start["y"])>1e-9 or math.hypot(w["end"]["x"]-end["x"],w["end"]["y"]-end["y"])>1e-9 for w in members):
            raise ValueError("Projected wire does not preserve its actual marker endpoints")
        source_id=(marker.get("circuitJsonMetadata") or {}).get("pcb_plated_hole_id")
        if not source_id:
            raise ValueError("Through marker lacks its existing plated-hole identity")
        owner=source_nets(marker)
        candidates=[o for o in obstacles if o["metadata"].get("pcb_plated_hole_id")==source_id and not o["unowned"] and not o["keepout"] and owner&o["nets"] and physical_span<=o["layers"]]
        if len(candidates)!=1:
            raise ValueError("Through marker lacks exactly one identity-matched own raw plated barrel spanning its layers")
        plate=candidates[0];width=min(w["width"] for w in members)
        distances=[G.obstacle_distance(p["x"],p["y"],plate) for p in [start,end]]
        if min(distances)+1e-9>=width/2:
            raise ValueError("Neither actual marker endpoint contacts its existing own plated copper")
        anchor=start if distances[0]<=distances[1] else end
        wire_z=to_z if anchor is start else from_z
        barrel_proofs.append({"traceIndex":marker["traceIndex"],"markerIndex":marker["markerIndex"],"sourcePlatedHoleId":source_id,"rawObstacleIndex":plate["index"],"rawBarrelLayers":sorted(plate["layers"]),"anchor":anchor,"anchorCopperDistance":min(distances),"projectedWireLayer":wire_z,"actualProjectedWireWidth":width,"sourceCenterToOutsideWireIsExplicitlyRepresented":True})
    findings=[];checked_raw=checked_peers=0
    def emit(wire,kind,gap,required,other):
        if gap+EPS >= required:return
        finding={"kind":kind,"positiveCopperOverlap":gap < -EPS,"targetId":wire["id"],"targetConnection":wire.get("connection_name"),"targetZ":wire["z"],"actualCopperEdgeGap":gap,"requiredClearance":required,"withinEngineFiveMicrometreTolerance":gap+0.005>=required,"other":other}
        findings.append(finding);print(json.dumps(finding),flush=True)
    for wire in wires:
        for obstacle in obstacles:
            if wire["z"] not in obstacle["layers"]:continue
            if not obstacle["unowned"] and not obstacle["keepout"] and wire["nets"] & obstacle["nets"]:continue
            required=metadata.get("minTraceToHoleEdgeClearance",trace_gap) if obstacle["hole"] else max(trace_gap,metadata.get("defaultObstacleMargin",0),metadata.get("minTraceToPadEdgeClearance",0))
            if not intersects(bounds(wire["start"],wire["end"],wire["width"]/2+required),obstacle["box"]):continue
            checked_raw+=1
            gap=raw_segment_distance(wire["start"],wire["end"],obstacle)-wire["width"]/2
            emit(wire,"PROJECTED_WIRE_VS_RAW",gap,required,{"obstacleIndex":obstacle["index"],"obstacleId":obstacle["identity"],"metadata":obstacle["metadata"],"keepout":obstacle["keepout"],"hasSourceNetAlias":any(n.startswith("source_net_") for n in obstacle["nets"])})
    def compare_peer(peer,nets,identity,via=False):
        nonlocal checked_peers
        for wire in wires:
            if wire["nets"] & nets:continue
            if via:
                if wire["z"] not in peer["layers"]:continue
                center={"x":peer["x"],"y":peer["y"]};peer_box=bounds(center,center,peer["padDiameter"]/2)
            else:
                if wire["z"] != peer["z"]:continue
                peer_box=bounds(peer["start"],peer["end"],peer["width"]/2)
            if not intersects(wire["box"],peer_box):continue
            checked_peers+=1
            gap=(G.point_segment_distance(peer["x"],peer["y"],(wire["start"]["x"],wire["start"]["y"]),(wire["end"]["x"],wire["end"]["y"]))-peer["padDiameter"]/2 if via else segment_distance(wire["start"],wire["end"],peer["start"],peer["end"])-peer["width"]/2)-wire["width"]/2
            emit(wire,"PROJECTED_WIRE_VS_PEER_VIA" if via else "PROJECTED_WIRE_VS_PEER_WIRE",gap,trace_gap,identity)
    trace_index=peer_wire_count=peer_via_count=0
    for key,route in G.JsonStream(args.routes).records({"traces","routes"}):
        if key not in ["traces","routes"]:continue
        validate_peer_format(route,metadata)
        nets=source_nets(route);trace_id=route.get("pcb_trace_id",route.get("connectionName",route.get("connection_name",f"trace-{trace_index}")))
        for peer in peer_wires(route,count):
            peer_wire_count+=1
            compare_peer(peer,nets,{"traceId":trace_id,"connection":route.get("connection_name",route.get("connectionName")),"segmentIndex":peer["segmentIndex"],"z":peer["z"]})
        for via in G.trace_vias(route,metadata,obstacles,skip_transition_coverage=True):
            peer_via_count+=1
            compare_peer(via,nets,{"traceId":trace_id,"connection":route.get("connection_name",route.get("connectionName")),"x":via["x"],"y":via["y"],"padDiameter":via["padDiameter"]},True)
        trace_index+=1
    for peer in wires:
        compare_peer(peer,peer["nets"],{"traceId":peer["traceId"],"connection":peer.get("connection_name"),"markerIndex":peer["markerIndex"],"z":peer["z"],"isActualProjectedThroughWire":True})
    report={"scope":"FINAL_TARGETED_THROUGH_OBSTACLE_CLEARANCE" if args.final else "INTERMEDIATE_TARGETED_THROUGH_OBSTACLE_CLEARANCE","inputPath":os.path.abspath(args.input),"inputSha256":sha256(args.input),"routesPath":os.path.abspath(args.routes),"routesSha256":routes_hash,"projectionPath":os.path.abspath(args.projections),"projectionSha256":sha256(args.projections),"rawObstacleCount":len(obstacles),"markerCount":projected["markerCount"],"projectedWireCount":len(wires),"existingBarrelProofs":barrel_proofs,"traceClearance":trace_gap,"geometricEpsilon":EPS,"rawNarrowPhaseChecks":checked_raw,"peerNarrowPhaseChecks":checked_peers,"streamedPeerTraceCount":trace_index,"streamedPeerWireCount":peer_wire_count,"streamedPeerViaCount":peer_via_count,"findingCount":len(findings),"positiveCopperOverlapCount":sum(f["positiveCopperOverlap"] for f in findings),"findingCountsByKind":{k:sum(f["kind"]==k for f in findings) for k in sorted({f["kind"] for f in findings})},"findings":findings,"peakRssBytes":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,"qualification":"Only actual through_obstacle projected wires are targets. All original raw obstacles, peer wires, peer vias and other actual projected through wires are considered; same-net copper is exempt, empty/unowned copper and keepouts are foreign. Declared clearances are checked to1e-6mm, with the engine's5um tolerance identified separately. This is not whole-board DRC or final export/connectivity certification."}
    report["projectedCopperDiskCount"]=projected_disk_count
    report["peerFormatAnchoringValidated"]=True
    with open(args.report,"w") as output:json.dump(report,output,indent=2)
    print(json.dumps({k:v for k,v in report.items() if k!="findings"}),flush=True)
    return 1 if findings else 0


if __name__=="__main__":
    try:sys.exit(main())
    except (ValueError,KeyError,TypeError,AttributeError,OSError) as error:
        print(json.dumps({"scope":"NO_TARGETED_VALIDATION_RESULT","auditError":str(error)}),flush=True);sys.exit(2)
