"""One synthetic raw/canonical manufactured-transition witness test."""
import copy
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
s = importlib.util.spec_from_file_location('mst_transition_test', ROOT/'layer-aware-mst-transition-audit.py')
q = importlib.util.module_from_spec(s); s.loader.exec_module(q)


def fixture():
    original = {'layerCount': 2, 'minViaDiameter': .3, 'minViaHoleDiameter': .15, 'connections': [], 'obstacles': []}
    pairs = {'connections': []}; traces = []; canonical = []
    report = {'traceOwners': [], 'padOwners': [], 'viaOwners': []}; requirements = {'sixDroppedDemands': []}
    wire = lambda x, layer: {'route_type': 'wire', 'x': x, 'y': 0, 'layer': layer, 'width': .1}
    for i in range(6):
        x = i * 10; net = 'N' + str(i); ids = ['port' + str(i) + 'top', 'port' + str(i) + 'bottom']; owner = 'owner' + str(i)
        terminals = [{'x': x, 'y': 0, 'layer': layer, 'pointId': identifier, 'pcb_port_id': identifier} for layer, identifier in zip(['top', 'bottom'], ids)]
        original['connections'].append({'name': net, 'pointsToConnect': terminals})
        pairname = 'pair' + str(i); traceid = pairname + '_0'
        pairs['connections'].append({'name': pairname, '__rootConnectionNames': [net], 'pointsToConnect': copy.deepcopy(terminals)})
        requirements['sixDroppedDemands'].append({'missingPointId': ids[1], 'requiredLayer': 'bottom', 'xy': [x, 0], 'original': [{'connection': net, 'point': copy.deepcopy(point)} for point in terminals]})
        for side, layer in enumerate(['top', 'bottom']):
            identifier = 'pad' + str(i) + layer
            original['obstacles'].append({'type': 'rect', 'center': {'x': x, 'y': 0}, 'width': .4, 'height': .4, 'layers': [layer], 'circuitJsonMetadata': {'pcb_smtpad_id': identifier}})
            canonical.append({'type': 'pcb_smtpad', 'pcb_smtpad_id': identifier, 'x': x, 'y': 0, 'width': .4, 'height': .4, 'shape': 'rect', 'layer': layer})
            report['padOwners'].append({'originalId': identifier, 'status': 'RESOLVED', 'owner': owner})
        route = [wire(x, 'top'), wire(x + .8, 'top'), {'route_type': 'via', 'x': x + .8, 'y': 0, 'from_layer': 'top', 'to_layer': 'bottom'}, wire(x + .8, 'bottom'), wire(x, 'bottom')]
        trace = {'pcb_trace_id': traceid, 'connection_name': net, 'connectsTo': ids, 'route': route}; traces.append(trace)
        canonical.append({'type': 'pcb_trace', 'pcb_trace_id': traceid, 'route': copy.deepcopy(route)})
        canonical.append({'type': 'pcb_via', 'pcb_via_id': 'via_' + str(i), 'pcb_trace_id': traceid, 'x': x + .8, 'y': 0, 'outer_diameter': .3, 'hole_diameter': .15, 'layers': ['top', 'bottom']})
        report['traceOwners'].append({'originalId': traceid, 'status': 'RESOLVED', 'owner': owner})
        report['viaOwners'].append({'originalId': 'via_' + str(i), 'status': 'RESOLVED', 'owner': owner})
    return [original, pairs, traces, canonical, report, requirements]


