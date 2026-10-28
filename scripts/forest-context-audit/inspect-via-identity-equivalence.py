#!/usr/bin/env python3
"""Read captured copper; separate declared electrical identity from coordinate unions."""
import argparse
import collections
import importlib.util
import itertools
import json
import math
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("captured_inspector", HERE / "inspect-artifact.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class Graph:
    def __init__(self):
        self.edges = collections.defaultdict(list)

    def add(self, left, right, evidence):
        self.edges[left].append((right, evidence))
        self.edges[right].append((left, evidence))

    def path(self, start, end, forbidden=()):
        if start in forbidden or end in forbidden:
            return None
        if start == end:
            return []
        queue = collections.deque([start])
        previous = {start: None}
        while queue:
            node = queue.popleft()
            for other, evidence in self.edges.get(node, []):
                if other in previous or other in forbidden:
                    continue
                previous[other] = (node, evidence)
                if other == end:
                    result = []
                    while previous[other] is not None:
                        before, fact = previous[other]
                        result.append({"from": before, "to": other, "evidence": fact})
                        other = before
                    return list(reversed(result))
                queue.append(other)
        return None

    def component(self, start, forbidden=()):
        if start in forbidden:
            return set()
        seen, queue = {start}, collections.deque([start])
        while queue:
            node = queue.popleft()
            for other, _ in self.edges.get(node, []):
                if other not in seen and other not in forbidden:
                    seen.add(other)
                    queue.append(other)
        return seen


def token(kind, value):
    return (kind, value)


def strings(values):
    return [v for v in values if isinstance(v, str) and v]


def point_layers(point):
    if "layer" not in point and isinstance(point.get("layers"), list):
        return point["layers"]
    if "layers" not in point and isinstance(point.get("layer"), str):
        return [point["layer"]]
    raise ValueError("Point must specify layer or layers, never both")


def coordinate_key(point, layers, layer_count):
    def js_round(value):
        if type(value) not in [int, float] or not math.isfinite(value):
            raise ValueError("Nonfinite coordinate")
        value *= 100
        if abs(value) >= 2 ** 53:
            raise ValueError("Coordinate outside faithful finite-number hash emulation")
        lower = math.floor(value)
        return lower + int(value - lower >= 0.5)
    def layer_z(layer):
        if layer == "top":
            return 0
        if layer == "bottom":
            return layer_count - 1
        match = re.fullmatch(r"inner([1-8])", str(layer))
        if match:
            return int(match[1])
        raise ValueError("Unsupported layer name in coordinate hash")
    zs = sorted([layer_z(layer) for layer in layers], key=str)
    return f"{js_round(point['x'])},{js_round(point['y'])}:" + "-".join(map(str, zs))


class IdentityAudit:
    def __init__(self, original):
        self.original = original
        self.proven = Graph()
        self.source_explicit = Graph()
        self.source_full = Graph()
        self.registry = collections.defaultdict(set)
        self.names = collections.Counter(c.get("name") for c in original.get("connections", []))
        self.duplicate_request_nodes = {token('net_or_request', name) for name, count in self.names.items() if count > 1}
        self.ambiguities = []
        self.issues = []
        self.coordinate_keys = set()
        self.obstacle_anchors = {}
        self.component_cache = {}
        self.owner_component_cache = {}
        self._build()

    def proof_path(self, left, right):
        return self.proven.path(left, right, self.duplicate_request_nodes)

    def proof_component(self, node):
        if node not in self.component_cache:
            members = frozenset(self.proven.component(node, self.duplicate_request_nodes))
            for member in members:
                self.component_cache[member] = members
        return self.component_cache.get(node, frozenset())

    def register(self, kind, value):
        if not isinstance(value, str) or not value:
            return None
        node = token(kind, value)
        self.registry[value].add(node)
        return node

    def raw_group(self, values, reason, coordinate=None):
        values = list(dict.fromkeys(strings(values)))
        for left, right in zip(values, values[1:]):
            self.source_explicit.add(left, right, {"kind": "declared", **reason})
            self.source_full.add(left, right, {"kind": "declared", **reason})
        if coordinate is not None:
            self.coordinate_keys.add(coordinate)
            for value in values:
                self.source_full.add(value, coordinate, {"kind": "rounded_coordinate", "coordinateKey": coordinate, **reason})

    def generic(self, value, reason):
        if not isinstance(value, str) or not value:
            return None
        candidates = sorted(self.registry.get(value, []))
        if not candidates:
            return self.register("untyped_external_alias", value)
        if all(self.proof_path(candidates[0], candidate) is not None for candidate in candidates):
            return candidates[0]
        self.ambiguities.append({"alias": value, "typedCandidates": candidates, "reason": reason})
        return None

    def _build(self):
        connections = self.original.get("connections", [])
        obstacles = self.original.get("obstacles", [])
        traces = self.original.get("traces", [])
        for connection in connections:
            for name in [connection.get("name"), *(connection.get("__rootConnectionNames") or []), connection.get("__netConnectionName")]:
                self.register("net_or_request", name)
            for point in connection.get("pointsToConnect", []):
                self.register("pcb_port", point.get("pcb_port_id"))
                self.register("point", point.get("pointId"))
        for obstacle in obstacles:
            self.register("obstacle", obstacle.get("obstacleId"))
        for trace in traces:
            self.register("preloaded_trace", trace.get("pcb_trace_id"))
            self.register("net_or_request", trace.get("connection_name"))
        for index, connection in enumerate(connections):
            name = connection.get("name")
            if not isinstance(name, str):
                self.issues.append({"kind": "missing_connection_name", "index": index})
                continue
            request = token("net_or_request", name)
            for field, values in [("__rootConnectionNames", connection.get("__rootConnectionNames") or []), ("__netConnectionName", [connection.get("__netConnectionName")])]:
                for alias in strings(values):
                    reason = {"source": f"original.connections[{index}].{field}", "request": name, "alias": alias}
                    self.proven.add(request, token("net_or_request", alias), reason)
                    self.raw_group([name, alias], reason)
            for point_index, point in enumerate(connection.get("pointsToConnect", [])):
                reason = {"source": f"original.connections[{index}].pointsToConnect[{point_index}]", "request": name}
                for field, kind in [("pcb_port_id", "pcb_port"), ("pointId", "point")]:
                    alias = point.get(field)
                    if isinstance(alias, str) and alias:
                        self.proven.add(request, token(kind, alias), {**reason, "field": field, "alias": alias})
                        self.raw_group([name, alias], {**reason, "field": field})
                try:
                    coordinate = coordinate_key(point, point_layers(point), self.original["layerCount"])
                    self.raw_group([name], reason, coordinate)
                except (KeyError, TypeError, ValueError) as error:
                    self.issues.append({**reason, "kind": "unsupported_coordinate_emulation", "error": str(error)})
        for index, obstacle in enumerate(obstacles):
            reason = {"source": f"original.obstacles[{index}]", "fields": ["obstacleId", "connectedTo", "offBoardConnectsTo"]}
            values = strings([obstacle.get("obstacleId"), *(obstacle.get("connectedTo") or []), *(obstacle.get("offBoardConnectsTo") or [])])
            anchor = token("obstacle_record", str(index))
            self.obstacle_anchors[index] = anchor
            if isinstance(obstacle.get("obstacleId"), str):
                self.proven.add(anchor, token("obstacle", obstacle["obstacleId"]), reason)
            for value in strings([*(obstacle.get("connectedTo") or []), *(obstacle.get("offBoardConnectsTo") or [])]):
                resolved = self.generic(value, reason)
                if resolved is not None:
                    self.proven.add(anchor, resolved, {**reason, "alias": value})
            try:
                coordinate = coordinate_key(obstacle["center"], obstacle["layers"], self.original["layerCount"])
            except (KeyError, TypeError, ValueError) as error:
                coordinate = None
                self.issues.append({**reason, "kind": "unsupported_coordinate_emulation", "error": str(error)})
            self.raw_group(values, reason, coordinate)
        for index, trace in enumerate(traces):
            reason = {"source": f"original.traces[{index}]", "fields": ["pcb_trace_id", "connection_name", "connectsTo"]}
            anchor = token("preloaded_trace_record", str(index))
            for field, kind in [("pcb_trace_id", "preloaded_trace"), ("connection_name", "net_or_request")]:
                value = trace.get(field)
                if isinstance(value, str) and value:
                    self.proven.add(anchor, token(kind, value), {**reason, "field": field})
            for value in strings(trace.get("connectsTo") or []):
                resolved = self.generic(value, reason)
                if resolved is not None:
                    self.proven.add(anchor, resolved, {**reason, "alias": value})
            self.raw_group([trace.get("pcb_trace_id"), trace.get("connection_name"), *(trace.get("connectsTo") or [])], reason)
        self.collision_aliases = set()
        for value, nodes in self.registry.items():
            ordered = list(nodes)
            if len(ordered) > 1 and any(self.proof_path(ordered[0], other) is None for other in ordered[1:]):
                self.collision_aliases.add(value)
        self.coordinate_literal_collisions = self.coordinate_keys.intersection(self.registry)

    def original_request(self, name):
        return token("net_or_request", name) if isinstance(name, str) and self.names[name] == 1 else None

    def relation(self, left, right):
        a, b = self.original_request(left), self.original_request(right)
        if a is None or b is None:
            return {"left": left, "right": right, "classification": "unresolved_request_identity", "reason": "Request name absent or duplicated in original connections"}
        proven = self.proof_path(a, b)
        rejected_duplicate_path = self.proven.path(a, b) if proven is None else None
        explicit = self.source_explicit.path(left, right)
        full = self.source_full.path(left, right)
        proof = lambda path: {"edgeCount": len(path), "pathHash": base.digest(path), "edges": path[:32], "truncated": len(path) > 32} if path is not None else None
        if proven is not None:
            classification = "same_proven_explicit_identity"
        elif rejected_duplicate_path is not None:
            classification = "unresolved_duplicate_request_identity"
        elif explicit is not None:
            classification = "unresolved_identity_collision"
        elif self.issues:
            classification = "unresolved_source_emulation"
        elif full is not None:
            path_ids = {edge[key] for edge in full for key in ["from", "to"]}
            classification = "unresolved_identity_collision" if path_ids.intersection(self.collision_aliases | self.coordinate_literal_collisions) else "coordinate_only_connection"
        else:
            classification = "distinct_explicit_owners"
        return {"left": left, "right": right, "classification": classification, "explicitIdentityProof": proof(proven), "rejectedDuplicateRequestPath": proof(rejected_duplicate_path), "sourceExplicitPath": proof(explicit), "sourceFullPath": proof(full), "coordinateUnionIsNotElectricalPermission": classification == "coordinate_only_connection"}

    def obstacle_relation(self, request, index):
        node = self.original_request(request)
        anchor = self.obstacle_anchors.get(index)
        if node is None or anchor is None:
            return {"classification": "unresolved_request_or_obstacle"}
        path = self.proof_path(node, anchor)
        if path is not None:
            return {"classification": "same_proven_explicit_identity", "proof": {"edgeCount": len(path), "pathHash": base.digest(path), "edges": path[:32], "truncated": len(path) > 32}}
        if self.proven.path(node, anchor) is not None:
            return {"classification": "unresolved_duplicate_request_identity"}
        reason = f"original.obstacles[{index}]"
        if any(a.get("reason", {}).get("source") == reason for a in self.ambiguities):
            return {"classification": "unresolved_obstacle_alias_collision"}
        return {"classification": "no_proven_explicit_identity_path", "qualification": "Absence of a declared path alone does not establish the pad's intended external electrical owner."}

    def port_component_summary(self, port_id, traces):
        node = token('pcb_port', port_id)
        if node not in self.registry.get(port_id, set()):
            return {'classification': 'unresolved_original_port_identity', 'portId': port_id}
        component = self.proof_component(node)
        requests = [(index, c) for index, c in enumerate(self.original.get('connections', [])) if self.original_request(c.get('name')) in component]
        points = [p for _, c in requests for p in c.get('pointsToConnect', [])]
        summary = base.connection_digest({'name': 'explicit original identity component', 'pointsToConnect': points})
        duplicate_boundary = sorted({other[1] for member in component for other, _ in self.proven.edges.get(member, []) if other in self.duplicate_request_nodes})
        collision_aliases = sorted({member[1] for member in component if member in self.registry.get(member[1], set()) and (member[1] in self.collision_aliases or member[1] in self.coordinate_literal_collisions)})
        off_board = [index for index, anchor in self.obstacle_anchors.items() if anchor in component and self.original['obstacles'][index].get('offBoardConnectsTo')]
        external_request = any(c.get('isOffBoard') or c.get('externallyConnectedPointIds') for _, c in requests)
        if duplicate_boundary:
            classification = 'unresolved_duplicate_request_identity'
        elif collision_aliases:
            classification = 'unresolved_identity_collision'
        elif summary['invalidOrLayerlessPointCount'] or not points:
            classification = 'unresolved_original_terminal_records'
        elif off_board or external_request:
            classification = 'unresolved_external_demand_hints'
        elif summary['distinctPhysicalPointCount'] == 1:
            classification = 'singleton_explicit_original_physical_point_component'
        else:
            classification = 'multiterminal_explicit_original_physical_point_component'
        membership = sorted(component)
        request_names = {c.get('name') for _, c in requests}
        routed_names = collections.Counter(t.get('connection_name') for t in traces)
        proof_examples = []
        for _, c in requests[:3]:
            path = self.proof_path(node, self.original_request(c.get('name')))
            if path is not None:
                proof_examples.append({'requestName': c.get('name'), 'edgeCount': len(path), 'pathHash': base.digest(path), 'edges': path[:32], 'truncated': len(path) > 32})
        return {'classification': classification, 'componentHash': base.digest(membership), 'componentIdentityCount': len(component), 'originalRequestCount': len(requests), 'originalRequestNameExamples': sorted(request_names)[:8], 'originalPointRecordCount': len(points), 'distinctOriginalPhysicalPointRecordCount': summary['distinctPhysicalPointCount'], 'distinctOriginalPcbPortIdCount': summary['distinctPcbPortCount'], 'distinctOriginalPointIdCount': len({p['pointId'] for p in points if isinstance(p.get('pointId'), str)}), 'terminalExamples': summary['terminalExamples'], 'duplicateRequestBoundaryNames': duplicate_boundary, 'crossTypeOrCoordinateLiteralCollisionAliases': collision_aliases, 'offBoardObstacleIndexes': off_board[:8], 'externalRequestHints': external_request, 'newOrPreloadedTraceCountUsingExactMemberRequestNames': sum(routed_names[name] for name in request_names), 'unmappedRoutedConnectionNameCount': sum(count for name, count in routed_names.items() if self.original_request(name) is None), 'portToRequestProofExamples': proof_examples, 'qualification': 'Original terminal cardinality across the typed explicit identity component, with no coordinate unions. Multiple original points do not prove an unfulfilled demand; explicit preloaded copper or equivalent access points may already connect them. A singleton is conditional on captured SRJ declarations and does not assert external schematic intent.'}

    def normalized_owner(self, request):
        if request not in self.owner_component_cache:
            node = self.original_request(request)
            if node is None:
                result = {'status': 'unresolved_original_request'}
            else:
                members = self.proof_component(node)
                duplicate = any(other in self.duplicate_request_nodes for member in members for other, _ in self.proven.edges.get(member, []))
                collision = any(member in self.registry.get(member[1], set()) and (member[1] in self.collision_aliases or member[1] in self.coordinate_literal_collisions) for member in members)
                result = {'status': 'unresolved_duplicate_request'} if duplicate else {'status': 'unresolved_identity_collision'} if collision else {'status': 'resolved_explicit_identity_component', 'componentHash': base.digest(sorted(members))}
            self.owner_component_cache[request] = result
        return self.owner_component_cache[request]


def raw_via_sites(original, context, traces, audit):
    sites = collections.defaultdict(list)
    for trace_index, trace in enumerate(traces):
        for point_index, point in enumerate(trace.get("route", [])):
            if point.get("route_type") != "via":
                continue
            geometry = base.materialized_via(original, context, point)
            layers = geometry.get("layers")
            site = (point.get("x"), point.get("y"), tuple(sorted(layers)) if isinstance(layers, list) else None)
            sites[site].append({"requestName": trace.get("connection_name"), "pcb_trace_id": trace.get("pcb_trace_id"), "traceIndex": trace_index, "routePointIndex": point_index, "rawTransition": {k: point.get(k) for k in ["from_layer", "to_layer"]}, "materializedGeometry": geometry})
    output = []
    for (x, y, layers), occurrences in sites.items():
        names = sorted({o["requestName"] for o in occurrences if isinstance(o["requestName"], str)})
        if len(names) < 2:
            continue
        relations = [audit.relation(a, b) for a, b in itertools.combinations(names, 2)]
        classes = {r["classification"] for r in relations}
        classification = "same_proven_explicit_identity" if classes == {"same_proven_explicit_identity"} else "unresolved" if any(c.startswith("unresolved") for c in classes) or layers is None else "contains_coordinate_only_connection" if "coordinate_only_connection" in classes else "contains_distinct_explicit_owners"
        output.append({"x": x, "y": y, "physicalDrillLayers": layers, "requestNames": names, "rawViaOccurrenceCount": len(occurrences), "rawOccurrenceExamples": occurrences[:16], "rawOccurrencesTruncated": len(occurrences) > 16, "pairRelations": relations, "classification": classification})
    return output


def normalized_copper_metrics(original, context, traces, audit):
    owned_sites, raw_request_sites, physical_sites = set(), set(), set()
    site_owners = collections.defaultdict(set)
    site_dimensions = collections.defaultdict(set)
    unknown_owner_sites, unknown_span_sites = set(), set()
    segments = {}
    raw_segment_length, unresolved_segment_length = 0.0, 0.0
    counts = collections.Counter({name: 0 for name in ['tracesWithUnresolvedOwner', 'rawViaOccurrences', 'viaOccurrencesWithUnresolvedOwner', 'viaOccurrencesWithUnresolvedSpan', 'viaOccurrencesWithUnresolvedGeometry', 'rawWireSegmentOccurrences', 'wireSegmentsWithUnresolvedGeometry', 'wireSegmentsWithUnresolvedOwnerOrWidth']})
    for trace in traces:
        name = trace.get('connection_name')
        owner = audit.normalized_owner(name)
        owner_key = owner.get('componentHash')
        if owner_key is None:
            counts['tracesWithUnresolvedOwner'] += 1
        route = trace.get('route', [])
        for point in route:
            if point.get('route_type') != 'via':
                continue
            counts['rawViaOccurrences'] += 1
            materialized = base.materialized_via(original, context, point)
            if not all(type(point.get(key)) in [int, float] and math.isfinite(point[key]) for key in ['x', 'y']):
                counts['viaOccurrencesWithUnresolvedGeometry'] += 1
                continue
            layers = materialized.get('layers')
            if not isinstance(layers, list) or not layers or not all(isinstance(layer, str) for layer in layers):
                counts['viaOccurrencesWithUnresolvedSpan'] += 1
                unknown_span_sites.add(base.canonical([name, point.get('x'), point.get('y'), layers]))
                continue
            site = (point.get('x'), point.get('y'), tuple(sorted(layers)))
            physical_sites.add(site)
            raw_request_sites.add((name, *site))
            if owner_key is None:
                counts['viaOccurrencesWithUnresolvedOwner'] += 1
                unknown_owner_sites.add((name, *site))
            else:
                owned_site = (owner_key, *site)
                owned_sites.add(owned_site)
                site_owners[site].add(owner_key)
                site_dimensions[owned_site].add(base.canonical([materialized.get('outer_diameter'), materialized.get('hole_diameter')]))
        for a, b in zip(route, route[1:]):
            if a.get('route_type') != 'wire' or b.get('route_type') != 'wire' or a.get('layer') != b.get('layer'):
                continue
            counts['rawWireSegmentOccurrences'] += 1
            coordinates_valid = all(type(point.get(key)) in [int, float] and math.isfinite(point[key]) for point in [a, b] for key in ['x', 'y'])
            if not coordinates_valid:
                counts['wireSegmentsWithUnresolvedGeometry'] += 1
                continue
            length = math.hypot(a['x'] - b['x'], a['y'] - b['y'])
            raw_segment_length += length
            widths_valid = all(type(point.get('width')) in [int, float] and math.isfinite(point['width']) and point['width'] > 0 for point in [a, b])
            if owner_key is None or not widths_valid or not isinstance(a.get('layer'), str):
                counts['wireSegmentsWithUnresolvedOwnerOrWidth'] += 1
                unresolved_segment_length += length
                continue
            ends = sorted([(a['x'], a['y'], a['width']), (b['x'], b['y'], b['width'])])
            key = base.canonical([owner_key, a['layer'], ends])
            segments[key] = length
    return {**dict(counts), 'rawRequestUniqueViaSiteSpanCount': len(raw_request_sites), 'uniquePhysicalViaSiteSpansIgnoringOwners': len(physical_sites), 'explicitIdentityNormalizedOwnedViaSiteSpanCount': len(owned_sites), 'viaSiteSpansWithDistinctResolvedExplicitComponents': sum(len(owners) > 1 for owners in site_owners.values()), 'rawRequestViaSiteSpansWithUnresolvedOwner': len(unknown_owner_sites), 'rawRequestViaSitesWithUnresolvedSpan': len(unknown_span_sites), 'normalizedOwnedViaSitesWithDiameterVariants': sum(len(values) > 1 for values in site_dimensions.values()), 'allViaOwnershipAndSpansResolved': not counts['viaOccurrencesWithUnresolvedOwner'] and not counts['viaOccurrencesWithUnresolvedSpan'] and not counts['viaOccurrencesWithUnresolvedGeometry'], 'rawSummedWireSegmentLength': raw_segment_length, 'exactExplicitOwnerSegmentDeduplicatedResolvedLength': sum(segments.values()), 'unresolvedOwnerOrWidthWireSegmentLength': unresolved_segment_length, 'allWireSegmentOwnershipAndWidthsResolved': not counts['wireSegmentsWithUnresolvedOwnerOrWidth'] and not counts['wireSegmentsWithUnresolvedGeometry'], 'exactResolvedOwnedSegmentCount': len(segments), 'definition': 'Combined raw input/new copper with explicit preload replacement only. Unique via sites are keyed by proven typed explicit identity component, exact coordinates and materialized drill span; coordinate unions and ambiguous owners never normalize identities. Raw request and coordinate-only site counts are retained separately. Exact segment deduplication preserves layers and both endpoint widths and removes exact same-owner reversed/repeated segments only, not arbitrary collinear or overlapping unions. Raw sums and unknown ownership/geometry remain separately visible.'}


def via_pad_queries(original, context, traces, audit, supplemental):
    resolve, _, _ = base.owner_maps(original, context)
    allocations, allocation_status = base.converter_via_allocations(original, context, traces, resolve)
    identifier_index = base.identifier_index(original, "original", resolve)
    findings = []
    for error in (supplemental.get("libraryRoutingChecks") or {}).get("errors", []):
        if error.get("type") != "pcb_pad_pad_clearance_error":
            continue
        ids = strings(error.get("pcb_pad_ids") or [])
        for via_id in [value for value in ids if value in allocations]:
            allocation = allocations[via_id]
            request = allocation["firstRawOccurrence"].get("connection_name")
            for pad_id in [value for value in ids if value != via_id]:
                indexes = set()
                for match in identifier_index.get(pad_id, []):
                    found = re.match(r"original\.obstacles\[(\d+)\]", match["path"])
                    if found:
                        indexes.add(int(found[1]))
                relations = [{"originalObstacleIndex": index, "obstacle": base.obstacle_digest(original['obstacles'][index], resolve), **audit.obstacle_relation(request, index)} for index in sorted(indexes)]
                via_collision = bool(identifier_index.get(via_id))
                classification = "unresolved_converter_identifier_collision" if via_collision else relations[0]["classification"] if len(relations) == 1 else "unresolved_ambiguous_or_missing_pad_identity"
                findings.append({"viaId": via_id, "padId": pad_id, "message": error.get("message"), "firstAllocatedRequest": request, "materializedVia": allocation["materializedGeometry"], "rawOccurrenceOwnerTags": allocation["rawOccurrenceOwnerTags"], "rawDistinctResolvedOwners": allocation["hasDistinctResolvedRawOwners"], "viaIdAlsoPresentInOriginal": via_collision, "originalObstacleRelations": relations, "classification": classification})
    return findings, allocation_status


def port_component_queries(audit, traces, supplemental):
    findings, summaries = [], {}
    record_count, missing_port_ids = 0, 0
    for error in (supplemental.get('libraryRoutingChecks') or {}).get('errors', []):
        if error.get('type') != 'pcb_port_not_connected_error':
            continue
        record_count += 1
        ids = strings([error.get('pcb_port_id'), *(error.get('pcb_port_ids') or [])])
        if not ids:
            missing_port_ids += 1
        for port_id in ids:
            summary = audit.port_component_summary(port_id, traces)
            key = summary.get('componentHash') or base.digest(['unresolved_original_port', port_id])
            if key not in summaries:
                summaries[key] = {'proofFromPortId': port_id, **summary}
            findings.append({'pcb_port_id': port_id, 'errorFingerprint': base.digest(error), 'classification': summary['classification'], 'componentHash': key})
    return {'libraryPortErrorRecordCount': record_count, 'portFindingExactIdOccurrenceCount': len(findings), 'portFindingsWithoutExactPortIds': missing_port_ids, 'classificationCounts': dict(collections.Counter(f['classification'] for f in findings)), 'findings': findings, 'components': summaries}


def inspect(directory, expected, verified, include_baseline=False):
    wanted = {key: expected[key] for key in ["runId", "controllerSha", "baselineSha", "candidateSha", "pr", "dataset"]}
    if verified.get("qualification") != "PROVENANCE_CHECKS_PASSED" or verified.get("expectedProvenance") != wanted or verified.get("sourceArtifact") != expected["artifact"] or verified.get("sourceArtifactMetadataVerification", {}).get("qualification") != "EXACT_ARTIFACT_METADATA_VERIFIED":
        raise ValueError("A matching successful pinned artifact inspection is required")
    roots = [path.parent for path in directory.rglob("provenance.json") if base.read(path).get("dataset") == expected["dataset"] and base.read(path).get("experiment", {}).get("pr") == expected["pr"]]
    if len(roots) != 1:
        raise ValueError("Expected exactly one source artifact root")
    results = []
    excluded = {arm: collections.Counter() for arm in ["A", "B"]}
    for path in sorted(roots[0].rglob("audit-result.json")):
        record = base.read(path)
        arm = record.get("arm")
        if record.get("round") != 1 or arm not in (["A", "B"] if include_baseline else ["B"]):
            continue
        official = record.get("official") or {}
        if not official.get("didSolve") or official.get("didTimeout") or not official.get("relaxedDrcPassed") or record.get("controllerError"):
            excluded[arm]["not_official_clean"] += 1
            continue
        raw = path.parent / "raw"
        supplemental = base.read(raw / "supplemental-validation.json") if (raw / "supplemental-validation.json").exists() else {}
        if supplemental.get("referenceFullCopperChecks", {}).get("count") != 0:
            excluded[arm]["reference_not_zero_or_unavailable"] += 1
            continue
        if record.get("sha") != expected["candidateSha" if arm == "B" else "baselineSha"] or base.file_digest(raw / "original-input.json") != expected["inputHashes"].get(str(record["sampleNumber"])):
            raise ValueError("Per-sample source identity differs from expected captured input")
        original, context, new = [base.read(raw / name) for name in ["original-input.json", "point-pair-context.json", "raw-new-traces.json"]]
        capture = base.read(raw / "capture-provenance.json")
        if base.file_digest(raw / "raw-new-traces.json") != capture.get("rawNewTracesHash"):
            raise ValueError("Captured raw copper differs from its verified capture hash")
        traces = base.combined_traces(original, new)
        audit = IdentityAudit(original)
        sites = raw_via_sites(original, context, traces, audit)
        normalized_metrics = normalized_copper_metrics(original, context, traces, audit)
        pad_findings, allocation = via_pad_queries(original, context, traces, audit, supplemental)
        port_components = port_component_queries(audit, traces, supplemental)
        results.append({"sample": record["sampleNumber"], "arm": arm, "round": 1, "inputHash": record["expectedInputHash"], "sourceGraphIssues": audit.issues, "ambiguousAliasExamples": audit.ambiguities[:16], "crossTypeIdentityCollisionAliases": sorted(audit.collision_aliases), "coordinateLiteralCollisionAliases": sorted(audit.coordinate_literal_collisions), "sites": sites, "siteClassificationCounts": dict(collections.Counter(s['classification'] for s in sites)), "viaPadFindings": pad_findings, "viaPadClassificationCounts": dict(collections.Counter(f['classification'] for f in pad_findings)), "portExplicitComponentFindings": port_components, "explicitIdentityNormalizedCopperMetrics": normalized_metrics, "pinnedConverterViaAllocationSummary": allocation})
    return {"sourceArtifact": expected["artifact"], "expectedProvenance": wanted, "qualification": "READ_ONLY_IDENTITY_ANALYSIS_ON_VERIFIED_CAPTURES", "firstRoundOnly": True, "officialAndReferenceCleanCandidateSamples": [r["sample"] for r in results if r['arm'] == 'B'], "officialAndReferenceCleanSamplesByArm": {arm: [r['sample'] for r in results if r['arm'] == arm] for arm in ['A', 'B']}, "excludedFirstRoundCountsByArm": {arm: dict(value) for arm, value in excluded.items()}, "results": results, "limits": "Electrical proof uses only original SRJ declarations: source helper root/net fields, exact port/point identities, obstacle connectedTo/offBoard groups and input trace aliases. Typed identities prevent accidental cross-field literal collisions from becoming proof; duplicated request names are excluded from proof paths. A separate graph emulates source helper untyped aliases and rounded 0.01mm coordinate keys; coordinate-only links are diagnostic and never electrical permission. Exact x/y plus identical materialized drill-span groups are enumerated; intersecting but unequal blind-via spans are not, so this is not a universal overlap-absence proof. Geometry through-via outputs use full-stack spans. No solver, converter or checks are run. Lack of a declared path is conditional on the captured SRJ and is not knowledge of an external schematic. Via-pad exact metadata matches remain distinct from inferred converted fragment identities. Same explicit net identity does not excuse unrelated geometric or manufacturing violations."}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=pathlib.Path, required=True)
    parser.add_argument("--expected", type=pathlib.Path, required=True)
    parser.add_argument("--inspection", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--include-baseline", action="store_true")
    parser.add_argument("--examples-per-class", type=int, default=3)
    args = parser.parse_args()
    report = inspect(args.directory, base.read(args.expected), base.read(args.inspection), args.include_baseline)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    totals = {arm: collections.Counter() for arm in ['A', 'B']}
    pad_totals = {arm: collections.Counter() for arm in ['A', 'B']}
    port_totals = {arm: collections.Counter() for arm in ['A', 'B']}
    for row in report["results"]:
        totals[row['arm']].update(row["siteClassificationCounts"])
        pad_totals[row['arm']].update(row['viaPadClassificationCounts'])
        port_totals[row['arm']].update(row['portExplicitComponentFindings']['classificationCounts'])
    print("VIA_IDENTITY_SUMMARY_JSON " + base.canonical({"sourceArtifact": report["sourceArtifact"], "expectedProvenance": report["expectedProvenance"], "qualification": report["qualification"], "officialAndReferenceCleanSamplesByArm": report["officialAndReferenceCleanSamplesByArm"], "excludedFirstRoundCountsByArm": report["excludedFirstRoundCountsByArm"], "siteClassificationCountsByArm": {arm: dict(values) for arm, values in totals.items()}, "viaPadClassificationCountsByArm": {arm: dict(values) for arm, values in pad_totals.items()}, 'portExplicitComponentClassificationCountsByArm': {arm: dict(values) for arm, values in port_totals.items()}}))
    examples = collections.Counter()
    limit = max(0, min(args.examples_per_class, 5))
    for row in report["results"]:
        print('VIA_IDENTITY_SAMPLE_METRICS_JSON ' + base.canonical({'sample': row['sample'], 'arm': row['arm'], 'metrics': row['explicitIdentityNormalizedCopperMetrics'], 'portExplicitComponentClassificationCounts': row['portExplicitComponentFindings']['classificationCounts'], 'siteClassificationCounts': row['siteClassificationCounts'], 'viaPadClassificationCounts': row['viaPadClassificationCounts']}))
        for site in row["sites"]:
            key = (row['arm'], 'site', site['classification'])
            if examples[key] < limit:
                print("VIA_IDENTITY_SITE_JSON " + base.canonical({"sample": row["sample"], "arm": row['arm'], "site": site}))
                examples[key] += 1
        for finding in row["viaPadFindings"]:
            key = (row['arm'], 'pad', finding['classification'])
            if examples[key] < limit:
                print("VIA_IDENTITY_PAD_FINDING_JSON " + base.canonical({"sample": row["sample"], "arm": row['arm'], "finding": finding}))
                examples[key] += 1
        ports = row['portExplicitComponentFindings']
        for finding in ports['findings']:
            key = (row['arm'], 'port_component', finding['classification'])
            if examples[key] < limit:
                print('VIA_IDENTITY_PORT_COMPONENT_JSON ' + base.canonical({'sample': row['sample'], 'arm': row['arm'], 'finding': finding, 'component': ports['components'][finding['componentHash']]}))
                examples[key] += 1
        if row["sourceGraphIssues"]:
            print("VIA_IDENTITY_SOURCE_ISSUES_JSON " + base.canonical({"sample": row["sample"], "issues": row["sourceGraphIssues"]}))


if __name__ == "__main__":
    main()
