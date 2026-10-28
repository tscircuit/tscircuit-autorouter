#!/usr/bin/env python3
"""Supplemental intent diagnostics; never extend original electrical identities."""
import argparse
import collections
import importlib.util
import json
import math
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('original_identity', HERE / 'inspect-via-identity-equivalence.py')
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)
base = identity.base


def wire_geometry_status(trace):
    route = trace.get('route')
    if not isinstance(route, list):
        return 'missing_route'
    if any(not isinstance(point, dict) for point in route):
        return 'unsupported_route_entry'
    wires = [p for p in route if isinstance(p, dict) and p.get('route_type') == 'wire']
    if not wires:
        return 'no_wire_points'
    if any(not all(type(p.get(k)) in [int, float] and math.isfinite(p[k]) for k in ['x', 'y', 'width']) or p['width'] <= 0 or not isinstance(p.get('layer'), str) for p in wires):
        return 'wire_coordinate_width_or_layer_unavailable'
    return 'wire_metadata_present_not_physical_validation'


class OriginalReferenceIndex:
    def __init__(self, original):
        self.original = original
        self.audit = identity.IdentityAudit(original)
        self.component_nodes = {}
        self.component_requests = collections.defaultdict(set)
        self.metadata_aliases = collections.defaultdict(list)
        self.input_trace_ids = collections.defaultdict(list)
        for index, connection in enumerate(original.get('connections', [])):
            name = connection.get('name')
            owner = self.audit.normalized_owner(name)
            component = owner.get('componentHash')
            if component:
                node = self.audit.original_request(name)
                self.component_nodes[component] = node
                self.component_requests[component].add(name)
            alias = connection.get('source_trace_id')
            if isinstance(alias, str) and alias:
                self.metadata_aliases[alias].append({'originalConnectionIndex': index, 'originalConnectionName': name, 'componentHash': component, 'originalOwnerStatus': owner['status'], 'mappingBasis': 'Original connection source_trace_id metadata maps to that connection existing proven component; alias is never added to the graph.'})
        for index, trace in enumerate(original.get('traces', [])):
            if isinstance(trace.get('pcb_trace_id'), str):
                self.input_trace_ids[trace['pcb_trace_id']].append({'originalTraceIndex': index, 'payloadHash': base.digest(trace), 'wireGeometryStatus': wire_geometry_status(trace)})
        self.nodes_to_component = {}
        for component, request_node in self.component_nodes.items():
            for node in self.audit.proof_component(request_node):
                self.nodes_to_component[node] = component
        self.ambiguous_input_trace_components = {self.nodes_to_component[identity.token('preloaded_trace', name)] for name, matches in self.input_trace_ids.items() if len({m['payloadHash'] for m in matches}) > 1 and identity.token('preloaded_trace', name) in self.nodes_to_component}
        self.original_graph_fingerprint = self.graph_fingerprint()

    def graph_fingerprint(self):
        return base.digest({'registry': {key: sorted(value) for key, value in self.audit.registry.items()}, 'typedEdges': [[left, right, evidence] for left, neighbors in self.audit.proven.edges.items() for right, evidence in neighbors]})

    def lookup(self, value):
        registry_matches = []
        for node in sorted(self.audit.registry.get(value, [])):
            component = self.nodes_to_component.get(node)
            proof = self.audit.proof_path(node, self.component_nodes[component]) if component else None
            registry_matches.append({'typedOriginalIdentity': node, 'componentHash': component, 'mappingBasis': 'Exact original identity registry entry', 'proof': {'edgeCount': len(proof), 'pathHash': base.digest(proof), 'edges': proof[:12], 'truncated': len(proof) > 12} if proof is not None else None})
        metadata = self.metadata_aliases.get(value, [])
        matches = registry_matches + metadata
        known = sorted({m['componentHash'] for m in matches if m.get('componentHash')})
        trace_matches = self.input_trace_ids.get(value, [])
        malformed_wire = any(t['wireGeometryStatus'] != 'wire_metadata_present_not_physical_validation' for t in trace_matches)
        duplicate_trace_id = len({t['payloadHash'] for t in trace_matches}) > 1
        if not matches:
            status = 'unresolved_not_an_original_identity_or_source_trace_metadata_alias'
        elif any(not m.get('componentHash') for m in matches):
            status = 'unresolved_original_identity_without_unique_proven_component'
        elif any(component in self.ambiguous_input_trace_components for component in known):
            status = 'unresolved_component_contains_ambiguous_original_trace_id'
        elif len(known) != 1:
            status = 'unresolved_multiple_existing_original_components'
        elif duplicate_trace_id:
            status = 'unresolved_duplicate_original_trace_identifier'
        elif malformed_wire:
            status = 'unresolved_referenced_original_wire_geometry'
        else:
            status = 'one_existing_original_component'
        return {'value': value, 'status': status, 'existingComponentMatches': known, 'registryMatches': registry_matches[:12], 'registryMatchCount': len(registry_matches), 'originalSourceTraceMetadataMatches': metadata[:12], 'originalSourceTraceMetadataMatchCount': len(metadata), 'originalInputTraceMatches': trace_matches[:12], 'originalInputTraceMatchCount': len(trace_matches)}

    def trace_intent(self, trace, solver_output_trace_ids=()):
        before = self.original_graph_fingerprint
        references = []
        malformed = []
        def lookup(value):
            result = self.lookup(value)
            if value in solver_output_trace_ids:
                result = {**result, 'originalLookupStatus': result['status'], 'status': 'unresolved_reference_also_matches_solver_output_trace_id'}
            return result
        if 'connectsTo' in trace:
            if not isinstance(trace['connectsTo'], list):
                malformed.append({'field': 'connectsTo', 'reason': 'not_an_array'})
            else:
                for index, value in enumerate(trace['connectsTo']):
                    if not isinstance(value, str) or not value:
                        malformed.append({'field': 'connectsTo', 'index': index, 'value': value, 'reason': 'not_a_nonempty_string'})
                    else:
                        references.append({'field': 'connectsTo', 'index': index, **lookup(value)})
        if 'source_trace_id' in trace:
            value = trace['source_trace_id']
            if not isinstance(value, str) or not value:
                malformed.append({'field': 'source_trace_id', 'value': value, 'reason': 'not_a_nonempty_string'})
            else:
                references.append({'field': 'source_trace_id', **lookup(value)})
        component_matches = sorted({component for ref in references for component in ref['existingComponentMatches']})
        geometry = wire_geometry_status(trace)
        if malformed:
            classification = 'unresolved_malformed_reference_metadata'
        elif not references:
            classification = 'unresolved_missing_original_references'
        elif any(ref['status'] != 'one_existing_original_component' for ref in references):
            classification = 'unresolved_at_least_one_reference'
        elif len(component_matches) != 1:
            classification = 'unresolved_references_target_different_original_components'
        elif geometry != 'wire_metadata_present_not_physical_validation':
            classification = 'unresolved_queried_wire_geometry'
        else:
            classification = 'unique_intended_original_component_supplemental_only'
        return {'pcb_trace_id': trace.get('pcb_trace_id'), 'connection_name': trace.get('connection_name'), 'rawTracePayloadHash': base.digest(trace), 'originalNormalizationStatus': self.audit.normalized_owner(trace.get('connection_name')), 'providedConnectsTo': trace.get('connectsTo'), 'providedSourceTraceId': trace.get('source_trace_id'), 'referenceCount': len(references), 'references': references, 'malformedReferences': malformed, 'candidateExistingOriginalComponents': component_matches, 'classification': classification, 'intendedComponentHash': component_matches[0] if classification == 'unique_intended_original_component_supplemental_only' else None, 'intendedOriginalRequestExamples': sorted(self.component_requests[component_matches[0]])[:8] if classification == 'unique_intended_original_component_supplemental_only' else [], 'queriedWireGeometryStatus': geometry, 'originalGraphFingerprint': before, 'qualification': 'Supplemental intended-ownership metadata projection only. It is not a new original electrical identity proof, permission to merge owners, physical validation, automatic acceptance or an update to existing normalized copper metrics. Every supplied reference must resolve unambiguously to one already proven original component. Solver-created trace IDs and aliases are never registered or followed recursively.'}


