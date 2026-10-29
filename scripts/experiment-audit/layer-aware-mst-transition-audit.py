"""Read-only raw transition witnesses; no electrical or physical checker execution.

IDs and declared owners select candidate routes. Geometry, layers, raw/canonical
via material and original SMT anchors must supply the actual witness. PTH
envelopes never supply a barrel edge here. Unsupported paths remain UNKNOWN.
"""
import math


def numeric(value): return type(value) in [int, float] and math.isfinite(value)
def xy(value): return (value.get('x'), value.get('y'))
def same_xy(a, b): return all(numeric(value.get(key)) for value in [a, b] for key in ['x', 'y']) and xy(a) == xy(b)
def layer_set(point):
    if 'layer' in point and 'layers' in point:return None
    values = point.get('layers') if 'layers' in point else [point.get('layer')]
    return set(values) if isinstance(values, list) and values and all(isinstance(value, str) and value for value in values) and len(set(values)) == len(values) else None


def via_material(original, pairs, point):
    """Independent frozen converter default/material/full drill-span policy."""
    for context in [original, pairs]:
        for key in ['minViaDiameter', 'minViaHoleDiameter', 'minViaPadDiameter', 'min_via_hole_diameter', 'min_via_pad_diameter']:
            if key in context and (not numeric(context[key]) or context[key] < 0): return None
    first = lambda values: next((value for value in values if numeric(value)), None)
    requested_hole = first([pairs.get('min_via_hole_diameter'), pairs.get('minViaHoleDiameter')])
    requested_pad = first([pairs.get('min_via_pad_diameter'), pairs.get('minViaPadDiameter'), pairs.get('minViaDiameter')])
    pad = max(requested_pad if requested_pad is not None else .3, requested_hole if requested_hole is not None else 0)
    diameter = original.get('minViaDiameter') if original.get('minViaDiameter') is not None else pad
    drill = first([pairs.get('min_via_hole_diameter'), pairs.get('minViaHoleDiameter')])
    if drill is None: drill = diameter * .5 if 'minViaDiameter' in original else requested_hole if requested_hole is not None else pad * .5
    outer, hole = point.get('via_diameter', diameter), point.get('via_hole_diameter', drill)
    count = original.get('layerCount')
    if not numeric(outer) or not numeric(hole) or not 0 < hole <= outer or type(count) is not int or not 2 <= count <= 10: return None
    stack = ['top', *[f'inner{i}' for i in range(1, count - 1)], 'bottom']
    start, end = point.get('from_layer'), point.get('to_layer')
    if start not in stack or end not in stack or start == end: return None
    low, high = sorted([stack.index(start), stack.index(end)])
    layers = point.get('layers', stack[low:high + 1]) if original.get('allowBlindAndBuriedVias') is True else stack
    if not isinstance(layers, list) or not layers or any(value not in stack for value in layers) or len(set(layers)) != len(layers) or start not in layers or end not in layers: return None
    indices = sorted(stack.index(value) for value in layers)
    if indices != list(range(indices[0], indices[-1] + 1)): return None
    return {'outer': outer, 'hole': hole, 'layers': set(layers)}


def owner_index(report, key):
    result = {}
    for value in report.get(key, []):
        identifier = value.get('originalId')
        if value.get('status') != 'RESOLVED' or not isinstance(identifier, str) or not isinstance(value.get('owner'), str) or identifier in result: return None
        result[identifier] = value
    return result


def _canonical_trace(trace, canonical):
    matches = [value for value in canonical if value.get('type') == 'pcb_trace' and value.get('pcb_trace_id') == trace.get('pcb_trace_id')]
    if len(matches) != 1 or not isinstance(matches[0].get('route'), list) or len(matches[0]['route']) != len(trace.get('route', [])): return False
    for raw, exported in zip(trace['route'], matches[0]['route']):
        fields = ['route_type', 'x', 'y', 'width', 'layer'] if raw.get('route_type') == 'wire' else ['route_type', 'x', 'y', 'from_layer', 'to_layer']
        if raw.get('route_type') not in ['wire', 'via'] or any(raw.get(key) != exported.get(key) for key in fields): return False
    return True


