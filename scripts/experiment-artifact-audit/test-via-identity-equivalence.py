#!/usr/bin/env python3
import importlib.util
import hashlib
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("identity", ROOT / "inspect-via-identity-equivalence.py")
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)


def connection(name, x, **extra):
    point = {"x": x, "y": 0, "layer": "top"}
    point.update(extra.pop("point", {}))
    return {"name": name, "pointsToConnect": [point], **extra}


def srj(connections, **extra):
    return {"layerCount": 2, "connections": connections, "obstacles": [], **extra}


class ViaIdentityTest(unittest.TestCase):
    def test_declared_paths_coordinate_only_collisions_and_raw_via_multiplicity(self):
        shared = srj([connection("a", 0, point={"pcb_port_id": "shared-port"}), connection("b", 2, point={"pcb_port_id": "shared-port"})])
        audit = identity.IdentityAudit(shared)
        relation = audit.relation("a", "b")
        self.assertEqual(relation["classification"], "same_proven_explicit_identity")
        self.assertEqual(relation["explicitIdentityProof"]["edgeCount"], 2)
        self.assertTrue(all(edge["evidence"]["field"] == "pcb_port_id" for edge in relation["explicitIdentityProof"]["edges"]))

        close = srj([connection("a", 0.001, point={"pcb_port_id": "port-a"}), connection("b", 0.004, point={"pcb_port_id": "port-b"})])
        close_audit = identity.IdentityAudit(close)
        relation = close_audit.relation("a", "b")
        self.assertEqual(relation["classification"], "coordinate_only_connection")
        self.assertIsNone(relation["explicitIdentityProof"])
        self.assertIsNone(relation["sourceExplicitPath"])
        self.assertTrue(relation["coordinateUnionIsNotElectricalPermission"])
        self.assertTrue(any(e["evidence"]["kind"] == "rounded_coordinate" for e in relation["sourceFullPath"]["edges"]))
        self.assertEqual(identity.coordinate_key({"x": -0.005, "y": 0}, ["top"], 2), "0,0:0")
        self.assertEqual(identity.coordinate_key({"x": 0.004999999999999999, "y": 0}, ["top"], 2), "0,0:0")
        self.assertEqual(identity.coordinate_key({"x": 0.005, "y": 0}, ["top"], 2), "1,0:0")

        aliases = srj([connection("a", 0, __netConnectionName="declared-net"), connection("b", 3, __rootConnectionNames=["declared-net"])])
        self.assertEqual(identity.IdentityAudit(aliases).relation("a", "b")["classification"], "same_proven_explicit_identity")
        collision = srj([connection("literal-port-id", 0), connection("b", 3, point={"pcb_port_id": "literal-port-id"})])
        collision_audit = identity.IdentityAudit(collision)
        self.assertIn("literal-port-id", collision_audit.collision_aliases)
        self.assertEqual(collision_audit.relation("literal-port-id", "b")["classification"], "unresolved_identity_collision")
        coordinate_literal = srj([connection("0,0:0", 5), connection("b", 0)])
        self.assertEqual(identity.IdentityAudit(coordinate_literal).relation("0,0:0", "b")["classification"], "unresolved_identity_collision")
        self.assertEqual(collision_audit.relation("absent", "b")["classification"], "unresolved_request_identity")
        duplicate_bridge = srj([connection('a', 0, __netConnectionName='net-a'), connection('b', 3, __netConnectionName='net-b'), connection('duplicate', 5, __netConnectionName='net-a'), connection('duplicate', 6, __netConnectionName='net-b')])
        self.assertEqual(identity.IdentityAudit(duplicate_bridge).relation('a', 'b')['classification'], 'unresolved_duplicate_request_identity')

        obstacle = {"obstacleId": "pad-record", "center": {"x": 9, "y": 9}, "layers": ["top"], "connectedTo": ["a"], "offBoardConnectsTo": ["b"]}
        external = srj([connection("a", 0), connection("b", 5)], obstacles=[obstacle])
        self.assertEqual(identity.IdentityAudit(external).relation("a", "b")["classification"], "same_proven_explicit_identity")
        preloaded = srj([connection("a", 0), connection("b", 5)], traces=[{"type": "pcb_trace", "pcb_trace_id": "existing", "connection_name": "a", "connectsTo": ["b"], "route": []}])
        self.assertEqual(identity.IdentityAudit(preloaded).relation("a", "b")["classification"], "same_proven_explicit_identity")

        via = {"route_type": "via", "x": 3, "y": 5, "from_layer": "top", "to_layer": "bottom"}
        traces = [{"type": "pcb_trace", "pcb_trace_id": "ta", "connection_name": "a", "route": [via]}, {"type": "pcb_trace", "pcb_trace_id": "tb", "connection_name": "b", "route": [{**via, "from_layer": "bottom", "to_layer": "top"}]}]
        sites = identity.raw_via_sites(shared, shared, traces, audit)
        self.assertEqual(len(sites), 1)
        self.assertEqual(sites[0]["rawViaOccurrenceCount"], 2)
        self.assertEqual(sites[0]["physicalDrillLayers"], ("bottom", "top"))
        self.assertEqual(sites[0]["classification"], "same_proven_explicit_identity")
        self.assertEqual({o["rawTransition"]["from_layer"] for o in sites[0]["rawOccurrenceExamples"]}, {"top", "bottom"})
        distinct = srj([connection("a", 0), connection("b", 5)])
        self.assertEqual(identity.raw_via_sites(distinct, distinct, traces, identity.IdentityAudit(distinct))[0]["classification"], "contains_distinct_explicit_owners")
        wires = [{'route_type': 'wire', 'x': 0, 'y': 0, 'width': 0.1, 'layer': 'top'}, {'route_type': 'wire', 'x': 1, 'y': 0, 'width': 0.1, 'layer': 'top'}]
        duplicated = [{**traces[0], 'route': wires + traces[0]['route']}, {**traces[1], 'route': list(reversed(wires)) + traces[1]['route']}]
        metrics = identity.normalized_copper_metrics(shared, shared, duplicated, audit)
        self.assertEqual(metrics['rawRequestUniqueViaSiteSpanCount'], 2)
        self.assertEqual(metrics['explicitIdentityNormalizedOwnedViaSiteSpanCount'], 1)
        self.assertTrue(metrics['allViaOwnershipAndSpansResolved'])
        self.assertEqual(metrics['rawSummedWireSegmentLength'], 2)
        self.assertEqual(metrics['exactExplicitOwnerSegmentDeduplicatedResolvedLength'], 1)
        distinct_metrics = identity.normalized_copper_metrics(distinct, distinct, duplicated, identity.IdentityAudit(distinct))
        self.assertEqual(distinct_metrics['explicitIdentityNormalizedOwnedViaSiteSpanCount'], 2)
        self.assertEqual(distinct_metrics['viaSiteSpansWithDistinctResolvedExplicitComponents'], 1)
        self.assertEqual(distinct_metrics['exactExplicitOwnerSegmentDeduplicatedResolvedLength'], 2)
        self.assertEqual(identity.normalized_copper_metrics(close, close, duplicated, close_audit)['explicitIdentityNormalizedOwnedViaSiteSpanCount'], 2)
        unresolved = identity.normalized_copper_metrics(shared, shared, [traces[0], {**traces[1], 'connection_name': 'unmapped-output-alias'}], audit)
        self.assertEqual(unresolved['viaOccurrencesWithUnresolvedOwner'], 1)
        self.assertFalse(unresolved['allViaOwnershipAndSpansResolved'])

        pad = {"obstacleId": "pad-record", "center": {"x": 3, "y": 5}, "width": 1, "height": 1, "layers": ["top"], "connectedTo": ["port-a"], "circuitJsonMetadata": {"pcb_smtpad_id": "pad-id"}}
        with_pad = srj([connection("a", 0, point={"pcb_port_id": "port-a"}), connection("b", 6, point={"pcb_port_id": "port-b"})], obstacles=[pad])
        pad_audit = identity.IdentityAudit(with_pad)
        self.assertEqual(pad_audit.obstacle_relation("a", 0)["classification"], "same_proven_explicit_identity")
        self.assertEqual(pad_audit.obstacle_relation("b", 0)["classification"], "no_proven_explicit_identity_path")
        supplemental = {"libraryRoutingChecks": {"errors": [{"type": "pcb_pad_pad_clearance_error", "pcb_pad_ids": ["via_0", "pad-id"]}]}}
        findings, allocation = identity.via_pad_queries(with_pad, with_pad, traces, pad_audit, supplemental)
        self.assertTrue(allocation["applicable"])
        self.assertEqual(findings[0]["originalObstacleRelations"][0]["classification"], "same_proven_explicit_identity")
        via_id_collision = json.loads(json.dumps(with_pad))
        via_id_collision['obstacles'][0]['circuitJsonMetadata']['pcb_via_id'] = 'via_0'
        collided, _ = identity.via_pad_queries(via_id_collision, via_id_collision, traces, identity.IdentityAudit(via_id_collision), supplemental)
        self.assertEqual(collided[0]['classification'], 'unresolved_converter_identifier_collision')
        duplicate_pad = json.loads(json.dumps(with_pad))
        duplicate_pad['obstacles'].append({**pad, 'center': {'x': 7, 'y': 8}, 'connectedTo': ['port-b']})
        ambiguous, _ = identity.via_pad_queries(duplicate_pad, duplicate_pad, traces, identity.IdentityAudit(duplicate_pad), supplemental)
        self.assertEqual(ambiguous[0]['classification'], 'unresolved_ambiguous_or_missing_pad_identity')
        self.assertEqual(len(ambiguous[0]['originalObstacleRelations']), 2)
        ambiguous_pad = srj([connection("port-a", 8), connection("a", 0, point={"pcb_port_id": "port-a"})], obstacles=[pad])
        self.assertEqual(identity.IdentityAudit(ambiguous_pad).obstacle_relation("a", 0)["classification"], "unresolved_obstacle_alias_collision")
        component_ports = srj([connection('a', 0, __netConnectionName='net', point={'pcb_port_id': 'pa'}), connection('b', 5, __netConnectionName='net', point={'pcb_port_id': 'pb'})])
        cardinality = identity.IdentityAudit(component_ports).port_component_summary('pa', traces)
        self.assertEqual(cardinality['classification'], 'multiterminal_explicit_original_physical_point_component')
        self.assertEqual(cardinality['originalRequestCount'], 2)
        self.assertEqual(cardinality['distinctOriginalPhysicalPointRecordCount'], 2)
        self.assertEqual(cardinality['distinctOriginalPcbPortIdCount'], 2)
        single = srj([connection('a', 0, point={'pcb_port_id': 'pa'})])
        self.assertEqual(identity.IdentityAudit(single).port_component_summary('pa', [])['classification'], 'singleton_explicit_original_physical_point_component')
        self.assertEqual(close_audit.port_component_summary('port-a', [])['originalRequestCount'], 1)
        self.assertEqual(identity.IdentityAudit(ambiguous_pad).port_component_summary('port-a', [])['classification'], 'unresolved_identity_collision')
        port_queries = identity.port_component_queries(identity.IdentityAudit(component_ports), traces, {'libraryRoutingChecks': {'errors': [{'type': 'pcb_port_not_connected_error', 'pcb_port_ids': ['pa', 'pb']}]}})
        self.assertEqual(port_queries['classificationCounts'], {'multiterminal_explicit_original_physical_point_component': 2})
        self.assertEqual(len(port_queries['components']), 1)

        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary)
            root = directory / 'source'
            root.mkdir()
            (root / 'provenance.json').write_text(json.dumps({'dataset': 'srj18', 'experiment': {'pr': 3202}}))
            original_bytes = json.dumps(shared).encode()
            original_hash = hashlib.sha256(original_bytes).hexdigest()
            expected = {'runId': 1, 'controllerSha': 'c' * 40, 'baselineSha': 'a' * 40, 'candidateSha': 'b' * 40, 'pr': 3202, 'dataset': 'srj18', 'artifact': {'id': 1, 'digest': 'sha256:' + 'd' * 64}, 'inputHashes': {str(n): original_hash for n in [1, 2, 3]}}
            verified = {'qualification': 'PROVENANCE_CHECKS_PASSED', 'expectedProvenance': {key: expected[key] for key in ['runId', 'controllerSha', 'baselineSha', 'candidateSha', 'pr', 'dataset']}, 'sourceArtifact': expected['artifact'], 'sourceArtifactMetadataVerification': {'qualification': 'EXACT_ARTIFACT_METADATA_VERIFIED'}}
            for arm, sample, clean, reference_zero in [('A', 1, True, True), ('B', 1, True, True), ('B', 2, False, True), ('B', 3, True, False)]:
                target = root / 'round-1' / f'sample-{sample:03d}' / arm
                target.mkdir(parents=True)
                record = {'round': 1, 'sampleNumber': sample, 'arm': arm, 'sha': expected['candidateSha' if arm == 'B' else 'baselineSha'], 'expectedInputHash': original_hash, 'official': {'didSolve': clean, 'didTimeout': False, 'relaxedDrcPassed': clean}}
                (target / 'audit-result.json').write_text(json.dumps(record))
                if not clean:
                    continue
                raw = target / 'raw'
                raw.mkdir()
                (raw / 'original-input.json').write_bytes(original_bytes)
                (raw / 'point-pair-context.json').write_bytes(original_bytes)
                raw_traces = json.dumps(traces).encode()
                (raw / 'raw-new-traces.json').write_bytes(raw_traces)
                (raw / 'capture-provenance.json').write_text(json.dumps({'rawNewTracesHash': hashlib.sha256(raw_traces).hexdigest()}))
                (raw / 'supplemental-validation.json').write_text(json.dumps({'referenceFullCopperChecks': {'count': 0 if reference_zero else 1}, 'libraryRoutingChecks': {'errors': [{'type': 'pcb_port_not_connected_error', 'pcb_port_id': 'shared-port'}]}}))
            report = identity.inspect(directory, expected, verified, include_baseline=True)
            self.assertEqual(report['officialAndReferenceCleanSamplesByArm'], {'A': [1], 'B': [1]})
            self.assertEqual(report['excludedFirstRoundCountsByArm']['B'], {'not_official_clean': 1, 'reference_not_zero_or_unavailable': 1})
            self.assertEqual(report['results'][1]['sites'][0]['rawViaOccurrenceCount'], 2)
            self.assertEqual(report['results'][1]['portExplicitComponentFindings']['classificationCounts'], {'multiterminal_explicit_original_physical_point_component': 1})
            self.assertEqual(identity.inspect(directory, expected, verified)['officialAndReferenceCleanSamplesByArm'], {'A': [], 'B': [1]})
            with self.assertRaises(ValueError):
                identity.inspect(directory, expected, {**verified, 'qualification': 'DISQUALIFIED'})


if __name__ == "__main__":
    unittest.main()
