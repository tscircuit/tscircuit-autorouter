#!/usr/bin/env python3
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('intended', ROOT / 'inspect-intended-trace-references.py')
query = importlib.util.module_from_spec(spec)
spec.loader.exec_module(query)


class IntendedReferenceTest(unittest.TestCase):
    def test_only_all_known_refs_can_describe_one_existing_component_without_new_unions(self):
        original = {'layerCount': 2, 'obstacles': [], 'connections': [{'name': 'a', 'source_trace_id': 'metadata-only-a', 'pointsToConnect': [{'x': 0, 'y': 0, 'layer': 'top', 'pcb_port_id': 'pa', 'pointId': 'pa'}]}, {'name': 'b', 'source_trace_id': 'metadata-only-b', 'pointsToConnect': [{'x': 2, 'y': 0, 'layer': 'top', 'pcb_port_id': 'pb', 'pointId': 'pb'}]}]}
        wires = [{'route_type': 'wire', 'x': 0, 'y': 0, 'width': 0.1, 'layer': 'top'}, {'route_type': 'wire', 'x': 1, 'y': 0, 'width': 0.1, 'layer': 'top'}]
        trace = {'pcb_trace_id': 'solver-parent', 'connection_name': 'renamed-forest-request', 'connectsTo': ['pa', 'a'], 'source_trace_id': 'metadata-only-a', 'route': wires}
        index = query.OriginalReferenceIndex(original)
        before = index.graph_fingerprint()
        result = index.trace_intent(trace)
        self.assertEqual(result['classification'], 'unique_intended_original_component_supplemental_only')
        self.assertEqual(result['intendedComponentHash'], index.audit.normalized_owner('a')['componentHash'])
        self.assertEqual(result['referenceCount'], 3)
        self.assertNotIn('metadata-only-a', index.audit.registry)
        self.assertNotIn('solver-parent', index.audit.registry)
        self.assertEqual(result['references'][2]['originalSourceTraceMetadataMatches'][0]['originalConnectionName'], 'a')

        child = {**trace, 'pcb_trace_id': 'solver-child', 'connectsTo': ['pa', 'solver-parent']}
        missing_parent = index.trace_intent(child, {'solver-parent', 'solver-child'})
        self.assertEqual(missing_parent['classification'], 'unresolved_at_least_one_reference')
        self.assertIsNone(missing_parent['intendedComponentHash'])
        self.assertEqual(missing_parent['references'][1]['status'], 'unresolved_reference_also_matches_solver_output_trace_id')
        self.assertEqual(missing_parent['references'][1]['existingComponentMatches'], [])
        self.assertNotIn('solver-parent', index.audit.registry)
        different = index.trace_intent({**trace, 'connectsTo': ['pa', 'pb']})
        self.assertEqual(different['classification'], 'unresolved_references_target_different_original_components')
        self.assertIsNone(index.audit.proof_path(index.audit.original_request('a'), index.audit.original_request('b')))
        self.assertEqual(index.trace_intent({**trace, 'connectsTo': ['a_mst1_0']})['classification'], 'unresolved_at_least_one_reference')
        self.assertEqual(index.trace_intent({**trace, 'connectsTo': [] , 'source_trace_id': None})['classification'], 'unresolved_malformed_reference_metadata')
        empty = {key: value for key, value in trace.items() if key not in ['connectsTo', 'source_trace_id']}
        self.assertEqual(index.trace_intent(empty)['classification'], 'unresolved_missing_original_references')

        no_width = {**trace, 'route': [{key: value for key, value in point.items() if key != 'width'} for point in wires]}
        self.assertEqual(index.trace_intent(no_width)['classification'], 'unresolved_queried_wire_geometry')
        self.assertIsNone(index.trace_intent(no_width)['intendedComponentHash'])
        self.assertEqual(index.trace_intent(trace, {'pa'})['classification'], 'unresolved_at_least_one_reference')
        self.assertEqual(before, index.graph_fingerprint())

        repeated_alias = json.loads(json.dumps(original))
        repeated_alias['connections'][1]['source_trace_id'] = 'metadata-only-a'
        collision = query.OriginalReferenceIndex(repeated_alias)
        ambiguous = collision.trace_intent({**trace, 'connectsTo': ['pa']})
        self.assertEqual(ambiguous['classification'], 'unresolved_at_least_one_reference')
        self.assertEqual(len(ambiguous['references'][1]['existingComponentMatches']), 2)
        self.assertIsNone(collision.audit.proof_path(collision.audit.original_request('a'), collision.audit.original_request('b')))

        with_input_trace = json.loads(json.dumps(original))
        with_input_trace['traces'] = [{'type': 'pcb_trace', 'pcb_trace_id': 'original-wire', 'connection_name': 'a', 'route': [{'route_type': 'wire', 'x': 0, 'y': 0, 'layer': 'top'}]}]
        unsupported_wire = query.OriginalReferenceIndex(with_input_trace).trace_intent({**trace, 'connectsTo': ['pa', 'original-wire']})
        self.assertEqual(unsupported_wire['classification'], 'unresolved_at_least_one_reference')
        self.assertEqual(unsupported_wire['references'][1]['status'], 'unresolved_referenced_original_wire_geometry')
        duplicate_input_trace = json.loads(json.dumps(original))
        duplicate_input_trace['traces'] = [{'type': 'pcb_trace', 'pcb_trace_id': 'duplicate', 'connection_name': name, 'route': wires} for name in ['a', 'b']]
        blocked = query.OriginalReferenceIndex(duplicate_input_trace).trace_intent(trace)
        self.assertEqual(blocked['classification'], 'unresolved_at_least_one_reference')


if __name__ == '__main__':
    unittest.main()