def _via_witness(original, pairs, point, owner, canonical, trace_owners, via_owners):
    material = via_material(original, pairs, point)
    if material is None or trace_owners is None or via_owners is None: return {'status': 'UNKNOWN', 'reason': 'Via material or original ownership is unproved'}
    aliases = [value for value in canonical if value.get('type') == 'pcb_via' and same_xy(value, point)]
    if not aliases: return {'status': 'MISSING', 'reason': 'No canonical manufactured via at the actual raw via coordinate'}
    ids = [value.get('pcb_via_id') for value in aliases]
    if not all(isinstance(value, str) for value in ids) or len(set(ids)) != len(ids): return {'status': 'UNKNOWN', 'reason': 'Ambiguous canonical via identity'}
    for value in aliases:
        record = via_owners.get(value.get('pcb_via_id'))
        linked = trace_owners.get(value.get('pcb_trace_id'))
        layers = value.get('layers')
        if record is None or linked is None or record['owner'] != owner or linked['owner'] != owner or not numeric(value.get('outer_diameter')) or not numeric(value.get('hole_diameter')) or value.get('outer_diameter') != material['outer'] or value.get('hole_diameter') != material['hole'] or not isinstance(layers, list) or any(not isinstance(layer, str) for layer in layers) or len(set(layers)) != len(layers) or set(layers) != material['layers']:
            return {'status': 'UNKNOWN', 'reason': 'Canonical same-site alias owner/material/full span does not bind to the raw via'}
    return {'status': 'PROVEN_STRUCTURAL', 'canonicalViaIds': ids, 'xy': list(xy(point)), 'fromLayer': point['from_layer'], 'toLayer': point['to_layer'], 'outerDiameter': material['outer'], 'holeDiameter': material['hole'], 'fullManufacturedLayers': sorted(material['layers']), 'sameOriginalOwner': owner}


def _pth_candidates(original, before, after):
    result = []
    for obstacle in original.get('obstacles', []):
        metadata = obstacle.get('circuitJsonMetadata', {})
        if not isinstance(metadata.get('pcb_plated_hole_id'), str): continue
        layers = obstacle.get('layers', [])
        if before.get('layer') not in layers or after.get('layer') not in layers: continue
        center = obstacle.get('center', {})
        endpoint_references = {value for point in [before, after] for key in ['start_pcb_port_id', 'end_pcb_port_id', 'pcb_port_id'] if isinstance((value := point.get(key)), str)}
        exact_reference = metadata.get('pcb_port_id') in endpoint_references
        exact_center = same_xy(before, center) and same_xy(after, center)
        if exact_reference or exact_center:
            result.append({'pcbPlatedHoleId': metadata['pcb_plated_hole_id'], 'exactOriginalPortReference': exact_reference, 'exactCenterCoincidence': exact_center, 'declaredLayers': list(layers), 'status': 'UNKNOWN', 'barrelOrAnnulusContactProven': False})
    return result


def _pad_anchor(original, canonical, pad_owners, terminal):
    """Exact original axis-aligned SMT center anchor; no nearest-pad inference."""
    if pad_owners is None or layer_set(terminal) is None or len(layer_set(terminal)) != 1: return None
    layer = next(iter(layer_set(terminal))); matches = []
    for obstacle in original.get('obstacles', []):
        metadata = obstacle.get('circuitJsonMetadata', {}); identifier = metadata.get('pcb_smtpad_id')
        if not isinstance(identifier, str) or not same_xy(obstacle.get('center', {}), terminal) or obstacle.get('layers') != [layer]: continue
        if obstacle.get('type') != 'rect' or obstacle.get('rotation', 0) not in [None, 0] or obstacle.get('ccwRotationDegrees', 0) not in [None, 0]: continue
        width, height = obstacle.get('width'), obstacle.get('height')
        if not numeric(width) or not numeric(height) or width <= 0 or height <= 0: continue
        exported = [value for value in canonical if value.get('type') == 'pcb_smtpad' and value.get('pcb_smtpad_id') == identifier]
        if len(exported) != 1: continue
        pad = exported[0]; owner = pad_owners.get(identifier)
        if owner is None or pad.get('shape') != 'rect' or not same_xy(pad, terminal) or pad.get('layer') != layer or pad.get('width') != width or pad.get('height') != height or pad.get('rotation', 0) not in [None, 0] or pad.get('ccw_rotation', 0) not in [None, 0]: continue
        matches.append({'pcbSmtpadId': identifier, 'pcbPortId': terminal['pcb_port_id'], 'owner': owner['owner'], 'x': terminal['x'], 'y': terminal['y'], 'layer': layer, 'width': width, 'height': height, 'contactScope': 'Exact original declared SMT center on its physical layer'})
    return matches[0] if len(matches) == 1 else None


def _inside_pad(point, pad):
    return abs(point['x'] - pad['x']) <= pad['width'] / 2 and abs(point['y'] - pad['y']) <= pad['height'] / 2


