"""One synthetic alias/whole-export binding test; no router or checker execution."""
import copy
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
s = importlib.util.spec_from_file_location('repeat_alias_mask', ROOT / 'witness-quality6-raw-proof.py')
q = importlib.util.module_from_spec(s); s.loader.exec_module(q)


def fixture():
    wire = lambda x, layer: {'route_type': 'wire', 'x': x, 'y': 0, 'width': .1, 'layer': layer}
    traces = []
    for name, start, end in [('t', 'top', 'bottom'), ('u', 'bottom', 'top'), ('w', 'top', 'bottom')]:
        traces.append({'type': 'pcb_trace', 'pcb_trace_id': name, 'connection_name': 'N', 'route': [wire(-1, start), wire(0, start), {'route_type': 'via', 'x': 0, 'y': 0, 'from_layer': start, 'to_layer': end}, wire(0, end), wire(1, end)]})
    after = copy.deepcopy(traces)
    for trace in after:
        for index in [1, 2, 3]: trace['route'][index]['y'] = -.2
    vias = [{'type': 'pcb_via', 'pcb_via_id': 'via_' + str(i), 'pcb_trace_id': name, 'x': 0, 'y': 0, 'outer_diameter': .3, 'hole_diameter': .15, 'layers': ['top', 'inner1', 'inner2', 'bottom']} for i, name in enumerate(['t', 'u'])]
    canonical = vias + [{'type': 'pcb_smtpad', 'pcb_smtpad_id': 'p', 'x': 5, 'y': 5}] + [{'type': 'pcb_trace', 'pcb_trace_id': trace['pcb_trace_id'], 'route': copy.deepcopy(trace['route'])} for trace in traces]
    changed = copy.deepcopy(canonical)
    for value in changed:
        if value['type'] == 'pcb_via': value['y'] = -.2
        if value['type'] == 'pcb_trace': value['route'] = copy.deepcopy(next(trace for trace in after if trace['pcb_trace_id'] == value['pcb_trace_id'])['route'])
    report = {'traceOwners': [{'originalId': name, 'status': 'RESOLVED', 'owner': 'O'} for name in ['t', 'u', 'w']], 'allFindings': [{'checkClass': 'viaPad', 'classification': 'DECLARED_FOREIGN_COPPER', 'owners': [{'type': 'pcb_via', 'id': 'via_' + str(i), 'owner': 'O'}, {'type': 'pcb_smtpad', 'id': 'p', 'owner': 'P'}]} for i in range(2)]}
    original = {'layerCount': 4, 'minViaDiameter': .3, 'minViaHoleDiameter': .15, 'obstacles': []}
    return [original, traces, after, canonical, changed, report, copy.deepcopy(report)]


def main():
    values = fixture(); result = q.mutation_mask(*values)
    assert result['rawViaOccurrences'] == 3 and result['canonicalViaIds'] == ['via_0', 'via_1'] and len(result['changedRawPoints']) == 9
    assert result['exactNativeDirectedTransitionAliasBijection'] and result['canonicalTraceGeometryAndProtectedMetadataBound']
    checks = ['three-raw-occurrences-two-directed-canonical-aliases-one-coupled-site']
    def reject(name, mutation):
        args = copy.deepcopy(values); mutation(args)
        try: q.mutation_mask(*args)
        except (ValueError, KeyError, TypeError, IndexError): checks.append(name); return
        raise AssertionError('Accepted forged alias mask: ' + name)
    reject('missing-alias-before', lambda x: x[3].pop(1))
    reject('missing-alias-after', lambda x: x[4].pop(1))
    reject('duplicate-canonical-ID', lambda x: x[4][1].update(pcb_via_id='via_0'))
    reject('wrong-first-contributor', lambda x: x[3][1].update(pcb_trace_id='w'))
    reject('unmoved-selected-alias', lambda x: x[4][1].update(y=0))
    reject('selected-alias-drill', lambda x: x[4][1].update(hole_diameter=.2))
    reject('selected-alias-fullspan', lambda x: x[4][1].update(layers=['top', 'bottom']))
    reject('selected-alias-duplicate-layer', lambda x: x[4][1].update(layers=['top', 'inner1', 'inner2', 'bottom', 'bottom']))
    reject('canonical-alias-order', lambda x: x[4].__setitem__(slice(0, 2), [x[4][1], x[4][0]]))
    reject('raw-contributor-missing-move', lambda x: x[2][2]['route'][2].update(y=0))
    reject('canonical-unselected-wire-width', lambda x: x[4][3]['route'][0].update(width=.2))
    reject('canonical-selected-wire-width', lambda x: x[4][3]['route'][1].update(width=.2))
    reject('canonical-trace-metadata', lambda x: x[4][3].update(source_trace_id='forged'))
    reject('protected-pad-XY', lambda x: x[4][2].update(x=6))
    reject('canonical-selected-XY-vs-raw', lambda x: x[4][3]['route'][1].update(y=-.1))
    reject('foreign-raw-contributor-owner', lambda x: [report['traceOwners'][1].update(owner='FOREIGN') for report in x[5:]])
    def extra_both(x):
        for circuit in x[3:5]: circuit.append({'type': 'pcb_via', 'pcb_via_id': 'via_2', 'pcb_trace_id': 't', 'x': 9, 'y': 9, 'outer_diameter': .3, 'hole_diameter': .15, 'layers': ['top', 'inner1', 'inner2', 'bottom']})
    reject('extra-unrelated-alias-in-BOTH-arms', extra_both)
    def same_direction(x):
        for traces in x[1:3]: traces[1]['route'][2].update(from_layer='top', to_layer='bottom')
    reject('two-aliases-for-one-directed-key', same_direction)
    def material_both(x):
        for traces in x[1:3]: traces[1]['route'][2].update(via_diameter=.6, via_hole_diameter=.3)
    reject('coincident-contributor-material-ambiguity', material_both)
    print(json.dumps({'status': 'PASS_GLOBAL_DIRECTED_ALIAS_AND_CANONICAL_RAW_MASK', 'count': len(checks), 'checks': checks, 'actualBoards': 0, 'checkerExecutions': 0}))


if __name__ == '__main__': main()
