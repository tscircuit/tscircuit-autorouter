"""Source-bound MST logical-demand coverage, distinct from emitted or final copper."""
import copy
import importlib.util
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
s = importlib.util.spec_from_file_location('mst_frozen_checkpoint_binding', ROOT/'pruning-context-coverage.py')
binding = importlib.util.module_from_spec(s); s.loader.exec_module(binding)
PATH = 'netToPointPairsSolver.layerAwareMstStats'
STAGE = 'netToPointPairsSolver'
FLAG = 'experimentLayerAwareMstIdentity'
COUNTS = ['connectionsProcessed', 'inputPointOccurrences', 'inputDistinctLayerKeys', 'mstCoveredLayerKeys', 'missingLayerKeys', 'coincidentCrossLayerGroups', 'zeroDistanceLayerEdges', 'mstSelectedEdges']
FIELDS = ['completed', *COUNTS]
obj, same, integer = binding.obj, binding.same, binding.integer


def contract():
    return {'statsPath': PATH, 'stageName': STAGE, 'countFields': COUNTS, 'booleanFields': ['completed'], 'scope': 'Intermediate MST selected requirements before explicit preconnection filtering and off-board substitution; not emitted point-pair or electrical proof.'}


def coverage(record, item):
    if item.get('option') != FLAG or item.get('evidencePaths') != [PATH] or not same(item.get('coverageContract'), contract()): raise ValueError('Wrong exact MST option/ledger contract')
    cp = obj(record.get('phaseCheckpointAudit')); last = obj(cp.get('lastDurableCheckpoint'))
    audit = obj(obj(obj(record.get('official')).get('routingMetrics')).get('experimentAudit'))
    terminal, durable = obj(audit.get('evidence')), obj(last.get('evidence'))
    evidence, source = (terminal, 'TERMINAL_FACTORY_AUDIT') if PATH in terminal else (durable, 'DURABLE_PHASE_CHECKPOINT')
    value = evidence.get(PATH); ledger = obj(value); bound = binding.checkpoint_bound(record, item)
    requested, observed = obj(record.get('requestedOptions')), obj(last.get('observedRequestedOptions'))
    issues = []; mechanism_issues = []; baseline = record.get('arm') == 'A'
    absence = value is None and FLAG not in requested and FLAG not in observed
    typed = isinstance(value, dict) and set(value) == set(FIELDS) and type(value.get('completed')) is bool and all(integer(value.get(key)) for key in COUNTS)
    coherent = typed and ledger['inputDistinctLayerKeys'] <= ledger['inputPointOccurrences'] and ledger['mstCoveredLayerKeys'] <= ledger['inputDistinctLayerKeys'] and ledger['missingLayerKeys'] == ledger['inputDistinctLayerKeys'] - ledger['mstCoveredLayerKeys'] and ledger['zeroDistanceLayerEdges'] <= ledger['mstSelectedEdges']
    entered = finished = threw = False
    for row in cp.get('stageBoundaries', []):
        if row.get('phaseName') == STAGE:
            entered = True
            if row.get('event') in ['phase_failed', 'lifecycle_throw', 'step_throw']: threw = True
            if row.get('event') == 'on_solved_exit' and not threw: finished = True
        elif entered and row.get('event') == 'phase_setup_enter' and not threw: finished = True
    if baseline:
        if not absence: issues.append('Native baseline unexpectedly exposes MST flag/ledger')
        status = 'BASELINE_FEATURE_ABSENT' if absence else 'BASELINE_UNEXPECTED_FEATURE'
        final = False
    else:
        if requested.get(FLAG) is not True or observed.get(FLAG) is not True: issues.append('Actual requested/observed MST flag is not true')
        if isinstance(value, dict) and not coherent: mechanism_issues.append('MST ledger is not the exact coherent typed nine-field source schema')
        if (finished or obj(record.get('official')).get('didSolve') is True) and (not coherent or ledger.get('completed') is not True): mechanism_issues.append('Completed MST phase lacks a completed source ledger')
        final = bool(bound and finished and coherent and ledger.get('completed') is True)
        status = 'COMPLETE_MST_REQUIREMENTS_COVERED' if final and ledger['missingLayerKeys'] == 0 else 'COMPLETE_MST_REQUIREMENTS_MISSING' if final else 'PARTIAL_MST_LEDGER' if coherent else 'MST_NOT_REACHED_OR_UNAVAILABLE'
    if not bound: issues.append('MST observation source/input/checkpoint binding is incomplete')
    return {'status': status, 'statsPath': PATH, 'evidenceSource': source, 'sourceBound': bound, 'actualEvidence': evidence, 'issues': issues, 'mechanismIssues': mechanism_issues,
            'stageEntered': entered, 'stageCompleted': bool(final), 'ledgerTypedAndCoherent': bool(coherent), 'ledger': ledger if coherent else None,
            'completedMstLogicalCoverageObserved': bool(final and ledger['missingLayerKeys'] == 0), 'zeroDistanceLayerEdgesObserved': ledger['zeroDistanceLayerEdges'] if coherent else None,
            'intermediateMstMarkerIsNotEmittedDemandOrElectricalProof': True, 'outputOrTimingCredit': False, 'qualityOrSpeedClaim': False}


