#!/usr/bin/env python3
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('context_under_test', HERE / 'inspect-forest-context.py')
context = importlib.util.module_from_spec(spec)
spec.loader.exec_module(context)

class BoundedContext(unittest.TestCase):
    def test_bounded_exact_geometry_metadata_identity_and_missing_capture_invariants(self):
        class Audit:
            def normalized_owner(self, request): return {'status':'unresolved_original_request','request':request}
        audit=Audit()
        route=[{'route_type':'wire','x':i,'y':0,'layer':'top','width':0.1} for i in range(300)]
        trace={'type':'pcb_trace','pcb_trace_id':'forest_49','connection_name':'net','connectsTo':['old'],'route':route}
        selected=context.trace_context(trace,audit,point_index=100,allow_full=True)
        self.assertEqual(selected['routeVertices'],route[96:105]);self.assertEqual(selected['routePointCount'],300)
        mutated=copy.deepcopy(trace);mutated['connectsTo']=['new']
        second=context.trace_context(mutated,audit,point_index=100)
        self.assertEqual(selected['physicalGeometryOnlyHash'],second['physicalGeometryOnlyHash'])
        self.assertEqual(selected['routeOnlyPayloadHash'],second['routeOnlyPayloadHash'])
        self.assertNotEqual(selected['allMetadataExceptTraceIdPayloadHash'],second['allMetadataExceptTraceIdPayloadHash'])
        mutated['route'][100]['width']=0.2
        self.assertNotEqual(selected['physicalGeometryOnlyHash'],context.trace_context(mutated,audit,point_index=100)['physicalGeometryOnlyHash'])
        matches=context.by_id([trace,copy.deepcopy(trace)],'forest_49',audit,point_index=100)
        self.assertEqual(matches['matchCount'],2);self.assertEqual(len(matches['matches']),2)
        self.assertEqual(context.by_id([trace],'absent',audit)['matchCount'],0)
        self.assertTrue(context.intersects_box({'x':-1,'y':0},{'x':1,'y':0},{'minX':-.1,'maxX':.1,'minY':-.1,'maxY':.1}))
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);a=root/'round-1/sample-008/A';b=root/'round-1/sample-008/B';(a/'raw').mkdir(parents=True);b.mkdir(parents=True)
            original={'connections':[{'name':'net22','pointsToConnect':[{'x':40,'y':8.82,'layer':'top','pcb_port_id':'pcb_port_578'}]}],'obstacles':[]}
            source=a/'raw/original-input.json';source.write_text(json.dumps(original,separators=(',',':')))
            expected={'inputHashes':{'8':context.base.file_digest(source)}}
            loaded,provenance=context.original_for({(1,8,'A'):a/'audit-result.json',(1,8,'B'):b/'audit-result.json'},8,'B',expected)
            self.assertEqual(loaded,original);self.assertEqual(provenance['record'],[1,8,'A'])
            self.assertEqual(context.terminal_context(loaded,'pcb_port_578')['originalConnectionCount'],1)
            inventory=context.filename_status(b/'raw')
            self.assertTrue(all(not item['available'] for item in inventory.values()))
            self.assertEqual(context.collections_for(b/'raw'),{'rawNewTraces':[],'rawSolverOutput':[],'endCapturedPointPairContext':[]})
            source.write_text('{}');self.assertIsNone(context.original_for({(1,8,'A'):a/'audit-result.json'},8,'B',expected)[0])
        expected=json.loads((HERE/'expected-forest-v3-srj24.json').read_text())
        bad=copy.deepcopy(expected);bad['candidateSha']='58873007d669bbeb0d53ea4cb19b983c10ab1c66'
        with self.assertRaisesRegex(ValueError,'Only exact original forest V3'):context.inspect(pathlib.Path('/missing'),bad,{}, {})
        with self.assertRaisesRegex(ValueError,'Source API metadata'):context.inspect(pathlib.Path('/missing'),expected,{}, {})

if __name__=='__main__':unittest.main()
