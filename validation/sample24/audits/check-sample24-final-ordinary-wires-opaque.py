#!/usr/bin/env python3
"""Independent ordinary wire capsules versus every opaque raw SRJ barrier."""
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
SPEC = importlib.util.spec_from_file_location('ordinary_wire_geometry', HERE / 'check-through-obstacle-physical-clearance.py')
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


def is_opaque(raw):
    metadata = raw.get('circuitJsonMetadata') or {}
    return (not raw.get('connectedTo') and not raw.get('offBoardConnectsTo')
            and not raw.get('isNonPlatedHole')
            and not any(metadata.get(key) for key in ('pcb_smtpad_id', 'pcb_plated_hole_id', 'pcb_port_id', 'pcb_via_id')))


def main():
    began = time.monotonic()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', default='/workspace/sample24-audit-original.srj.json')
    parser.add_argument('--routes', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--final', action='store_true')
    args = parser.parse_args()
    input_sha, routes_sha = sha(args.input), sha(args.routes)
    if input_sha != ORIGINAL_SHA:
        raise ValueError('Authoritative original sample24 input changed')
    original = json.loads(Path(args.input).read_text())
    if original['layerCount'] != 8 or original.get('allowBlindAndBuriedVias') is not False or len(original['obstacles']) != 4418:
        raise ValueError('Original raw geometry or physical stack policy changed')
    obstacles = [G.compile_obstacle(raw, index, 8) for index, raw in enumerate(original['obstacles']) if is_opaque(raw)]
    if len(obstacles) != 1918:
        raise ValueError('Opaque unowned barrier coverage differs from original 1918')
    def cells(box):
        for x in range(math.floor(box[0] / 2), math.floor(box[2] / 2) + 1):
            for y in range(math.floor(box[1] / 2), math.floor(box[3] / 2) + 1):
                yield x, y
    buckets = collections.defaultdict(list)
    for index, obstacle in enumerate(obstacles):
        for z in obstacle['layers']:
            for x, y in cells(obstacle['box']):
                buckets[z, x, y].append(index)
    findings, near_contacts, unique_pairs = [], [], set()
    trace_count = wire_count = endpoint_count = narrow_count = 0
    primitive_count_by_z = collections.Counter()
    def check(trace_index, trace, a, b, z, width, kind, point_index):
        nonlocal narrow_count
        P.finite_point(a)
        P.finite_point(b)
        z = G.z_index(z, 8)
        radius = G.number_from(width) / 2
        primitive_count_by_z[z] += 1
        box = P.bounds(a, b, radius)
        candidates = set()
        for x, y in cells(box):
            candidates.update(buckets.get((z, x, y), ()))
        for index in candidates:
            obstacle = obstacles[index]
            if not P.intersects(box, obstacle['box']):
                continue
            narrow_count += 1
            distance = P.raw_segment_distance(a, b, obstacle)
            gap = distance - radius
            if gap > 1e-9:
                continue
            finding = {'traceIndex': trace_index, 'traceId': trace.get('pcb_trace_id', trace.get('connectionName')),
                       'declaredOwnerNotAnExemption': trace.get('connection_name', trace.get('rootConnectionName')),
                       'primitiveKind': kind, 'pointIndex': point_index, 'z': z,
                       'start': {'x': a['x'], 'y': a['y']}, 'end': {'x': b['x'], 'y': b['y']},
                       'actualWidth': width, 'copperRadius': radius, 'centerlineToRawBarrierDistance': distance,
                       'actualCopperEdgeGap': gap, 'additionalOpaqueClearance': 0,
                       'rawObstacleIndex': obstacle['index'], 'rawObstacleId': obstacle['identity']}
            if gap < -1e-9:
                findings.append(finding)
                unique_pairs.add((trace_index, obstacle['index']))
            else:
                near_contacts.append(finding)
    for key, trace in G.JsonStream(args.routes).records({'traces', 'routes'}):
        if key not in ('traces', 'routes'):
            continue
        if args.final and key != 'traces':
            raise ValueError('Final audit requires the actual exported SRJ traces array')
        P.validate_peer_format(trace, original)
        for wire in P.peer_wires(trace, 8):
            # The existing fixed-obstacle checker also uses the larger endpoint
            # width for a variable-width segment. No extra .15 planning margin.
            check(trace_count, trace, wire['start'], wire['end'], wire['z'], wire['width'], 'ORDINARY_WIRE_CAPSULE', wire['segmentIndex'])
            wire_count += 1
        for point_index, point in enumerate(trace.get('route', [])):
            if point.get('route_type') == 'wire':
                z, width = point['layer'], G.number_from(point.get('width'))
            elif point.get('route_type') is None:
                z, width = point['z'], G.number_from(point.get('traceThickness'), trace.get('traceThickness'))
            else:
                continue
            if args.final and point.get('route_type') != 'wire':
                raise ValueError('Final route contains legacy HD point geometry')
            check(trace_count, trace, point, point, z, width, 'ORDINARY_WIRE_ENDPOINT_DISK', point_index)
            endpoint_count += 1
        trace_count += 1
    if not trace_count or not endpoint_count:
        raise ValueError('No ordinary wire copper; refusing vacuous coverage certification')
    result = {'scope': 'FINAL_ORDINARY_WIRES_VS_ALL_RAW_OPAQUE_BARRIERS' if args.final else 'DIAGNOSTIC_ORDINARY_WIRES_VS_ALL_RAW_OPAQUE_BARRIERS_NOT_FINAL',
              'inputSha256': input_sha, 'routesSha256': routes_sha, 'auditorSha256': sha(__file__),
              'geometryHelpersSha256': {name: sha(HERE / name) for name in ('check-through-obstacle-physical-clearance.py', 'check-sample24-final-vias-raw.py')},
              'rawObstacleCount': 4418, 'opaqueUnownedBarrierCount': len(obstacles),
              'opaqueBarrierCountByZ': dict(collections.Counter(z for o in obstacles for z in o['layers'])),
              'traceCount': trace_count, 'ordinaryWireCapsuleCount': wire_count, 'ordinaryWireEndpointDiskCount': endpoint_count,
              'ordinaryPrimitiveCountByZ': dict(primitive_count_by_z), 'narrowPhaseChecks': narrow_count,
              'additionalOpaqueClearance': 0, 'geometricCopperIntersectionCount': len(findings),
              'uniqueTraceObstacleIntersectionPairCount': len(unique_pairs), 'tangentOrWithin1eMinus9MmCount': len(near_contacts),
              'geometricCopperIntersections': findings, 'tangentOrWithin1eMinus9Mm': near_contacts,
              'stageCoverage': {'ordinaryWireCapsules': True, 'ordinaryWireEndpointDisks': True, 'all1918OriginalOpaqueBarriers': True,
                                'allDeclaredPhysicalLayers': True, 'rotationAwareRawGeometry': True,
                                'throughObstacleProjectedCopper': False, 'manufacturedVias': False, 'typedPadsAndNpth': False,
                                'boardContainment': False, 'peerCopperAndConnectivity': False},
              'passed': not findings and not near_contacts, 'elapsedSeconds': time.monotonic() - began,
              'peakRssBytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
              'qualification': 'No ownership exemption for any opaque barrier. Raw rectangle/oval/circle/polygon geometry is rotation-aware. Each ordinary segment is a round capsule at half its actual width (larger endpoint width for variable widths, matching fixed-obstacle checker), and every ordinary endpoint gets its own actual-width disk even for zero-length or connector-only neighborhoods. Opaque additional clearance is exactly zero. Positive overlap beyond1e-9mm fails; tangency/near-zero is reported and withholds pass. This does not cover through-obstacle projections, vias, typed pads, holes, board edges, peer copper, connectivity, or pipeline completion; the separate final audits remain mandatory.'}
    with open(args.report, 'x') as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps({key: value for key, value in result.items() if key not in ('geometricCopperIntersections', 'tangentOrWithin1eMinus9Mm')}))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