def nonterminal_observations(record, item):
    if record.get('arm') == 'A': return []
    result = coverage(record, item)
    return [{'source': result['evidenceSource'], 'sourceBound': result['sourceBound'], 'ledger': result['ledger'], 'completedMstLogicalCoverageObserved': result['completedMstLogicalCoverageObserved'], 'phaseName': obj(obj(record.get('phaseCheckpointAudit')).get('lastDurableCheckpoint')).get('phaseName'), 'laterOutputUnknownOrFailed': obj(record.get('official')).get('didSolve') is not True, 'outputOrTimingCredit': False, 'emittedDemandProof': 'REQUIRES_INDEPENDENT_RETAINED_POINT_PAIR_CONTEXT'}]


def layers(point):
    if 'layer' in point and 'layers' in point: return None
    values = point.get('layers') if 'layers' in point else [point.get('layer')]
    if not isinstance(values, list) or not values or any(not isinstance(value, str) or not value for value in values) or len(set(values)) != len(values): return None
    return tuple(sorted(values))


def layer_key(point):
    if any(type(point.get(key)) not in [int, float] or not math.isfinite(point[key]) for key in ['x', 'y']) or layers(point) is None: return None
    return (point['x'], point['y'], layers(point))


def audit_case8(original, pairs, requirements):
    """Definite original IDs/layers plus emitted pair graph, never copper contact.

    These six original declarations have no preconnection or off-board
    equivalence. Such substitutions elsewhere remain UNKNOWN rather than an
    integrity violation or an invented emitted demand.
    """
    result = {'status': 'UNKNOWN', 'required': 6, 'retained': 0, 'requirements': [], 'logicalPointPairGraphOnly': True, 'electricalPass': 'UNPROVEN', 'sourceIntegrityFailure': False}
    if not isinstance(original, dict) or not isinstance(pairs, dict): return result
    source_connections = {value.get('name'): value for value in original.get('connections', [])}
    required = requirements.get('sixDroppedDemands', [])
    if len(required) != 6 or original.get('traces'): return result
    for entry in required:
        names = {value['connection'] for value in entry['original']}
        if len(names) != 1: return result
        name = next(iter(names)); connection = source_connections.get(name)
        if not isinstance(connection, dict) or connection.get('isOffBoard') is True or connection.get('externallyConnectedPointIds'): return result
        identifier = entry['missingPointId']; expected = (entry['xy'][0], entry['xy'][1], (entry['requiredLayer'],))
        originals = [point for point in connection.get('pointsToConnect', []) if point.get('pointId') == identifier and point.get('pcb_port_id') == identifier and layer_key(point) == expected]
        if len(originals) != 1: return result
        parents = {}; endpoints = []; direct = []
        def find(key):
            parents.setdefault(key, key)
            while parents[key] != key: parents[key] = parents[parents[key]]; key = parents[key]
            return key
        def join(a, b): parents[find(b)] = find(a)
        for pair in pairs.get('connections', []):
            if name not in pair.get('__rootConnectionNames', []) and pair.get('name') != name: continue
            if pair.get('isOffBoard') is True: return result
            points = pair.get('pointsToConnect', [])
            if len(points) != 2 or any(layer_key(point) is None for point in points): return result
            keys = [layer_key(point) for point in points]; join(*keys)
            for point in points:
                if point.get('pointId') == identifier and point.get('pcb_port_id') == identifier and layer_key(point) == expected: endpoints.append({'connection': pair['name'], 'point': point})
            if keys[0][:2] == keys[1][:2] and keys[0][2] != keys[1][2]: direct.append({'connection': pair['name'], 'layers': [list(key[2]) for key in keys]})
        counterpart_keys = {layer_key(point) for point in connection['pointsToConnect'] if (point.get('x'), point.get('y')) == expected[:2] and layer_key(point) is not None and layers(point) != expected[2]}
        path = bool(expected in parents and counterpart_keys and any(key in parents and find(key) == find(expected) for key in counterpart_keys))
        retained = bool(endpoints and path)
        result['requirements'].append({'pointId': identifier, 'originalConnection': name, 'xy': list(expected[:2]), 'requiredLayers': list(expected[2]), 'originalDeclaredIdentityVerified': True, 'emittedPairIncidences': endpoints, 'sameXYCrossLayerLogicalPath': path, 'directCoincidentLayerPairs': direct, 'retained': retained})
        result['retained'] += int(retained)
    result['status'] = 'COVERED_LOGICAL_REQUIREMENTS' if result['retained'] == 6 else 'MISSING_LOGICAL_REQUIREMENTS'
    return result