def inspect(directory, expected, verified):
    wanted = {key: expected[key] for key in ['runId', 'controllerSha', 'baselineSha', 'candidateSha', 'pr', 'dataset']}
    if verified.get('qualification') != 'PROVENANCE_CHECKS_PASSED' or verified.get('expectedProvenance') != wanted or verified.get('sourceArtifact') != expected['artifact'] or verified.get('sourceArtifactMetadataVerification', {}).get('qualification') != 'EXACT_ARTIFACT_METADATA_VERIFIED':
        raise ValueError('A matching successful pinned artifact inspection is required')
    roots = [path.parent for path in directory.rglob('provenance.json') if base.read(path).get('dataset') == expected['dataset'] and base.read(path).get('experiment', {}).get('pr') == expected['pr']]
    if len(roots) != 1:
        raise ValueError('Expected one exact source artifact root')
    rows = []
    for path in sorted(roots[0].rglob('audit-result.json')):
        record = base.read(path)
        if record.get('round') != 1 or record.get('arm') != 'B':
            continue
        raw = path.parent / 'raw'
        if not (raw / 'raw-new-traces.json').exists():
            continue
        if record.get('sha') != expected['candidateSha'] or base.file_digest(raw / 'original-input.json') != expected['inputHashes'].get(str(record['sampleNumber'])):
            raise ValueError('Source identity does not match expected captured input')
        capture = base.read(raw / 'capture-provenance.json')
        if base.file_digest(raw / 'raw-new-traces.json') != capture.get('rawNewTracesHash'):
            raise ValueError('Raw copper differs from verified capture hash')
        original, traces = base.read(raw / 'original-input.json'), base.read(raw / 'raw-new-traces.json')
        index = OriginalReferenceIndex(original)
        before = index.graph_fingerprint()
        output_ids = {trace.get('pcb_trace_id') for trace in traces if isinstance(trace.get('pcb_trace_id'), str)}
        official = record.get('official') or {}
        supplemental = base.read(raw / 'supplemental-validation.json') if (raw / 'supplemental-validation.json').exists() else {}
        quality = {'officialDidSolve': official.get('didSolve'), 'officialDidTimeout': official.get('didTimeout'), 'officialRelaxedDrcPassed': official.get('relaxedDrcPassed'), 'referenceFullCopperCount': supplemental.get('referenceFullCopperChecks', {}).get('count'), 'controllerError': record.get('controllerError')}
        for trace in traces:
            if index.audit.normalized_owner(trace.get('connection_name')).get('status') != 'resolved_explicit_identity_component':
                rows.append({'sample': record['sampleNumber'], 'arm': 'B', 'round': 1, 'quality': quality, **index.trace_intent(trace, output_ids)})
        if before != index.graph_fingerprint():
            raise AssertionError('Supplemental trace queries altered original graph identities')
    return {'sourceArtifact': expected['artifact'], 'expectedProvenance': wanted, 'qualification': 'SUPPLEMENTAL_INTENT_DIAGNOSTIC_ON_VERIFIED_CAPTURES_ONLY', 'firstRoundOnly': True, 'results': rows, 'limits': 'Existing electrical graph and existing normalized copper metrics are unchanged. These metadata lookups can describe intended ownership only; unresolved references, including solver-created parents, remain unresolved. No coordinate/suffix inference, recursive derived-alias lookup, new union, physical acceptance or length projection is performed. Failed/partial outputs retain their own quality labels and must never be pooled with successful routing claims.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=pathlib.Path, required=True)
    parser.add_argument('--expected', type=pathlib.Path, required=True)
    parser.add_argument('--inspection', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--examples-per-class', type=int, default=3)
    args = parser.parse_args()
    report = inspect(args.directory, base.read(args.expected), base.read(args.inspection))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(base.canonical(report) + '\n')
    counts = collections.Counter((row['classification'], base.canonical(row['quality'])) for row in report['results'])
    print('INTENDED_TRACE_REF_SUMMARY_JSON ' + base.canonical({'expectedProvenance': report['expectedProvenance'], 'qualification': report['qualification'], 'traceCount': len(report['results']), 'countsByClassificationAndQuality': [{'classification': key[0], 'quality': json.loads(key[1]), 'count': value} for key, value in counts.items()]}))
    printed = collections.Counter()
    limit = max(0, min(args.examples_per_class, 5))
    for row in report['results']:
        if printed[row['classification']] < limit:
            print('INTENDED_TRACE_REF_EXAMPLE_JSON ' + base.canonical(row))
            printed[row['classification']] += 1


if __name__ == '__main__':
    main()