def _trace_witness(original, pairs, trace, canonical, trace_owners, via_owners, first, second, pads):
    route = trace.get('route'); owner_record = (trace_owners or {}).get(trace.get('pcb_trace_id'))
    if owner_record is None or any(pad['owner'] != owner_record['owner'] for pad in pads): return {'status': 'UNKNOWN', 'reason': 'Raw route and original terminal SMT owners do not agree'}
    if not isinstance(route, list) or len(route) < 3 or not _canonical_trace(trace, canonical): return {'status': 'UNKNOWN', 'reason': 'No complete raw/canonical trace geometry binding'}
    def endpoint(point, terminal): return point.get('route_type') == 'wire' and same_xy(point, terminal) and point.get('layer') in layer_set(terminal)
    if not ((endpoint(route[0], first) and endpoint(route[-1], second)) or (endpoint(route[-1], first) and endpoint(route[0], second))): return {'status': 'UNKNOWN', 'reason': 'Actual route endpoints do not contact both original SMT terminal layers'}
    vias = []
    for index, point in enumerate(route):
        kind = point.get('route_type')
        if kind == 'wire':
            if not all(numeric(point.get(key)) for key in ['x', 'y', 'width']) or point['width'] <= 0 or not isinstance(point.get('layer'), str): return {'status': 'UNKNOWN', 'reason': 'Unsupported raw wire geometry'}
        elif kind == 'via':
            via = _via_witness(original, pairs, point, owner_record['owner'], canonical, trace_owners, via_owners)
            if via['status'] != 'PROVEN_STRUCTURAL': return via
            if original.get('allowViaInPad') is not True and any(_inside_pad(point, pad) for pad in pads): return {'status': 'UNKNOWN', 'reason': 'Via center remains inside an original required SMT envelope under default no-via-in-pad policy'}
            vias.append({'pointIndex': index, **via})
        else: return {'status': 'UNKNOWN', 'reason': 'Unsupported or through-obstacle transition needs separate explicit physical proof'}
        if index == 0: continue
        previous = route[index - 1]
        if previous.get('route_type') == 'wire' and kind == 'wire':
            if previous.get('layer') != point.get('layer'): return {'status': 'UNKNOWN', 'reason': 'Wire layer change lacks an explicit manufactured transition'}
        else:
            before = previous.get('to_layer') if previous.get('route_type') == 'via' else previous.get('layer')
            after = point.get('from_layer') if kind == 'via' else point.get('layer')
            if not same_xy(previous, point) or before != after: return {'status': 'UNKNOWN', 'reason': 'Via landing is not continuous with its adjacent actual wire/layer'}
    if not vias: return {'status': 'MISSING', 'reason': 'No explicit raw/canonical manufactured via in the selected SMT transition route'}
    return {'status': 'PROVEN_STRUCTURAL', 'traceId': trace['pcb_trace_id'], 'actualEndpoints': [{'xy': list(xy(point)), 'layer': point['layer']} for point in [route[0], route[-1]]], 'vias': vias, 'originalSmtAnchors': pads, 'geometryContinuousOnEveryDeclaredLayer': True, 'canonicalTraceGeometryBound': True, 'viaCentersOutsideRequiredSmtEnvelopes': original.get('allowViaInPad') is not True, 'electricalPass': 'UNPROVEN'}


