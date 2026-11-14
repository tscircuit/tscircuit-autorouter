"""Full native board extraction. No tracks, vias, fills or saved routes are emitted."""
import collections
import fnmatch
import gzip
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
sys.path.insert(0, "/tmp/full-board-python")
from kicad_source import components, many, one, parse
from shapely.geometry import Point, Polygon, LineString, box
from shapely.ops import unary_union
from plane_intent import extract_plane_intent

ROOT = Path(__file__).resolve().parent
IDS = ["orangecrab", "h616", "butterstick", "glider", "imx6", "icepi"]


def arc_points(shape):
    start = tuple(map(float, one(shape, "start")))
    end = tuple(map(float, one(shape, "end")))
    mid = one(shape, "mid")
    if mid:
        ax, ay = start
        bx, by = map(float, mid)
        cx, cy = end
        d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
        ux = ((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/d
        uy = ((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/d
        a, m, z = [math.atan2(y-uy, x-ux) for x, y in [start, (bx,by), end]]
        sweep = (z-a) % (2*math.pi)
        if (m-a) % (2*math.pi) > sweep:
            sweep -= 2*math.pi
    else:
        ux, uy = start
        a = math.atan2(end[1]-uy, end[0]-ux)
        sweep = math.radians(float(one(shape,"angle")[0]))
        start = end
    radius = math.hypot(start[0]-ux, start[1]-uy)
    count = max(4, math.ceil(abs(sweep)*radius/0.1))
    return [(ux+radius*math.cos(a+sweep*i/count),uy+radius*math.sin(a+sweep*i/count)) for i in range(count+1)]


def board_outline(tree):
    paths = []
    for shape in tree:
        if not isinstance(shape,list) or one(shape,"layer") != ["Edge.Cuts"]:
            continue
        if shape[0] == "gr_line":
            paths.append([tuple(map(float,one(shape,k))) for k in ["start","end"]])
        elif shape[0] == "gr_arc":
            paths.append(arc_points(shape))
        else:
            raise ValueError(f"Unsupported board edge {shape[0]}")
    ordered = paths.pop(0)
    while paths:
        match = next(((i,reverse) for i,p in enumerate(paths) for reverse in [False,True]
                      if math.dist(ordered[-1],p[-1] if reverse else p[0]) < 0.02),None)
        if match is None:
            raise ValueError("Board edge is disconnected or has multiple outlines")
        index,reverse = match
        path = paths.pop(index)
        ordered.extend((list(reversed(path)) if reverse else path)[1:])
    if math.dist(ordered[0],ordered[-1]) > 0.02:
        raise ValueError("Board edge is not closed")
    return ordered[:-1]


def custom_pad_outline(pad):
    w,h = map(float,one(pad,"size"))
    options = one(pad,"options")
    anchor = one(options,"anchor")[0]
    shapes = [Point(0,0).buffer(w/2,quad_segs=24) if anchor == "circle" else box(-w/2,-h/2,w/2,h/2)]
    for primitive in one(pad,"primitives"):
        width = float(one(primitive,"width",["0"])[0])
        if primitive[0] == "gr_poly":
            shape = Polygon([tuple(map(float,p[1:])) for p in many(one(primitive,"pts"),"xy")])
        elif primitive[0] == "gr_circle":
            center = tuple(map(float,one(primitive,"center")))
            end = tuple(map(float,one(primitive,"end")))
            shape = Point(*center).buffer(math.dist(center,end),quad_segs=24)
        elif primitive[0] == "gr_line":
            shape = LineString([tuple(map(float,one(primitive,k))) for k in ["start","end"]])
        else:
            raise ValueError(f"Unsupported custom pad primitive {primitive[0]}")
        shapes.append(shape.buffer(width/2,quad_segs=12) if width else shape)
    combined = unary_union(shapes)
    if combined.geom_type != "Polygon" or combined.interiors:
        raise ValueError("Custom pad must have one solid copper outline")
    return list(combined.exterior.coords)[:-1]


def extract(fixture):
    board_id = fixture["id"]
    origin = fixture["source"]
    cache = ROOT.parent / ".source-cache" / board_id
    raw = (cache/"board.kicad_pcb").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == origin["sourceSha256"]
    tree = parse(raw.decode())
    ddr = json.loads(gzip.decompress((ROOT.parent/fixture["file"]).read_bytes()))
    ddr_by_net = {t["nativeNet"]:t for t in ddr["traces"]}
    native_net_names = {n[1]:n[2] for n in many(tree,"net")}
    layers = [l for l in one(tree,"layers") if l[2] in ["signal","power","mixed"]]
    layer_map = {l[1]:"top" if i==0 else "bottom" if i==len(layers)-1 else f"inner{i}" for i,l in enumerate(layers)}
    edge = board_outline(tree)
    cx = (min(x for x,y in edge)+max(x for x,y in edge))/2
    cy = (min(y for x,y in edge)+max(y for x,y in edge))/2
    classes = {}
    assignments = {}
    patterns = []
    if board_id == "orangecrab":
        for rule in many(tree,"net_class"):
            classes[rule[1]] = {"clearance":float(one(rule,"clearance")[0]),"track_width":float(one(rule,"trace_width")[0])}
            assignments.update({n[1]:rule[1] for n in many(rule,"add_net")})
    else:
        project_path = str(Path(origin["path"]).with_suffix(".kicad_pro"))
        project_file = cache/"board.kicad_pro"
        project_raw = project_file.read_bytes() if project_file.exists() else urlopen(f"https://raw.githubusercontent.com/{origin['repo']}/{origin['commit']}/{quote(project_path)}",timeout=90).read()
        assert hashlib.sha256(project_raw).hexdigest() == origin["projectSha256"]
        project_file.write_bytes(project_raw)
        settings = json.loads(project_raw)["net_settings"]
        classes = {c["name"]:c for c in settings["classes"]}
        assignments = settings.get("netclass_assignments") or {}
        patterns = settings.get("netclass_patterns",[])
    endpoints = collections.defaultdict(set)
    source_counts = collections.Counter()
    name_counts = collections.Counter()
    parts = []
    for component in components(tree):
        native_ref = component["ref"]
        base = re.sub(r"[^a-zA-Z0-9_]","_",native_ref)
        name_counts[base] += 1
        name = base if name_counts[base] == 1 else f"{base}_{name_counts[base]}"
        at = component["at"]
        rotation = float(at[2]) if len(at)>2 else 0
        angle = math.radians(rotation)
        fp = component["node"]
        part = {"name":name,"nativeReference":native_ref,"value":component["value"],"footprint":component["footprint"],
                "x":float(at[0])-cx,"y":cy-float(at[1]),"layer":layer_map[one(fp,"layer")[0]],"pinLabels":{},"pads":[],"silkscreen":[]}
        aliases = {}
        for pad in many(fp,"pad"):
            if not any(l in layer_map or l in ["*.Cu","F&B.Cu"] for l in one(pad,"layers")):
                source_counts["pasteOnlyPads"] += 1
                continue
            source_counts["copperAndMechanicalPads"] += 1
            pa = one(pad,"at",["0","0"])
            px,py = map(float,pa[:2])
            pin = None
            if pad[1] and pad[2] != "np_thru_hole":
                if pad[1] not in aliases:
                    aliases[pad[1]] = f"pin{len(aliases)+1}"
                    part["pinLabels"][aliases[pad[1]]] = [f"BALL_{pad[1]}"]
                pin = aliases[pad[1]]
            net = one(pad,"net")
            source_net = native_net_names.get(net[0],net[-1]) if net and net[0]!="0" else None
            if source_net and pin:
                endpoints[source_net].add(f".{name} > .{pin}")
            w,h = map(float,one(pad,"size"))
            data = {"pin":pin,"nativePin":pad[1],"kind":pad[2],"shape":pad[3],"sourceNet":source_net,
                    "x":px*math.cos(angle)+py*math.sin(angle),"y":px*math.sin(angle)-py*math.cos(angle),
                    "width":w,"height":h,"rotation":float(pa[2]) if len(pa)>2 else 0,
                    "cornerRadius":min(w,h)*float(one(pad,"roundrect_rratio",["0"])[0])}
            drill = one(pad,"drill")
            if drill:
                data["drillWidth"] = float(drill[1] if drill[0]=="oval" else drill[0])
                data["drillHeight"] = float(drill[2] if drill[0]=="oval" else drill[0])
                offset = one(drill,"offset",["0","0"])
                data["drillOffset"] = {"x":float(offset[0]),"y":-float(offset[1])}
            if pad[3] == "custom":
                a = math.radians(data["rotation"])
                data["points"] = [{"x":x*math.cos(a)+y*math.sin(a),"y":x*math.sin(a)-y*math.cos(a)} for x,y in custom_pad_outline(pad)]
            part["pads"].append(data)
        for line in many(fp,"fp_line"):
            if one(line,"layer") not in [["F.SilkS"],["B.SilkS"]]:
                continue
            points = []
            for key in ["start","end"]:
                x,y = map(float,one(line,key))
                points.append({"x":x*math.cos(angle)+y*math.sin(angle),"y":x*math.sin(angle)-y*math.cos(angle)})
            part["silkscreen"].append(points)
        parts.append(part)
    track_widths = collections.defaultdict(collections.Counter)
    for segment in many(tree,"segment"):
        net = native_net_names[one(segment,"net")[0]]
        track_widths[net][float(one(segment,"width")[0])] += 1
    nets = []
    for index,(native_name,members) in enumerate(sorted(endpoints.items())):
        class_name = assignments.get(native_name,"Default")
        if isinstance(class_name,list):
            class_name = class_name[0]
        for pattern in patterns:
            if fnmatch.fnmatchcase(native_name,pattern["pattern"]):
                class_name = pattern["netclass"]
                break
        rule = {**classes["Default"],**classes[class_name]}
        width = track_widths[native_name].most_common(1)[0][0] if track_widths[native_name] else rule["track_width"]
        group = "board"
        if native_name in ddr_by_net:
            group = ddr_by_net[native_name]["group"]
            if group=="remaining":group="ddr_remaining"
        escape_width = min(track_widths[native_name]) if track_widths[native_name] else rule["track_width"]
        nets.append({"name":f"N{index:04}","nativeName":native_name,"members":sorted(members),"width":width,"escapeWidth":escape_width,
                     "clearance":rule["clearance"],"group":group,"routable":len(members)>1,
                     "isGround":bool(re.search(r"(^|[/_])GND(?:REF)?($|[_0-9])",native_name,re.I))})
    plane_intent = extract_plane_intent(tree, native_net_names, layer_map, edge, (cx,cy), ddr["rules"]["appliedGlobalClearance"])
    net_names = {net["nativeName"]:net["name"] for net in nets}
    for zone in plane_intent["zones"]:
        if zone["nativeName"] not in net_names:
            raise ValueError(f"Authored zone net has no retained terminals: {zone['nativeName']}")
        zone["netName"] = net_names[zone["nativeName"]]
    result = {"id":board_id,"title":fixture["title"],"source":origin,"coordinateOffset":{"x":cx,"y":cy},
              "width":max(x for x,y in edge)-min(x for x,y in edge),"height":max(y for x,y in edge)-min(y for x,y in edge),
              "outline":[{"x":x-cx,"y":cy-y} for x,y in edge],"layers":len(layers),
              "signalLayers":[layer_map[l[1]] for l in layers if l[2]!="power"],"rules":ddr["rules"],
              "parts":parts,"nets":nets,"sourceCounts":dict(source_counts),"planeIntent":plane_intent,
              "removedCopper":{"segments":len(many(tree,"segment")),"vias":len(many(tree,"via")),"zones":len(many(tree,"zone"))},
              "notes":["Every source footprint retained; graphics-only references are given unique TSX names.",
                       "All connected copper pads and one-terminal nets retained, including power, VREF and ZQ.",
                       "No source track, via, filled polygon, track-derived teardrop or saved route is imported.",
                       "Authored zone net/layer/boundary/priority/clearance intent retained; fresh pours respect higher-priority zones and pour keepouts.",
                       "Arc outlines and custom pad curves tessellated; soldermask/paste artwork and logos are not recreated.",
                       "Native placement and copper-layer count retained. No timing/impedance constraints invented."]}
    folder = ROOT/board_id
    folder.mkdir(exist_ok=True)
    (folder/"source.json").write_text(json.dumps(result,separators=(",",":"))+"\n")
    tsx = ['import type { ReactElement } from "react"','import { NativeFullBoard } from "../native-full-board"','import source from "./source.json"','',f'/** Full {fixture["title"]}; every native component/net, source copper removed. */','export default function Board(): ReactElement {','  return <NativeFullBoard source={source} />','}','']
    (folder/"board.tsx").write_text("\n".join(tsx))
    print(board_id,len(parts),"parts",sum(len(p["pads"]) for p in parts),"pads",len(nets),"nets",sum(n["routable"] for n in nets),"routable",flush=True)
    return {"id":board_id,"title":fixture["title"],"parts":len(parts),"pads":sum(len(p["pads"]) for p in parts),"nets":len(nets),"routableNets":sum(n["routable"] for n in nets),"removedCopper":result["removedCopper"]}


if __name__ == "__main__":
    fixtures = json.loads((ROOT.parent/"manifest.json").read_text())["circuits"]
    rows = [extract(next(f for f in fixtures if f["id"]==board_id)) for board_id in IDS]
    (ROOT/"manifest.json").write_text(json.dumps(rows,indent=2)+"\n")
