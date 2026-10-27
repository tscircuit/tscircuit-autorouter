#!/usr/bin/env python3
"""Independent final wire/via/raw-pad union; net labels only restrict comparisons."""
import argparse
import collections
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import resource
import time

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('physical_geometry', HERE / 'check-through-obstacle-physical-clearance.py')
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
G = P.G
ORIGINAL_SHA = 'ba157c96251e5c53964a7fb529981fc19347865c82379558bf820fcdef6b52a7'


def sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1048576), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    began = time.monotonic()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', default='/workspace/sample24-audit-original.srj.json')
    parser.add_argument('--routes', required=True)
    parser.add_argument('--projections', required=True)
    parser.add_argument('--through-report')
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    input_sha, final_sha = sha(args.input), sha(args.routes)
    if input_sha != ORIGINAL_SHA:
        raise ValueError('Original input changed')
    original = json.loads(Path(args.input).read_text())
    if original['layerCount'] != 8 or original.get('allowBlindAndBuriedVias') is not False:
        raise ValueError('Original stack or physical via policy changed')
    projection = json.loads(Path(args.projections).read_text())
    if projection['routesSha256'] != final_sha or projection['layerCount'] != 8:
        raise ValueError('Projected through geometry belongs to another output')
    marker_keys = {(m['traceIndex'], m['markerIndex']) for m in projection['markers']}
    if projection['markerCount'] != len(projection['markers']) or len(marker_keys) != len(projection['markers']):
        raise ValueError('Inconsistent or duplicate projected marker roster')
    projected_parts = projection['projectedWires'] + projection['projectedVias']
    if any((part['traceIndex'], part['markerIndex']) not in marker_keys for part in projected_parts):
        raise ValueError('Projected copper lacks an actual declared marker')
    if not projection['markerCount'] and projected_parts:
        raise ValueError('Zero-marker projection cannot contain copper')
    if projection['markerCount']:
        if not args.through_report:
            raise ValueError('Existing-barrel markers require independent physical proof')
        through = json.loads(Path(args.through_report).read_text())
        if (through['routesSha256'] != final_sha or through['inputSha256'] != input_sha
                or through.get('projectionSha256') != sha(args.projections)
                or through.get('scope') != 'FINAL_TARGETED_THROUGH_OBSTACLE_CLEARANCE'):
            raise ValueError('Existing-barrel marker proof provenance mismatch')
        # The targeted auditor lists identity/contact/barrel witnesses separately
        # from clearance. Every retained marker must have an actual own raw PTH.
        proofs = through.get('existingBarrelProofs', [])
        if len(proofs) != len(marker_keys) or {(m['traceIndex'], m['markerIndex']) for m in proofs} != marker_keys:
            raise ValueError('An existing plated-barrel marker lacks independent identity/contact/span proof')
    owners = {c['name'] for c in original['connections']}
    terminals = {p['pcb_port_id']: (c['name'], p) for c in original['connections'] for p in c['pointsToConnect']}
    if len(owners) != 409 or len(terminals) != 2343:
        raise ValueError('Original terminal roster mismatch')
    parent, ranks = [], []
    def new_node():
        index = len(parent)
        parent.append(index)
        ranks.append(0)
        return index
    def find(node):
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node
    def join(a, b):
        a, b = find(a), find(b)
        if a == b:
            return False
        if ranks[a] < ranks[b]:
            a, b = b, a
        parent[b] = a
        ranks[a] += ranks[a] == ranks[b]
        return True
    def cells(box):
        for x in range(math.floor(box[0] / 2), math.floor(box[2] / 2) + 1):
            for y in range(math.floor(box[1] / 2), math.floor(box[3] / 2) + 1):
                yield x, y
    pads, pad_buckets, pad_by_port = {}, collections.defaultdict(list), {}
    for index, raw in enumerate(original['obstacles']):
        metadata = raw.get('circuitJsonMetadata') or {}
        if not (metadata.get('pcb_smtpad_id') or metadata.get('pcb_plated_hole_id')):
            continue
        pad = G.compile_obstacle(raw, index, 8)
        if pad['unowned'] or pad['keepout']:
            continue
        if len(pad['layers']) > 1 and not metadata.get('pcb_plated_hole_id'):
            raise ValueError('Unsupported nonplated multilayer pad')
        node = new_node()
        pads[node] = pad
        port = metadata.get('pcb_port_id')
        if port in terminals:
            if port in pad_by_port:
                raise ValueError('Ambiguous raw terminal pad')
            pad_by_port[port] = node
        for owner in pad['nets'] & owners:
            for z in pad['layers']:
                for x, y in cells(pad['box']):
                    pad_buckets[(owner, z, x, y)].append(node)
    if set(pad_by_port) != set(terminals):
        raise ValueError('A terminal lacks its immutable raw pad')
    primitives, copper_buckets = [], collections.defaultdict(list)
    copper_nodes = set()
    pad_union_count = copper_union_count = 0
    def add(owner, a, b, z, radius, node=None):
        nonlocal pad_union_count, copper_union_count
        if owner not in owners or not isinstance(z, int) or not 0 <= z < 8 or not math.isfinite(radius) or radius <= 0:
            raise ValueError('Unknown owner or invalid copper primitive')
        P.finite_point(a)
        P.finite_point(b)
        if node is None:
            node = new_node()
        copper_nodes.add(node)
        box = P.bounds(a, b, radius)
        occupied = list(cells(box))
        candidate_pads, candidate_copper = set(), set()
        for x, y in occupied:
            key = owner, z, x, y
            candidate_pads.update(pad_buckets.get(key, ()))
            candidate_copper.update(copper_buckets.get(key, ()))
        for pad_node in candidate_pads:
            pad = pads[pad_node]
            if find(node) != find(pad_node) and P.intersects(box, pad['box']) and P.raw_segment_distance(a, b, pad) < radius - 1e-9:
                pad_union_count += join(node, pad_node)
        for index in candidate_copper:
            c, d, peer_radius, peer_box, peer_node = primitives[index]
            if find(node) != find(peer_node) and P.intersects(box, peer_box) and P.segment_distance(a, b, c, d) < radius + peer_radius - 1e-9:
                copper_union_count += join(node, peer_node)
        index = len(primitives)
        primitives.append((a, b, radius, box, node))
        for x, y in occupied:
            copper_buckets[(owner, z, x, y)].append(index)
        return node
    trace_count = via_occurrences = 0
    metadata = {**original, **dict(G.JsonStream(args.routes).records(set()))}
    for key, trace in G.JsonStream(args.routes).records({'traces'}):
        if key != 'traces':
            continue
        trace_count += 1
        owner = trace.get('connection_name')
        if owner not in owners:
            raise ValueError('Output trace lacks an exact original owner')
        P.validate_peer_format(trace, metadata)
        # Never union an entire route by its ID: each real primitive gets a node.
        for wire in P.peer_wires(trace, 8):
            # The minimum endpoint width is contained by either constant-width
            # or interpolated-width segment semantics; never enlarge copper
            # merely to create a connectivity proof at a width transition.
            width = min(G.number_from(wire['start'].get('width')), G.number_from(wire['end'].get('width')))
            add(owner, wire['start'], wire['end'], wire['z'], width / 2)
        for via in G.trace_vias(trace, metadata, tuple(pads.values())):
            node = new_node()
            via_occurrences += 1
            for z in via['layers']:
                add(owner, via, via, z, via['padDiameter'] / 2, node)
    for wire in projection['projectedWires']:
        add(wire['connection_name'], wire['start'], wire['end'], wire['z'], wire['width'] / 2)
    for disk in projection['projectedVias']:
        # Actual helper uses a copper disk on each layer for a zero-XY
        # existing-barrel marker. This is not a newly manufactured via.
        for z in range(G.z_index(disk['minZ'], 8), G.z_index(disk['maxZ'], 8) + 1):
            add(disk['connection_name'], disk['center'], disk['center'], z, disk['diameter'] / 2)
    copper_components = {find(node) for node in copper_nodes}
    uncontacted, disconnected = [], []
    for port, node in pad_by_port.items():
        if find(node) not in copper_components:
            uncontacted.append({'owner': terminals[port][0], 'pcbPortId': port, 'rawObstacleIndex': pads[node]['index']})
    for connection in original['connections']:
        groups = collections.defaultdict(list)
        for point in connection['pointsToConnect']:
            groups[find(pad_by_port[point['pcb_port_id']])].append(point['pcb_port_id'])
        if len(groups) != 1:
            disconnected.append({'owner': connection['name'], 'componentCount': len(groups), 'terminalComponents': list(groups.values())})
    passed = not uncontacted and not disconnected
    result = {'scope': 'FINAL_INDEPENDENT_RAW_PAD_EXPORTED_COPPER_CONDUCTIVE_UNION',
              'inputSha256': input_sha, 'routesSha256': final_sha, 'projectionsSha256': sha(args.projections),
              'throughReportSha256': sha(args.through_report) if args.through_report else None,
              'auditorSha256': sha(__file__), 'traceCount': trace_count, 'manufacturedViaOccurrences': via_occurrences,
              'rawTypedPadConductorCount': len(pads), 'copperPrimitiveCount': len(primitives),
              'positiveRawPadCopperUnions': pad_union_count, 'positiveCopperCopperUnions': copper_union_count,
              'physicallyContactedOriginalTerminalCount': 2343 - len(uncontacted),
              'physicallyConnectedOriginalNetCount': 409 - len(disconnected),
              'uncontactedOriginalTerminals': uncontacted, 'disconnectedOriginalNets': disconnected,
              'passed': passed, 'elapsedSeconds': time.monotonic() - began,
              'peakRssBytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
              'qualification': 'Every wire segment and physical full8 via is a separate union node; exact original owner labels only restrict geometric comparisons and never create conductive edges. No MST identity or connectsTo field creates any edge. Positive same-layer capsule/disk/raw-pad overlap conducts, and original PTH raw conductor nodes span only their original layers. Pad-to-pad-only overlap is conservatively omitted. Clearance, hole collisions and foreign shorts need separate checks; this audit alone does not certify a solved board.'}
    with open(args.report, 'x') as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps({key: value for key, value in result.items() if key not in ('uncontactedOriginalTerminals', 'disconnectedOriginalNets')}))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