def audit(original, point_pairs, traces, canonical, declared_report, requirements, target_case=False):
    trace_owners = owner_index(declared_report, 'traceOwners'); via_owners = owner_index(declared_report, 'viaOwners'); pad_owners = owner_index(declared_report, 'padOwners')
    changes, explicit, pth, unsupported = [], [], [], []
    for ti, trace in enumerate(traces):
        route = trace.get('route', [])
        owner = (trace_owners or {}).get(trace.get('pcb_trace_id'), {}).get('owner')
        for pi, point in enumerate(route):
            if point.get('route_type') == 'via':
                explicit.append({'traceId': trace.get('pcb_trace_id'), 'traceIndex': ti, 'pointIndex': pi, 'proofScope': 'Raw/canonical via material and original owner only; adjacent wire contact is checked separately in the targeted complete-route witness', **_via_witness(original, point_pairs, point, owner, canonical, trace_owners, via_owners)})
            elif point.get('route_type') not in ['wire', 'through_obstacle']:
                unsupported.append({'traceId': trace.get('pcb_trace_id'), 'pointIndex': pi, 'routeType': point.get('route_type'), 'status': 'UNKNOWN'})
            if pi == 0: continue
            before = route[pi - 1]
            if before.get('route_type') == point.get('route_type') == 'wire' and before.get('layer') != point.get('layer'):
                candidates = _pth_candidates(original, before, point)
                row = {'traceId': trace.get('pcb_trace_id'), 'traceIndex': ti, 'beforePointIndex': pi - 1, 'afterPointIndex': pi, 'before': {'xy': list(xy(before)), 'layer': before.get('layer')}, 'after': {'xy': list(xy(point)), 'layer': point.get('layer')}, 'status': 'UNKNOWN', 'explicitViaOrThroughObstacleBetween': False, 'possibleOriginalPlatedHoleContacts': candidates, 'sourceIntegrityFailure': False}
                changes.append(row); pth.extend({'traceId': trace.get('pcb_trace_id'), 'pointIndex': pi, **candidate} for candidate in candidates)
    target = {'status': 'NOT_TARGETED_CASE', 'electricalPass': 'UNPROVEN', 'requirements': []}
    if target_case:
        target = {'status': 'UNKNOWN', 'required': len(requirements.get('sixDroppedDemands', [])), 'proven': 0, 'requirements': [], 'electricalPass': 'UNPROVEN', 'proofScope': 'Single complete raw/canonical trace, exact original axis-aligned SMT center anchors, explicit same-owner manufactured via and full layer continuity; no PTH or shared multitrace inference.'}
        for entry in requirements.get('sixDroppedDemands', []):
            identifier = entry['missingPointId']; declarations = entry.get('original', []); names = {value['connection'] for value in declarations}; item = {'pointId': identifier, 'status': 'UNKNOWN', 'witnesses': [], 'candidateTraceDiagnostics': []}
            if len(names) != 1: target['requirements'].append(item); continue
            name = next(iter(names)); connections = [value for value in original.get('connections', []) if value.get('name') == name]
            if len(connections) != 1: target['requirements'].append(item); continue
            source_points = connections[0].get('pointsToConnect', [])
            firsts = [point for point in source_points if point.get('pointId') == point.get('pcb_port_id') == identifier and xy(point) == tuple(entry['xy']) and layer_set(point) == {entry['requiredLayer']}]
            seconds = [point for point in source_points if xy(point) == tuple(entry['xy']) and layer_set(point) is not None and len(layer_set(point)) == 1 and entry['requiredLayer'] not in layer_set(point)]
            if len(firsts) != 1 or len(seconds) != 1: target['requirements'].append(item); continue
            first, second = firsts[0], seconds[0]; pads = [_pad_anchor(original, canonical, pad_owners, terminal) for terminal in [first, second]]
            if any(pad is None for pad in pads): item['reason'] = 'Unique explicit original axis-aligned SMT anchors unavailable'; target['requirements'].append(item); continue
            identifiers = {first['pcb_port_id'], second['pcb_port_id']}; pair_names = []
            for pair in point_pairs.get('connections', []):
                points = pair.get('pointsToConnect', [])
                if name not in pair.get('__rootConnectionNames', []) and pair.get('name') != name: continue
                if len(points) == 2 and {point.get('pcb_port_id') for point in points} == identifiers and all(any(same_xy(point, terminal) and layer_set(point) == layer_set(terminal) for terminal in [first, second]) for point in points): pair_names.append(pair['name'])
            selected = [trace for trace in traces if identifiers.issubset(set(trace.get('connectsTo', []))) or any(trace.get('pcb_trace_id') == value or trace.get('pcb_trace_id', '').startswith(value + '_') for value in pair_names)]
            if not pair_names: item['reason'] = 'No direct emitted coincident-layer demand; a shared multitrace witness is outside this conservative proof'
            elif not selected: item.update(status='MISSING', reason='No raw route selected for the emitted original SMT pair')
            else:
                for trace in selected:
                    witness = _trace_witness(original, point_pairs, trace, canonical, trace_owners, via_owners, first, second, pads)
                    item['candidateTraceDiagnostics'].append({'traceId': trace.get('pcb_trace_id'), **witness})
                    if witness['status'] == 'PROVEN_STRUCTURAL': item['witnesses'].append(witness)
                if item['witnesses']: item['status'] = 'PROVEN_STRUCTURAL'; target['proven'] += 1
            target['requirements'].append(item)
        if target['required'] == 6 and target['proven'] == 6: target['status'] = 'PROVEN_STRUCTURAL'
        elif target['requirements'] and all(value['status'] == 'MISSING' for value in target['requirements']): target['status'] = 'MISSING'
    return {'schemaVersion': 1, 'status': 'RAW_STRUCTURAL_TRANSITION_FACTS_ONLY', 'rawLayerChanges': changes, 'rawLayerChangeCount': len(changes), 'explicitViaTransitions': explicit, 'explicitViaTransitionCount': len(explicit), 'possibleOriginalPthContacts': pth, 'unsupportedRawPrimitives': unsupported, 'targetSMTTransitionWitness': target, 'sourceIntegrityFailure': False, 'electricalPass': 'UNPROVEN', 'requiresIndependentPhysicalChecksAndSourceProof': True, 'metadataAloneIsNotTransitionProof': True}
