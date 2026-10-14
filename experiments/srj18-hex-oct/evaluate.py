"""Independent SRJ copper connectivity and geometric clearance evaluator.

Units are millimeters. This evaluates SRJ geometry, not a complete fabrication DRC.
Pad-to-pad conflicts in the original input are reported separately. Conductivity
is established by physical overlap, never by merely sharing a logical net label.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from shapely import affinity, distance as geometry_distance
from shapely.geometry import Point, LineString, Polygon, box
from shapely.strtree import STRtree


class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, value):
        self.parent.setdefault(value, value)
        if self.parent[value] != value:
            self.parent[value] = self.find(self.parent[value])
        return self.parent[value]

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.parent[b] = a


def layers_for(srj):
    n = srj['layerCount']
    return ['top'] + [f'inner{i}' for i in range(1, max(1, n - 1))] + (['bottom'] if n > 1 else [])


def obstacle_geometry(obstacle):
    w, h = obstacle['width'], obstacle['height']
    if obstacle['type'] == 'oval':
        # SRJ oval pads are capsules (KiCad oval), not ellipses.
        if w >= h:
            shape = LineString([(-(w-h)/2, 0), ((w-h)/2, 0)]).buffer(h/2, quad_segs=32)
        else:
            shape = LineString([(0, -(h-w)/2), (0, (h-w)/2)]).buffer(w/2, quad_segs=32)
    elif obstacle['type'] == 'rect':
        shape = box(-w/2, -h/2, w/2, h/2)
    else:
        raise ValueError(f"Unsupported obstacle {obstacle['type']}")
    shape = affinity.rotate(shape, obstacle.get('ccwRotationDegrees', 0), origin=(0, 0))
    return affinity.translate(shape, obstacle['center']['x'], obstacle['center']['y'])


def net_model(srj):
    logical = UnionFind()
    for c in srj['connections']:
        for ident in [c['name'], c.get('source_trace_id')]:
            if ident:
                logical.union(c['name'], ident)
        for p in c['pointsToConnect']:
            for ident in [p.get('pointId'), p.get('pcb_port_id')]:
                if ident:
                    logical.union(c['name'], ident)
    for i, obstacle in enumerate(srj['obstacles']):
        labels = obstacle.get('connectedTo', [])
        first = labels[0] if labels else f'__obstacle_{i}'
        for label in labels:
            logical.union(first, label)
    conn_net = {c['name']: logical.find(c['name']) for c in srj['connections']}
    pad_net = [logical.find(o.get('connectedTo', [None])[0] if o.get('connectedTo') else f'__obstacle_{i}')
               for i, o in enumerate(srj['obstacles'])]
    return logical, conn_net, pad_net


def evaluate(srj, routed, clearance=0.1, via_diameter=0.3):
    logical, conn_net, pad_net = net_model(srj)
    physical = UnionFind()
    allowed_layers = layers_for(srj)
    items = []
    errors = []
    total_length = 0.0
    length_by_net = defaultdict(float)
    vias = []
    unresolved = []
    invalid_layers = []
    widths = []

    def add(shape, layer, net, kind, reference, node=None):
        identity = node if node is not None else f'item{len(items)}'
        physical.find(identity)
        items.append({'shape': shape, 'layer': layer, 'net': net, 'kind': kind,
                      'reference': reference, 'node': identity})

    for i, o in enumerate(srj['obstacles']):
        shape = obstacle_geometry(o)
        # Each physical plated pad is conductive across its specified layers.
        node = f'pad{i}'
        for layer in o['layers']:
            if layer in allowed_layers:
                add(shape, layer, pad_net[i], 'pad', f'pad:{i}', node)

    for c in srj['connections']:
        for i, p in enumerate(c['pointsToConnect']):
            for layer in p.get('layers', [p.get('layer')]):
                add(Point(p['x'], p['y']), layer, conn_net[c['name']], 'terminal',
                    f"terminal:{c['name']}:{i}", f"terminal:{c['name']}:{i}")

    for tindex, trace in enumerate(routed.get('traces', [])):
        ident = next((trace.get(k) for k in ['connection_name', 'source_trace_id', 'connectionName', 'net_name', 'net']
                      if trace.get(k) in logical.parent), None)
        if ident is None and trace.get('pcb_trace_id') in logical.parent:
            ident = trace['pcb_trace_id']
        net = logical.find(ident) if ident is not None else None
        route = trace.get('route', [])
        if net is None:
            # Metadata-free traces can be identified by a terminal or pad they
            # physically touch. Ambiguous nets stay unknown and fail validation.
            candidates = set()
            for p in route:
                if p.get('route_type') != 'wire':
                    continue
                point = Point(p['x'], p['y'])
                for item in items:
                    if item['kind'] in ('pad', 'terminal') and item['layer'] == p.get('layer') and item['shape'].distance(point) < 1e-6:
                        candidates.add(item['net'])
            if len(candidates) == 1:
                net = candidates.pop()
            else:
                net = f'__unknown_trace_{tindex}'
                unresolved.append({'trace': tindex, 'candidateNetCount': len(candidates)})
        for i, p in enumerate(route):
            if p['route_type'] == 'via':
                diameter = p.get('outer_diameter', p.get('diameter', p.get('via_diameter', via_diameter)))
                start, end = p.get('from_layer', 'top'), p.get('to_layer', 'bottom')
                if start not in allowed_layers or end not in allowed_layers:
                    invalid_layers.append({'trace': tindex, 'point': i, 'layers': [start, end]})
                    continue
                # SRJ18 experiments use drilled through vias. Layer endpoint
                # fields describe the route transition; the barrel crosses
                # the full stack unless a blind/buried via is explicit.
                if p.get('via_type') in ('blind', 'buried'):
                    a, b = sorted([allowed_layers.index(start), allowed_layers.index(end)])
                else:
                    a, b = 0, len(allowed_layers)-1
                shape = Point(p['x'], p['y']).buffer(diameter/2, quad_segs=32)
                node = f'via:{tindex}:{i}'
                for layer in allowed_layers[a:b+1]:
                    add(shape, layer, net, 'via', node, node)
                vias.append((round(p['x'], 6), round(p['y'], 6), start, end, net))
            elif p['route_type'] == 'wire':
                layer = p.get('layer')
                width = p.get('width', srj['minTraceWidth'])
                widths.append(width)
                if layer not in allowed_layers:
                    invalid_layers.append({'trace': tindex, 'point': i, 'layer': layer})
                    continue
                if i + 1 >= len(route):
                    continue
                q = route[i+1]
                target = q.get('start') if q['route_type'] == 'through_obstacle' else q
                if 'x' not in target or 'y' not in target:
                    errors.append({'type': 'unsupported_route_transition', 'trace': tindex, 'point': i})
                    continue
                if q['route_type'] == 'wire' and q.get('layer') != layer:
                    errors.append({'type': 'wire_layer_change_without_via', 'trace': tindex, 'point': i})
                    continue
                if q['route_type'] == 'via' and layer not in [q.get('from_layer'), q.get('to_layer')]:
                    errors.append({'type': 'wire_to_wrong_via_layer', 'trace': tindex, 'point': i})
                    continue
                if q['route_type'] == 'through_obstacle' and layer != q['from_layer']:
                    errors.append({'type': 'wire_to_wrong_obstacle_layer', 'trace': tindex, 'point': i})
                    continue
                length = math.hypot(target['x']-p['x'], target['y']-p['y'])
                total_length += length
                length_by_net[net] += length
                shape = LineString([(p['x'], p['y']), (target['x'], target['y'])]).buffer(width/2, quad_segs=32)
                add(shape, layer, net, 'trace', f'trace:{tindex}:{i}')
            elif p['route_type'] == 'through_obstacle':
                # Existing plated-pad copper supplies conductivity; never add a
                # free virtual layer transition when no such pad is present.
                a, b = Point(p['start']['x'],p['start']['y']), Point(p['end']['x'],p['end']['y'])
                covered = any(o_net == net and p['from_layer'] in o['layers'] and p['to_layer'] in o['layers']
                              and obstacle_geometry(o).buffer(1e-5).covers(a)
                              and obstacle_geometry(o).buffer(1e-5).covers(b)
                              for o, o_net in zip(srj['obstacles'], pad_net))
                if not covered:
                    errors.append({'type': 'obstacle_transition_without_plated_pad', 'trace': tindex, 'point': i})
            else:
                errors.append({'type': 'unsupported_route_type', 'trace': tindex, 'point': i, 'routeType': p['route_type']})

    violation_counts = Counter()
    preexisting = 0
    drc_examples = []
    short_nets = set()
    by_layer = defaultdict(list)
    for index, item in enumerate(items):
        by_layer[item['layer']].append(index)
    for layer, indices in by_layer.items():
        shapes = [items[i]['shape'] for i in indices]
        tree = STRtree(shapes)
        pairs = tree.query(shapes, predicate='dwithin', distance=clearance+1e-5)
        forward = pairs[0] < pairs[1]
        left, right = pairs[0][forward], pairs[1][forward]
        distances = geometry_distance([shapes[int(i)] for i in left], [shapes[int(i)] for i in right])
        for local_a, local_b, distance in zip(left, right, distances):
            a = items[indices[int(local_a)]]
            b = items[indices[int(local_b)]]
            if a['net'] == b['net']:
                if distance <= 1e-5:
                    physical.union(a['node'], b['node'])
                continue
            if a['kind'] == 'terminal' or b['kind'] == 'terminal':
                continue
            if distance >= clearance - 1e-5:
                continue
            if a['kind'] == 'pad' and b['kind'] == 'pad':
                preexisting += 1
                continue
            kind = 'short' if distance < 1e-5 else 'clearance'
            violation_counts[kind] += 1
            if kind == 'short':
                short_nets.update([a['net'], b['net']])
            if len(drc_examples) < 200:
                drc_examples.append({'type': kind, 'layer': layer, 'a': a['reference'],
                    'b': b['reference'], 'edgeGapMm': round(distance, 8)})

    boundary = Polygon([(p['x'], p['y']) for p in srj.get('outline', [])]) if len(srj.get('outline', [])) >= 3 else box(srj['bounds']['minX'],srj['bounds']['minY'],srj['bounds']['maxX'],srj['bounds']['maxY'])
    if not boundary.is_valid:
        boundary = boundary.buffer(0)
    usable = boundary.buffer(-clearance)
    outside_items = []
    for item in items:
        if item['kind'] in ('trace', 'via') and not usable.buffer(1e-5).covers(item['shape']):
            outside_items.append({'reference': item['reference'], 'layer': item['layer']})

    completion = []
    clean_completed = 0
    completed = 0
    required = 0
    for c in srj['connections']:
        if len(c['pointsToConnect']) <= 1:
            continue
        required += 1
        roots = [physical.find(f"terminal:{c['name']}:{i}") for i in range(len(c['pointsToConnect']))]
        connected = len(set(roots)) == 1
        completed += int(connected)
        clean_completed += int(connected and conn_net[c['name']] not in short_nets)
        completion.append({'name': c['name'], 'connected': connected, 'terminalComponents': len(set(roots)),
                           'terminalCount': len(roots), 'netHasShort': conn_net[c['name']] in short_nets})
    electrical = defaultdict(list)
    for c in srj['connections']:
        for i,p in enumerate(c['pointsToConnect']):
            electrical[conn_net[c['name']]].append((p['x'],p['y'],p.get('layer',tuple(p.get('layers',[]))),
                physical.find(f"terminal:{c['name']}:{i}")))
    electrical_required = electrical_completed = 0
    electrical_details = []
    for net,points in electrical.items():
        if len({p[:3] for p in points}) < 2:
            continue
        electrical_required += 1
        connected = len({p[3] for p in points}) == 1
        electrical_completed += int(connected)
        electrical_details.append({'net':net,'connected':connected,'terminalCount':len({p[:3] for p in points}),
            'traceLengthMm':round(length_by_net[net],5),'viaCount':len({v for v in vias if v[-1]==net}),
            'netHasShort':net in short_nets})
    return {
        'sourceName': srj.get('sourceName'), 'routeRequiredConnections': required,
        'trivialConnectionsExcluded': len(srj['connections'])-required,
        'physicallyConnected': completed, 'connectedWithoutShort': clean_completed,
        'completionPercent': 100*completed/required if required else 100,
        'fullyConnected': completed == required,
        'electricalNetsRequired': electrical_required, 'electricalNetsConnected': electrical_completed,
        'traceLengthMm': round(total_length, 4), 'viaCount': len(set(vias)),
        'traceCount': len(routed.get('traces', [])),
        'newShortPairs': violation_counts['short'], 'newClearancePairs': violation_counts['clearance'],
        'preexistingPadConflicts': preexisting, 'outsideCopperItems': len(outside_items),
        'invalidLayerItems': len(invalid_layers), 'unknownTraceNets': len(unresolved),
        'malformedRouteItems': len(errors), 'belowMinWidthItems': sum(w < srj['minTraceWidth']-1e-6 for w in widths),
        'drcPass': not (sum(violation_counts.values()) or outside_items or invalid_layers or unresolved or errors or any(w < srj['minTraceWidth']-1e-6 for w in widths)),
        'elapsedMs': routed.get('experiment', {}).get('elapsedMs'),
        'solverStatus': routed.get('experiment', {}).get('status'),
        'rules': {'clearanceMm': clearance, 'defaultViaDiameterMm': via_diameter, 'geometryToleranceMm': 1e-5},
        'connections': completion, 'drcExamples': drc_examples,
        'electricalNets': electrical_details,
        'outsideExamples': outside_items[:50], 'invalidLayers': invalid_layers[:50],
        'unknownNets': unresolved[:50], 'malformedRoutes': errors[:50]
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--results', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--clearance', type=float, default=0.1)
    parser.add_argument('--via-diameter', type=float, default=0.3)
    parser.add_argument('--reuse', action='store_true', help='Reuse only evaluations with matching input, result, rules and evaluator hashes')
    args = parser.parse_args()
    rows = []
    args.out.mkdir(parents=True, exist_ok=True)
    evaluator_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    for variant in sorted(p for p in args.results.iterdir() if p.is_dir()):
        paths = {p.stem:p for p in sorted(variant.glob('sample*.json')) if re.fullmatch(r'sample\d{3}',p.stem)}
        for p in sorted(variant.glob('sample*/routed.json')):
            paths.setdefault(p.parent.name,p)
        for path in paths.values():
            sample = path.parent.name if path.name == 'routed.json' else path.stem
            if not re.fullmatch(r'sample\d{3}', sample):
                continue
            source_bytes = (args.dataset / f'{sample}.json').read_bytes()
            result_bytes = path.read_bytes()
            provenance = {'inputSha256':hashlib.sha256(source_bytes).hexdigest(),
                'resultSha256':hashlib.sha256(result_bytes).hexdigest(), 'evaluatorSha256':evaluator_hash,
                'clearanceMm':args.clearance, 'defaultViaDiameterMm':args.via_diameter}
            directory = args.out / variant.name
            directory.mkdir(exist_ok=True)
            metrics_path = directory / f'{sample}.json'
            cached = json.loads(metrics_path.read_text()) if args.reuse and metrics_path.exists() else None
            if cached is not None and cached.get('evaluationProvenance') == provenance:
                metrics = cached
            else:
                metrics = evaluate(json.loads(source_bytes), json.loads(result_bytes), args.clearance, args.via_diameter)
                metrics['evaluationProvenance'] = provenance
            metrics['sample'] = sample
            metrics['variant'] = variant.name
            metrics_path.write_text(json.dumps(metrics, indent=2))
            rows.append({k: v for k, v in metrics.items() if not isinstance(v, (list, dict))})
            print(variant.name, sample, f"{metrics['physicallyConnected']}/{metrics['routeRequiredConnections']}",
                  'shorts',metrics['newShortPairs'],'clearances',metrics['newClearancePairs'],flush=True)
    (args.out / 'summary.json').write_text(json.dumps(rows, indent=2))
    if rows:
        with (args.out / 'summary.csv').open('w') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)


if __name__ == '__main__':
    main()