def main():
    values = fixture(); result = q.audit(*values, target_case=True)
    assert result['targetSMTTransitionWitness']['status'] == 'PROVEN_STRUCTURAL' and result['targetSMTTransitionWitness']['proven'] == 6
    assert result['rawLayerChangeCount'] == 0 and result['explicitViaTransitionCount'] == 6 and result['electricalPass'] == 'UNPROVEN'
    checks = ['six-real-coincident-SMT-routes-preserve-native-grid-via-landings-outside-pads']
    def canonical_trace(args): return next(value for value in args[3] if value.get('type') == 'pcb_trace' and value['pcb_trace_id'] == 'pair0_0')
    def canonical_via(args): return next(value for value in args[3] if value.get('pcb_via_id') == 'via_0')
    def reject(name, mutate):
        args = copy.deepcopy(values); mutate(args); result = q.audit(*args, target_case=True)
        assert result['targetSMTTransitionWitness']['status'] != 'PROVEN_STRUCTURAL', name
        assert result['sourceIntegrityFailure'] is False and result['electricalPass'] == 'UNPROVEN'
        checks.append(name)
    def remove_via(args):
        args[2][0]['route'].pop(2); canonical_trace(args)['route'].pop(2)
    reject('wire-top-to-wire-bottom-orphan-planned-canonical-via-is-not-proof', remove_via)
    reject('missing-canonical-manufactured-via', lambda x: x[3].remove(canonical_via(x)))
    reject('canonical-via-wrong-physical-position', lambda x: canonical_via(x).update(x=.9))
    reject('canonical-via-wrong-outer-material', lambda x: canonical_via(x).update(outer_diameter=.6))
    reject('canonical-via-wrong-drill', lambda x: canonical_via(x).update(hole_diameter=.2))
    reject('canonical-via-wrong-full-span', lambda x: canonical_via(x).update(layers=['top']))
    reject('canonical-via-invalid-layer-value-is-unknown', lambda x: canonical_via(x).update(layers=[{}]))
    reject('canonical-via-foreign-owner', lambda x: x[4]['viaOwners'][0].update(owner='FOREIGN'))
    reject('raw-route-foreign-owner', lambda x: x[4]['traceOwners'][0].update(owner='FOREIGN'))
    reject('SMT-anchor-foreign-owner', lambda x: x[4]['padOwners'][0].update(owner='FOREIGN'))
    def wrong_endpoint(args):
        args[2][0]['route'][0]['layer'] = 'bottom'; canonical_trace(args)['route'][0]['layer'] = 'bottom'
    reject('port-metadata-relabel-cannot-repair-wrong-actual-endpoint-layer', wrong_endpoint)
    reject('canonical-trace-hides-raw-via', lambda x: canonical_trace(x)['route'][2].update(route_type='wire'))
    def discontinuous(args):
        args[2][0]['route'][2]['x'] = .9; canonical_trace(args)['route'][2]['x'] = .9; canonical_via(args)['x'] = .9
    reject('via-exists-but-native-landing-was-overwritten', discontinuous)
    def in_pad(args):
        for index in [1, 2, 3]: args[2][0]['route'][index]['x'] = 0; canonical_trace(args)['route'][index]['x'] = 0
        canonical_via(args)['x'] = 0
    reject('explicit-via-center-still-inside-original-SMT-no-via-in-pad', in_pad)
    reject('ambiguous-original-terminal-layer-and-layers-is-unknown',lambda x:x[0]['connections'][0]['pointsToConnect'][0].update(layers=['top']))
    reject('empty-original-terminal-layer-is-unknown',lambda x:x[0]['connections'][0]['pointsToConnect'][0].update(layer=''))
    reject('missing-original-SMT-anchor-is-unknown', lambda x: x[0]['obstacles'].pop(0))
    def conflicting_alias(args):
        value = copy.deepcopy(canonical_via(args)); value['pcb_via_id'] = 'foreign_alias'; args[3].append(value)
        args[4]['viaOwners'].append({'originalId': 'foreign_alias', 'status': 'RESOLVED', 'owner': 'FOREIGN'})
    reject('same-site-foreign-alias-cannot-hide-behind-valid-alias', conflicting_alias)
    def pth_route(args):
        remove_via(args)
        args[0]['obstacles'].append({'type': 'rect', 'center': {'x': .8, 'y': 0}, 'width': .6, 'height': .6, 'layers': ['top', 'bottom'], 'circuitJsonMetadata': {'pcb_plated_hole_id': 'pth'}})
    args = copy.deepcopy(values); pth_route(args); pth = q.audit(*args, target_case=False)
    assert pth['targetSMTTransitionWitness']['status'] == 'NOT_TARGETED_CASE' and pth['rawLayerChangeCount'] == 1
    assert pth['rawLayerChanges'][0]['status'] == 'UNKNOWN' and pth['possibleOriginalPthContacts'][0]['barrelOrAnnulusContactProven'] is False
    assert pth['sourceIntegrityFailure'] is False
    checks.append('explicit-original-PTH-envelope-stays-UNKNOWN-not-blanket-invalid-or-barrel-edge')
    args = copy.deepcopy(values); args[2][0]['route'][2]['route_type'] = 'through_obstacle'
    assert q.audit(*args, target_case=True)['targetSMTTransitionWitness']['status'] != 'PROVEN_STRUCTURAL'
    checks.append('through-obstacle-needs-separate-explicit-proof')
    print(json.dumps({'status': 'PASS_RAW_STRUCTURAL_MANUFACTURED_TRANSITION_WITNESS', 'checks': checks, 'count': len(checks), 'actualDatasetCheckerExecutions': 0, 'routingExecutions': 0}))


if __name__ == '__main__': main()
