#!/usr/bin/env python3
"""Inspect retained benchmark evidence only; no routing or validation is run."""
import argparse
import collections
import hashlib
import json
import math
import pathlib
import re


CHECKS = ["referenceFullCopperChecks", "inputOnlyPhysicalChecks", "inputOnlyConnectivityFindings", "libraryRoutingChecks", "boardCopperChecks", "viaBoardChecks"]


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def file_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def compact_geometry(obj):
    keys = ["type", "shape", "center", "x", "y", "z", "width", "height", "radius", "rotation", "ccw_rotation", "layer", "layers", "via_diameter", "via_hole_diameter", "outer_diameter", "hole_diameter"]
    result = {key: obj[key] for key in keys if key in obj}
    if isinstance(obj.get("route"), list):
        points = obj["route"]
        xy = [p for p in points if isinstance(p, dict) and isinstance(p.get("x"), (int, float)) and isinstance(p.get("y"), (int, float))]
        result.update({"routePointCount": len(points), "routeHash": digest(points), "viaOccurrences": sum(p.get("route_type") == "via" for p in points)})
        if xy:
            result["bounds"] = {"minX": min(p["x"] for p in xy), "maxX": max(p["x"] for p in xy), "minY": min(p["y"] for p in xy), "maxY": max(p["y"] for p in xy)}
    if isinstance(obj.get("pointsToConnect"), list):
        result["terminalCount"] = len(obj["pointsToConnect"])
    return result


def declared_owner(connection):
    return next((connection[key] for key in ["__netConnectionName", "netConnectionName", "rootConnectionName"] if connection.get(key)), None) or (connection.get("__rootConnectionNames") or [connection.get("name")])[0]


def tagged_owner(resolve, alias):
    if not isinstance(alias, str):
        return {"kind": "unresolved", "declaredAlias": alias, "status": "not_a_string_alias"}
    status, owner = resolve(alias)
    return {"kind": "declared", "name": owner} if owner is not None else {"kind": "unresolved", "declaredAlias": alias, "status": status}


def connection_digest(connection):
    points = connection.get("pointsToConnect", [])
    locations = [canonical({"x": p.get("x"), "y": p.get("y"), "z": p.get("z"), "layers": sorted(p.get("layers") or ([p["layer"]] if p.get("layer") else []))}) for p in points]
    ports = {p["pcb_port_id"] for p in points if isinstance(p.get("pcb_port_id"), str)}
    invalid = sum(not all(type(p.get(k)) in [int, float] and math.isfinite(p[k]) for k in ["x", "y"]) or not (p.get("layer") or p.get("layers") or type(p.get("z")) in [int, float]) for p in points)
    return {"name": connection.get("name"), "source_trace_id": connection.get("source_trace_id"), "rootConnectionNames": connection.get("__rootConnectionNames"), "rootConnectionName": connection.get("rootConnectionName"), "netConnectionName": connection.get("__netConnectionName", connection.get("netConnectionName")), "declaredOwner": declared_owner(connection), "pointCount": len(points), "distinctPhysicalPointCount": len(set(locations)), "invalidOrLayerlessPointCount": invalid, "distinctPcbPortCount": len(ports), "terminalExamples": [{**compact_geometry(p), **{k: p[k] for k in ["pcb_port_id", "pointId"] if k in p}} for p in points[:8]]}


def obstacle_digest(obstacle, resolve):
    metadata = obstacle.get("circuitJsonMetadata") or {}
    references = obstacle.get("connectedTo") or []
    return {**compact_geometry(obstacle), **{k: obstacle[k] for k in ["obstacleId", "ccwRotationDegrees", "isNonPlatedHole", "isVia", "isPad"] if k in obstacle}, "rawObstacleHash": digest(obstacle), "connectedTo": references, "sourceIdentity": metadata,
        "declaredOwnerReferences": [{"rawReference": reference, "owner": tagged_owner(resolve, reference)} for reference in references] if resolve else [],
        "qualification": "Containing raw obstacle for an exact identifier match; metadata and connectedTo references only. No converted pad-fragment identity is inferred."}


def identifier_index(value, prefix, resolve=None):
    index = collections.defaultdict(list)
    def visit(obj, path, obstacle=None, connection=None):
        if isinstance(obj, dict):
            if re.fullmatch(re.escape(prefix) + r"\.obstacles\[\d+\]", path):
                obstacle = obj
            if re.fullmatch(re.escape(prefix) + r"\.connections\[\d+\]", path):
                connection = obj
            for key, item in obj.items():
                if key.endswith("_id") or key.endswith("_ids") or key in ["pointId", "obstacleId"]:
                    for identifier in item if isinstance(item, list) else [item]:
                        if isinstance(identifier, str):
                            entry = {"path": path, "field": key, "objectHash": digest(obj), "geometry": compact_geometry(obj)}
                            if obstacle is not None:
                                entry["containingObstacle"] = obstacle_digest(obstacle, resolve)
                            if connection is not None:
                                entry["containingConnection"] = connection_digest(connection)
                            index[identifier].append(entry)
                if isinstance(item, (dict, list)):
                    visit(item, path + "." + key, obstacle, connection)
        elif isinstance(obj, list):
            for n, item in enumerate(obj):
                visit(item, path + f"[{n}]", obstacle, connection)
    visit(value, prefix)
    return index


def combined_traces(original, new):
    replaced = {t["__replaces_pcb_trace_id"] for t in new if t.get("__replaces_pcb_trace_id")}
    return [t for t in original.get("traces", []) if t.get("pcb_trace_id") not in replaced] + new


def trace_payload(trace):
    # Preserve every other field, including logical owner and replacement IDs.
    return {key: value for key, value in trace.items() if key != "pcb_trace_id"}


def owner_maps(original, context):
    aliases = collections.defaultdict(set)
    port_owners = collections.defaultdict(set)
    ports = collections.defaultdict(list)
    for source, srj in [("original", original), ("pointPairs", context)]:
        for connection in srj.get("connections", []):
            owner = declared_owner(connection)
            if isinstance(owner, str):
                aliases[owner].add(owner)
            for alias in [connection.get("name"), connection.get("source_trace_id"), *(connection.get("__rootConnectionNames") or []), *(connection.get("mergedConnectionNames") or [])]:
                if isinstance(alias, str):
                    aliases[alias].add(owner)
            for point in connection.get("pointsToConnect", []):
                port_id = point.get("pcb_port_id")
                if source == "original":
                    for alias in [port_id, point.get("pointId")]:
                        if isinstance(alias, str):
                            aliases[alias].add(owner)
                if isinstance(port_id, str) and source == "original":
                    port_owners[port_id].add(owner)
                    ports[port_id].append(point)
    def resolve(alias):
        values = aliases.get(alias)
        if not values:
            return ("unresolved", None)
        if len(values) != 1:
            return ("ambiguous", None)
        return ("declared_alias", next(iter(values)))
    return resolve, ports, port_owners


def via_defaults(original, context):
    def finite(*values):
        return next((v for v in values if type(v) in [int, float] and math.isfinite(v)), None)
    hole = finite(context.get("min_via_hole_diameter"), context.get("minViaHoleDiameter"))
    pad = finite(context.get("min_via_pad_diameter"), context.get("minViaPadDiameter"), context.get("minViaDiameter"))
    dimensions_pad = max(pad if pad is not None else 0.3, hole if hole is not None else 0)
    # evaluateRelaxedDrc passes original.minViaDiameter as an explicit option.
    outer = original.get("minViaDiameter")
    outer = dimensions_pad if outer is None else outer
    resolved_hole = hole if hole is not None else (outer * 0.5 if original.get("minViaDiameter") is not None else dimensions_pad * 0.5)
    return outer, resolved_hole


def materialized_via(original, context, point):
    count = context.get("layerCount", original.get("layerCount"))
    stack = ["top"] + [f"inner{i}" for i in range(1, count - 1)] + (["bottom"] if count > 1 else []) if type(count) is int and count >= 1 else []
    outer, hole = via_defaults(original, context)
    if original.get("allowBlindAndBuriedVias") is True and point.get("layers") is not None:
        layers = point["layers"]
    elif original.get("allowBlindAndBuriedVias") is not True:
        layers = stack
    elif point.get("from_layer") in stack and point.get("to_layer") in stack:
        a, b = sorted([stack.index(point["from_layer"]), stack.index(point["to_layer"])])
        layers = stack[a:b + 1]
    else:
        layers = None
    return {"x": point.get("x"), "y": point.get("y"), "outer_diameter": point.get("via_diameter") if point.get("via_diameter") is not None else outer, "hole_diameter": point.get("via_hole_diameter") if point.get("via_hole_diameter") is not None else hole, "layers": layers}


def converter_via_allocations(original, context, traces, resolve):
    supported = all(trace.get("type") == "pcb_trace" for trace in traces)
    if not supported:
        return {}, {"applicable": False, "reason": "Combined trace format is not uniformly simplified pcb_trace; allocation map was not emulated"}
    known_layers = {"top", "bottom", *[f"inner{i}" for i in range(1, 9)]}
    allocations = {}
    by_location = {}
    skipped = []
    occurrence_count = 0
    for trace_index, trace in enumerate(traces):
        for point_index, point in enumerate(trace.get("route", [])):
            if point.get("route_type") != "via":
                continue
            occurrence_count += 1
            if point.get("from_layer") not in known_layers or point.get("to_layer") not in known_layers:
                skipped.append({"traceIndex": trace_index, "routePointIndex": point_index, "from_layer": point.get("from_layer"), "to_layer": point.get("to_layer")})
                continue
            # Numeric tuple equality matches JS finite-number string keys,
            # including 0/-0 and integer/float spelling. The transition order
            # is retained: top->bottom and bottom->top are separate keys.
            key = (point.get("x"), point.get("y"), point.get("from_layer"), point.get("to_layer"))
            occurrence = {"traceIndex": trace_index, "routePointIndex": point_index, "pcb_trace_id": trace.get("pcb_trace_id"), "connection_name": trace.get("connection_name"), "owner": tagged_owner(resolve, trace.get("connection_name")), "rawRoutePoint": point, "materializationIfFirst": materialized_via(original, context, point), "traceGeometryHash": digest(trace_payload(trace))}
            if key not in by_location and (occurrence["materializationIfFirst"]["layers"] is None or not occurrence["materializationIfFirst"]["layers"] and not (original.get("allowBlindAndBuriedVias") is True and point.get("layers") == [])):
                return {}, {"applicable": False, "reason": "Pinned getViaLayers would reject the board count or blind-via endpoint span", "traceIndex": trace_index, "routePointIndex": point_index}
            if key not in by_location:
                via_id = f"via_{len(allocations)}"
                by_location[key] = via_id
                allocations[via_id] = {"pcb_via_id": via_id, "firstRawOccurrence": occurrence, "materializedGeometry": {"type": "pcb_via", "pcb_via_id": via_id, "pcb_trace_id": trace.get("pcb_trace_id"), **occurrence["materializationIfFirst"]}, "rawOccurrences": []}
            allocations[by_location[key]]["rawOccurrences"].append(occurrence)
    for allocation in allocations.values():
        occurrences = allocation["rawOccurrences"]
        tags = {canonical(o["owner"]) for o in occurrences}
        declared = {o["owner"]["name"] for o in occurrences if o["owner"]["kind"] == "declared"}
        allocation["rawOccurrenceCount"] = len(occurrences)
        allocation["deduplicatedOccurrenceCount"] = len(occurrences) - 1
        allocation["rawOccurrenceOwnerTags"] = [json.loads(tag) for tag in sorted(tags)]
        allocation["hasDistinctResolvedRawOwners"] = len(declared) > 1
        allocation["hasUnresolvedRawOwner"] = any(o["owner"]["kind"] != "declared" for o in occurrences)
        allocation["rawOccurrenceExamples"] = occurrences[:8]
        del allocation["rawOccurrences"]
    summary = {"applicable": True, "allocatedViaCount": len(allocations), "rawViaOccurrenceCount": occurrence_count, "deduplicatedRawOccurrenceCount": sum(a["deduplicatedOccurrenceCount"] for a in allocations.values()), "skippedInvalidLayerOccurrenceCount": len(skipped), "skippedInvalidLayerExamples": skipped[:8], "allocationMapHash": digest(allocations),
        "source": "Pinned convertToCircuitJson.ts extractViasFromRoutes simplified pcb_trace branch: first valid raw occurrence allocates via_N in combined trace/point order, dedup key x,y,from_layer,to_layer ignores owner; known names top,bottom,inner1..inner8. This map reports that behavior without changing it."}
    return allocations, summary


def port_demand_evidence(port_id, original, context, traces, resolve):
    original_matches = [c for c in original.get("connections", []) if any(p.get("pcb_port_id") == port_id for p in c.get("pointsToConnect", []))]
    context_matches = [c for c in context.get("connections", []) if any(p.get("pcb_port_id") == port_id for p in c.get("pointsToConnect", []))]
    owners = {declared_owner(c) for c in original_matches}
    owner = next(iter(owners)) if len(owners) == 1 else None
    owner_group = [c for c in original.get("connections", []) if owner is not None and declared_owner(c) == owner]
    owner_points = [p for c in owner_group for p in c.get("pointsToConnect", [])]
    owner_summary = connection_digest({"name": "raw original declared-owner group", "pointsToConnect": owner_points})
    group_names = {c.get("name") for c in owner_group}
    hints = []
    for c in owner_group:
        for key in ["isOffBoard", "externallyConnectedPointIds"]:
            if c.get(key):
                hints.append({"connectionName": c.get("name"), "field": key, "value": c[key]})
        if len(set(c.get("__rootConnectionNames") or [])) > 1 and not (c.get("__netConnectionName") or c.get("netConnectionName")):
            hints.append({"connectionName": c.get("name"), "field": "multiple_roots_without_explicit_net", "value": c["__rootConnectionNames"]})
        for p in c.get("pointsToConnect", []):
            for key in ["terminalVia", "busId"]:
                if p.get(key):
                    hints.append({"connectionName": c.get("name"), "field": key, "value": p[key]})
    for key in ["buses", "differentialPairs"]:
        for family in original.get(key, []):
            if group_names.intersection(family.get("connectionNames", [])):
                hints.append({"field": key, "value": family})
    group_aliases = {owner, *group_names, *[c.get("source_trace_id") for c in owner_group], *[alias for c in owner_group for alias in c.get("__rootConnectionNames", [])], *[p.get("pcb_port_id") for p in owner_points], *[p.get("pointId") for p in owner_points]}
    group_aliases.discard(None)
    for obstacle in original.get("obstacles", []):
        if obstacle.get("offBoardConnectsTo") and any(reference in group_aliases for reference in obstacle.get("connectedTo", []) if isinstance(reference, str)):
            hints.append({"field": "obstacle_offBoardConnectsTo", "value": obstacle.get("offBoardConnectsTo"), "connectedTo": obstacle.get("connectedTo")})
    owner_alias_status = resolve(owner)[0] if isinstance(owner, str) else "unresolved"
    if not original_matches or owner is None or owner_summary["invalidOrLayerlessPointCount"] or owner_alias_status == "ambiguous":
        classification = "unresolved_original_port_or_declared_owner"
    elif hints:
        classification = "unresolved_special_or_external_demand_hints"
    elif owner_summary["distinctPhysicalPointCount"] >= 2:
        classification = "raw_declared_owner_group_has_two_or_more_distinct_terminals"
    elif owner_summary["distinctPhysicalPointCount"] == 1:
        classification = "no_multiterminal_physical_demand_in_raw_declared_owner_group"
    else:
        classification = "unresolved_empty_terminal_group"
    same_owner = [t for t in traces if owner is not None and resolve(t.get("connection_name"))[1] == owner]
    unresolved = [t for t in traces if resolve(t.get("connection_name"))[1] is None]
    return {"classification": classification, "originalExactPortConnectionCount": len(original_matches), "originalExactPortConnections": [connection_digest(c) for c in original_matches[:8]],
        "declaredOwnerGroup": {"owner": {"kind": "declared", "name": owner} if owner is not None else {"kind": "unresolved"}, "ownerAliasResolutionStatus": owner_alias_status, "originalConnectionCount": len(owner_group), "pointCount": owner_summary["pointCount"], "distinctPhysicalPointCount": owner_summary["distinctPhysicalPointCount"], "distinctPcbPortCount": owner_summary["distinctPcbPortCount"], "connectionExamples": [connection_digest(c) for c in owner_group[:8]], "specialOrExternalDemandHints": hints[:8]},
        "pointPairContextExactPortMembership": {"connectionCount": len(context_matches), "pointOccurrenceCount": sum(p.get("pcb_port_id") == port_id for c in context_matches for p in c.get("pointsToConnect", [])), "connectionExamples": [connection_digest(c) for c in context_matches[:8]]},
        "routedDeclaredOwnerPresence": {"traceCount": len(same_owner), "connectionNameExamples": sorted({t.get("connection_name") for t in same_owner}, key=str)[:8], "unresolvedOrAmbiguousTraceCount": len(unresolved), "exactOriginalConnectionNameTraceCounts": {str(c.get("name")): sum(t.get("connection_name") == c.get("name") for t in traces) for c in original_matches[:8]}},
        "qualification": "Terminal demand is conditional on exact identities in the raw original SRJ declared-owner group, not a claim about a schematic outside that input. Absence from point-pair context is reported separately and never erases an original demand. No owner merge by coordinate proximity."}


def physical_metrics(original, context, traces, resolve):
    layer_count = context.get("layerCount", original.get("layerCount"))
    stack = ["top"] + [f"inner{i}" for i in range(1, layer_count - 1)] + (["bottom"] if layer_count > 1 else []) if isinstance(layer_count, int) and layer_count >= 1 else []
    outer, hole = via_defaults(original, context)
    primitives = []
    sites = collections.defaultdict(set)
    owned_sites = set()
    unknown_owner_sites = set()
    via_count = 0
    unresolved_owners = 0
    unresolved_spans = 0
    for trace in traces:
        status, owner = resolve(trace.get("connection_name"))
        owner_key = {"status": status, "owner": owner, "declaredConnectionName": trace.get("connection_name")}
        if owner is None:
            unresolved_owners += 1
        route = trace.get("route", [])
        trace_metadata = {key: value for key, value in trace_payload(trace).items() if key != "route"}
        # Exact point multiset plus orientation-normalized adjacent route edges:
        # duplicates, all widths, owners and via fields remain represented.
        for point in route:
            primitives.append(["point", owner_key, trace_metadata, point])
            if point.get("route_type") != "via":
                continue
            via_count += 1
            if original.get("allowBlindAndBuriedVias") is True and point.get("layers") is not None:
                layers = point["layers"]
            elif original.get("allowBlindAndBuriedVias") is not True:
                layers = stack
            elif point.get("from_layer") in stack and point.get("to_layer") in stack:
                a, b = sorted([stack.index(point["from_layer"]), stack.index(point["to_layer"])])
                layers = stack[a:b + 1]
            else:
                layers = None
                unresolved_spans += 1
            effective = {"x": point.get("x"), "y": point.get("y"), "layers": sorted(layers) if layers is not None else None, "outerDiameter": point.get("via_diameter", outer), "holeDiameter": point.get("via_hole_diameter", hole)}
            primitives.append(["effectiveVia", owner_key, effective])
            site = canonical([point.get("x"), point.get("y"), effective["layers"]])
            # Ambiguous owners cannot establish foreign-owner coincidence.
            if owner is not None:
                sites[site].add(owner)
                owned_sites.add(canonical([owner, point.get("x"), point.get("y"), effective["layers"]]))
            else:
                unknown_owner_sites.add(site)
        for a, b in zip(route, route[1:]):
            primitives.append(["adjacentRouteEdge", owner_key, trace_metadata, sorted([a, b], key=canonical)])
    foreign = [{"site": json.loads(site), "owners": sorted(owners)} for site, owners in sites.items() if len(owners) > 1]
    return {"traceCount": len(traces), "identityInsensitiveTracePayloadHash": digest(sorted([trace_payload(t) for t in traces], key=canonical)),
        "physicalPrimitiveMultisetHash": digest(sorted(primitives, key=canonical)), "rawViaOccurrenceCount": via_count,
        "rawUniqueOwnedViaSiteSpanCount": len(owned_sites), "rawForeignOwnerCoincidentViaSiteSpanCount": len(foreign), "rawForeignOwnerCoincidentExamples": foreign[:8],
        "rawViaSiteSpansWithUnresolvedOwner": len(unknown_owner_sites),
        "tracesWithUnresolvedOrAmbiguousOwner": unresolved_owners, "viasWithUnresolvedSpan": unresolved_spans,
        "effectiveDefaultOuterDiameter": outer, "effectiveDefaultHoleDiameter": hole,
        "definition": "Raw combined preloaded/new traces; replaced preload IDs removed exactly as pinned evaluator. No coordinate rounding or cross-owner deduplication. Trace payload hash removes pcb_trace_id only and sorts trace order. Primitive hash retains ownership, metadata, every route point/adjacent edge and duplicate multiplicity; route segmentation can change its hash without changing a geometric union. Raw via spans emulate pinned converter getViaDrillLayers before its owner-blind location deduplication. Counts with ambiguous owners cannot establish absence of foreign coincidences."}


def port_copper_evidence(port_id, traces, resolve, ports, port_owners, original=None, context=None):
    points = ports.get(port_id, [])
    owners = port_owners.get(port_id, set())
    if not points or len(owners) != 1:
        return {"pcb_port_id": port_id, "status": "no_exact_original_port" if not points else "ambiguous_declared_owner", **({"terminalDemandEvidence": port_demand_evidence(port_id, original, context, traces, resolve)} if original is not None and context is not None else {})}
    owner = next(iter(owners))
    answers = []
    for point in points[:4]:
        layers = point.get("layers") or ([point["layer"]] if point.get("layer") else [])
        if not layers:
            answers.append({"status": "unknown_port_layers", "point": compact_geometry(point)})
            continue
        best = None
        for trace in traces:
            status, trace_owner = resolve(trace.get("connection_name"))
            if trace_owner is None or trace_owner != owner:
                continue
            route = trace.get("route", [])
            for index, a in enumerate(route):
                if a.get("route_type") != "wire" or a.get("layer") not in layers:
                    continue
                b = route[index + 1] if index + 1 < len(route) else None
                if not b or b.get("route_type") != "wire" or b.get("layer") != a.get("layer"):
                    b = a
                if not all(type(p.get(k)) in [int, float] for p in [point, a, b] for k in ["x", "y"]):
                    continue
                dx, dy = b["x"] - a["x"], b["y"] - a["y"]
                denominator = dx * dx + dy * dy
                t = max(0, min(1, ((point["x"] - a["x"]) * dx + (point["y"] - a["y"]) * dy) / denominator)) if denominator else 0
                distance = math.hypot(point["x"] - a["x"] - t * dx, point["y"] - a["y"] - t * dy)
                widths = [p["width"] for p in [a, b] if type(p.get("width")) in [int, float]]
                candidate = {"centerlineDistance": distance, "layer": a["layer"], "widthRange": [min(widths), max(widths)] if widths else None,
                    "withinMinimumEndpointHalfWidth": distance <= min(widths) / 2 + 1e-12 if widths else None,
                    "withinMaximumEndpointHalfWidth": distance <= max(widths) / 2 + 1e-12 if widths else None,
                    "traceGeometryHash": digest(trace_payload(trace))}
                if best is None or distance < best["centerlineDistance"]:
                    best = candidate
        answers.append({"point": compact_geometry(point), "nearestSameDeclaredOwnerCopper": best})
    return {"pcb_port_id": port_id, "status": "exact_original_port_and_unique_declared_owner", "declaredOwner": owner, "points": answers,
        **({"terminalDemandEvidence": port_demand_evidence(port_id, original, context, traces, resolve)} if original is not None and context is not None else {}),
        "qualification": "Geometric point/centerline evidence only; this does not excuse source-connectivity checker errors, establish pad identity or merge owners by proximity. Variable widths are bounded by endpoint widths."}


def trace_participant_digest(trace, error, original, resolve):
    route = trace.get("route", [])
    result = {"pcb_trace_id": trace.get("pcb_trace_id"), "connection_name": trace.get("connection_name"), "owner": tagged_owner(resolve, trace.get("connection_name")), "connectsTo": trace.get("connectsTo"), "geometry": compact_geometry(trace), "firstRoutePoint": route[0] if route else None, "lastRoutePoint": route[-1] if route else None}
    center = error.get("center") or error.get("pcb_center")
    if isinstance(center, dict) and all(type(center.get(k)) in [int, float] for k in ["x", "y"]):
        result["errorLocationEndpointDistances"] = [{"endpoint": label, "distance": math.hypot(center["x"] - point["x"], center["y"] - point["y"]), "layer": point.get("layer"), "exactCoordinateMatch": point["x"] == center["x"] and point["y"] == center["y"]} for label, point in ([("first", route[0]), ("last", route[-1])] if route else []) if all(type(point.get(k)) in [int, float] for k in ["x", "y"])]
        original_matches = []
        for connection in original.get("connections", []):
            for point in connection.get("pointsToConnect", []):
                if point.get("x") == center["x"] and point.get("y") == center["y"]:
                    original_matches.append({"connectionName": connection.get("name"), "declaredOwner": declared_owner(connection), "point": {**compact_geometry(point), **{k: point[k] for k in ["pcb_port_id", "pointId"] if k in point}}})
        result["originalTerminalsAtExactErrorXY"] = original_matches[:8]
        result["originalTerminalsAtExactErrorXYCount"] = len(original_matches)
    return result


def via_pad_owner_relations(participants):
    vias = [p for p in participants if p.get("pinnedConverterViaAllocation")]
    pads = [p for p in participants if p not in vias and (any(m.get("containingObstacle") for m in p.get("originalExactIdentifierMatches", [])) or p.get("originalExactIdentifierMatchCount", 0) > len(p.get("originalExactIdentifierMatches", [])))]
    results = []
    for via in vias:
        allocation = via["pinnedConverterViaAllocation"]
        via_owner = allocation["firstRawOccurrence"]["owner"]
        for pad in pads:
            original_match_count = pad.get("originalExactIdentifierMatchCount", len(pad["originalExactIdentifierMatches"]))
            truncated_matches = original_match_count > len(pad["originalExactIdentifierMatches"])
            references = [r for m in pad["originalExactIdentifierMatches"] for r in m.get("containingObstacle", {}).get("declaredOwnerReferences", [])]
            unique_refs = {canonical(r): r for r in references}
            references = list(unique_refs.values())
            owners = {r["owner"]["name"] for r in references if r["owner"]["kind"] == "declared"}
            all_resolved = bool(references) and all(r["owner"]["kind"] == "declared" for r in references)
            if via_owner["kind"] != "declared" or not all_resolved or via.get("originalExactIdentifierMatches") or truncated_matches:
                relation = "unresolved_or_identifier_collision"
            elif owners == {via_owner["name"]}:
                relation = "same_resolved_declared_owner"
            elif via_owner["name"] not in owners:
                relation = "distinct_resolved_declared_owners"
            else:
                relation = "multiple_pad_owner_references_include_via_owner"
            results.append({"viaId": via["id"], "padId": pad["id"], "firstAllocatedViaOwner": via_owner, "padRawConnectedToOwnerReferences": references, "originalExactIdentifierMatchCount": original_match_count, "originalExactIdentifierMatchesTruncated": truncated_matches, "relation": relation,
                "qualification": "Relation follows exact allocated raw via identity and exact raw obstacle metadata ID matches/connectedTo aliases. It does not replace the source library connectivity map or excuse the reported clearance finding."})
    return results


def error_fingerprint(error, trace_hashes):
    def normalize(key, value):
        if key in ["pcb_trace_id", "pcb_trace_ids"]:
            def trace_id(item):
                return {"traceGeometryHash": trace_hashes[item]} if item in trace_hashes else item
            return sorted([trace_id(v) for v in value], key=canonical) if isinstance(value, list) else trace_id(value)
        if key == "message" and isinstance(value, str):
            for identifier in sorted(trace_hashes, key=len, reverse=True):
                value = re.sub(r"(?<![A-Za-z0-9_])" + re.escape(identifier) + r"(?![A-Za-z0-9_])", "traceGeometry:" + trace_hashes[identifier], value)
            return value
        return value
    return digest({key: normalize(key, value) for key, value in error.items()})


def inspect_raw(raw, record, expected, issue, example_limit):
    original = read(raw / "original-input.json")
    context = read(raw / "point-pair-context.json")
    new = read(raw / "raw-new-traces.json")
    capture = read(raw / "capture-provenance.json")
    supplemental = read(raw / "supplemental-validation.json") if (raw / "supplemental-validation.json").exists() else None
    arm = record["arm"]
    config = expected["configs"][arm]
    for key, value in {"actualSolverName": config["solverName"], "actualConstructorName": config["solverName"], "solverModule": config["solverModule"], "options": config["options"], "inputHash": record["expectedInputHash"]}.items():
        if capture.get(key) != value:
            issue("capture_mismatch", field=key, expected=value, observed=capture.get(key))
    if capture.get("inputMutated"):
        issue("input_mutated")
    for name, key in [("original-input.json", "inputHash"), ("raw-new-traces.json", "rawNewTracesHash"), ("raw-solver-output.json", "rawOutputHash")]:
        if (raw / name).exists() and file_digest(raw / name) != capture.get(key):
            issue("capture_file_hash_mismatch", file=name, field=key)
    traces = combined_traces(original, new)
    trace_hashes = {t["pcb_trace_id"]: digest(trace_payload(t)) for t in traces if isinstance(t.get("pcb_trace_id"), str)}
    new_ids = {t.get("pcb_trace_id") for t in new}
    resolve, ports, port_owners = owner_maps(original, context)
    input_index = identifier_index(original, "original", resolve)
    context_index = identifier_index(context, "pointPairs", resolve)
    via_allocations, via_allocation_summary = converter_via_allocations(original, context, traces, resolve)
    via_allocation_summary["pinnedConverterSourceHash"] = expected["validatorHashes"]["lib/testing/utils/convertToCircuitJson.ts"]
    result = {"capture": {key: capture.get(key) for key in ["actualConstructorName", "options", "inputHash", "inputMutated", "rawNewTracesHash", "constructorTimeMs"]},
        "inputGeometry": {"originalHash": file_digest(raw / "original-input.json"), "pointPairContextHash": file_digest(raw / "point-pair-context.json"), "obstacleCount": len(original.get("obstacles", [])), "connectionCount": len(original.get("connections", []))},
        "rawPhysicalCopper": physical_metrics(original, context, traces, resolve), "pinnedConverterViaAllocationSummary": via_allocation_summary, "supplementalAvailable": supplemental is not None}
    if supplemental is None:
        return result
    input_only = {name: {error_fingerprint(error, trace_hashes) for error in (supplemental.get(name) or {}).get("errors", [])} for name in ["inputOnlyPhysicalChecks", "inputOnlyConnectivityFindings"]}
    checks = {}
    for name in CHECKS:
        check = supplemental.get(name) or {}
        errors = check.get("errors", [])
        fingerprints = [error_fingerprint(error, trace_hashes) for error in errors]
        origins = collections.Counter()
        examples_by_type = collections.defaultdict(list)
        all_physical_examples = []
        port_touch_counts = collections.Counter()
        port_demand_counts = collections.Counter()
        via_pad_owner_counts = collections.Counter()
        for error, fingerprint in zip(errors, fingerprints):
            participants = []
            participant_ids = []
            new_trace_participant = False
            for field, value in error.items():
                if field.endswith("_id") or field.endswith("_ids"):
                    for identifier in value if isinstance(value, list) else [value]:
                        if not isinstance(identifier, str):
                            continue
                        participant_ids.append(identifier)
                        entry = {"field": field, "id": identifier, "originalExactIdentifierMatchCount": len(input_index.get(identifier, [])), "originalExactIdentifierMatches": input_index.get(identifier, [])[:4], "pointPairExactIdentifierMatchCount": len(context_index.get(identifier, [])), "pointPairExactIdentifierMatches": context_index.get(identifier, [])[:4]}
                        if identifier in trace_hashes and field in ["pcb_trace_id", "pcb_trace_ids"]:
                            entry["traceGeometryHash"] = trace_hashes[identifier]
                            entry["newlyRoutedTrace"] = identifier in new_ids
                            new_trace_participant |= identifier in new_ids
                            entry["rawTraceParticipantDigests"] = [trace_participant_digest(t, error, original, resolve) for t in traces if t.get("pcb_trace_id") == identifier][:4]
                        if identifier in via_allocations and field in ["pcb_pad_id", "pcb_pad_ids", "pcb_via_id", "pcb_via_ids"]:
                            entry["pinnedConverterViaAllocation"] = via_allocations[identifier]
                        participants.append(entry)
            exact_physical = fingerprint in input_only["inputOnlyPhysicalChecks"]
            exact_connectivity = fingerprint in input_only["inputOnlyConnectivityFindings"]
            if exact_physical:
                origin = "identical_input_only_reference_physical_fingerprint"
            elif exact_connectivity:
                origin = "identical_input_only_reference_connectivity_fingerprint"
            elif new_trace_participant:
                origin = "involves_newly_routed_trace_causation_not_established"
            elif participant_ids and all(identifier in input_index for identifier in participant_ids):
                origin = "all_participant_ids_present_in_raw_original_origin_not_established"
            else:
                origin = "origin_unresolved"
            origins[origin] += 1
            example = {"fingerprint": fingerprint, "type": error.get("type"), "message": str(error.get("message", ""))[:800], "location": {key: error[key] for key in ["center", "pcb_center", "x", "y"] if key in error}, "originEvidence": origin, "participants": participants[:12]}
            owner_relations = via_pad_owner_relations(participants)
            if owner_relations:
                example["viaPadDeclaredOwnerRelations"] = owner_relations
                via_pad_owner_counts.update(relation["relation"] for relation in owner_relations)
            if error.get("type") == "pcb_port_not_connected_error":
                port_ids = [p["id"] for p in participants if p["field"] in ["pcb_port_id", "pcb_port_ids"]]
                evidence = [port_copper_evidence(identifier, traces, resolve, ports, port_owners, original, context) for identifier in port_ids]
                example["exactPortCopperEvidence"] = evidence[:4]
                if not evidence:
                    port_demand_counts["no_exact_pcb_port_participant"] += 1
                for finding in evidence:
                    port_demand_counts[finding.get("terminalDemandEvidence", {}).get("classification", "unresolved")] += 1
                    points = finding.get("points", [])
                    if points and all(p.get("nearestSameDeclaredOwnerCopper", {}).get("withinMinimumEndpointHalfWidth") is True for p in points if p.get("nearestSameDeclaredOwnerCopper")) and all(p.get("nearestSameDeclaredOwnerCopper") is not None for p in points):
                        port_touch_counts["exact_port_point_within_same_owner_copper_min_halfwidth"] += 1
                    else:
                        port_touch_counts["touch_not_established"] += 1
            if len(examples_by_type[str(error.get("type"))]) < example_limit:
                examples_by_type[str(error.get("type"))].append(example)
            if name == "libraryRoutingChecks" and error.get("type") in ["pcb_trace_error", "pcb_pad_pad_clearance_error"] and len(all_physical_examples) < 64:
                all_physical_examples.append(example)
        checks[name] = {"count": check.get("count"), "byType": check.get("byType"), "errorRecordsInspected": len(errors), "normalizedErrorFingerprintMultisetHash": digest(sorted(fingerprints)), "originEvidenceCounts": dict(origins), "examplesByType": dict(examples_by_type)}
        if all_physical_examples:
            checks[name]["boundedTraceAndPadFindings"] = all_physical_examples
        if port_touch_counts:
            checks[name]["portCopperEvidenceCounts"] = dict(port_touch_counts)
        if port_demand_counts:
            checks[name]["portTerminalDemandEvidenceCounts"] = dict(port_demand_counts)
        if via_pad_owner_counts:
            checks[name]["viaPadDeclaredOwnerRelationCounts"] = dict(via_pad_owner_counts)
    result["checks"] = checks
    result["originalSupplementalPhysicalMetrics"] = supplemental.get("physicalCopper")
    result["validationConfiguration"] = supplemental.get("validationConfiguration")
    return result


def inspect_artifact(directory, expected, example_limit=3):
    issues = []
    def issue(kind, **details):
        issues.append({"kind": kind, **details})
    matches = []
    for path in directory.rglob("provenance.json"):
        value = read(path)
        if value.get("dataset") == expected["dataset"] and value.get("experiment", {}).get("pr") == expected["pr"]:
            matches.append((path, value))
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one matching artifact provenance, found {len(matches)}")
    provenance_path, provenance = matches[0]
    root = provenance_path.parent
    for field, observed, wanted in [("githubRunId", str(provenance.get("githubRunId")), str(expected["runId"])), ("controllerSha", provenance.get("controllerSha"), expected["controllerSha"]), ("baselineSha", provenance.get("manifest", {}).get("baselineSha"), expected["baselineSha"]), ("candidateSha", provenance.get("experiment", {}).get("candidateSha"), expected["candidateSha"])]:
        if observed != wanted:
            issue("provenance_mismatch", field=field, expected=wanted, observed=observed)
    for arm in ["A", "B"]:
        config_path = root / f"config-{arm}.json"
        if not config_path.exists() or read(config_path) != expected["configs"][arm]:
            issue("config_mismatch", arm=arm)
        observed_sha = provenance.get("harnesses", {}).get(arm, {}).get("checkoutSha")
        wanted = expected["baselineSha"] if arm == "A" else expected["candidateSha"]
        if observed_sha != wanted:
            issue("algorithm_checkout_mismatch", arm=arm, expected=wanted, observed=observed_sha)
    harnesses = provenance.get("harnesses", {})
    for arm in ["A", "B"]:
        for key in ["officialHarnessHash", "adaptedHarnessHash", "adapterHash", "benchmarkShellHash"]:
            value = harnesses.get(arm, {}).get(key)
            if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
                issue("missing_or_invalid_harness_hash", arm=arm, field=key)
        for key, value in expected["harnessSourceHashes"].items():
            if harnesses.get(arm, {}).get(key) != value:
                issue("pinned_harness_source_hash_mismatch", arm=arm, field=key)
        if harnesses.get(arm, {}).get("validators") != expected["validatorHashes"]:
            issue("pinned_validator_hashes_mismatch", arm=arm)
    for key in ["officialHarnessHash", "adaptedHarnessHash", "adapterHash", "benchmarkShellHash", "validators"]:
        if harnesses.get("A", {}).get(key) != harnesses.get("B", {}).get(key):
            issue("matched_harness_mismatch", field=key)
    population = {str(item["sampleNumber"]): item["inputHash"] for item in provenance.get("inputPopulation", [])}
    if population != expected["inputHashes"]:
        issue("input_population_mismatch", expected=expected["inputHashes"], observed=population)
    results = []
    seen = set()
    for path in sorted(root.rglob("audit-result.json")):
        record = read(path)
        key = (record.get("round"), record.get("sampleNumber"), record.get("arm"))
        if key[0] not in [1, 2] or str(key[1]) not in expected["inputHashes"] or key[2] not in ["A", "B"]:
            issue("unexpected_result_key", key=key)
            continue
        if key in seen:
            issue("duplicate_result", key=key)
            continue
        seen.add(key)
        context = {"round": key[0], "sample": key[1], "arm": key[2]}
        def sample_issue(kind, **details):
            issue(kind, **context, **details)
        for field, wanted in [("pr", expected["pr"]), ("dataset", expected["dataset"]), ("sha", expected["baselineSha"] if record.get("arm") == "A" else expected["candidateSha"]), ("expectedInputHash", expected["inputHashes"].get(str(record.get("sampleNumber"))))]:
            if record.get(field) != wanted:
                sample_issue("result_provenance_mismatch", field=field, expected=wanted, observed=record.get(field))
        official = record.get("official") or {}
        result = {**context, "official": {k: official.get(k) for k in ["didSolve", "didTimeout", "relaxedDrcPassed", "elapsedTimeMs", "viaCount", "error", "drcErrorCount", "traceLintIssueCounts"]}}
        raw = path.parent / "raw"
        if (raw / "capture-provenance.json").exists():
            result["inspection"] = inspect_raw(raw, record, expected, sample_issue, example_limit)
        else:
            result["rawCaptureAvailable"] = False
        results.append(result)
    first_keys = {(r["sample"], r["arm"]) for r in results if r["round"] == 1}
    wanted_keys = {(int(sample), arm) for sample in expected["inputHashes"] for arm in ["A", "B"]}
    if first_keys != wanted_keys:
        issue("incomplete_first_population", missing=sorted(wanted_keys - first_keys), unexpected=sorted(first_keys - wanted_keys))
    totals = {arm: collections.Counter() for arm in ["A", "B"]}
    for result in results:
        if result["round"] == 1:
            totals[result["arm"]].update((result.get("inspection", {}).get("checks", {}).get("libraryRoutingChecks") or {}).get("byType") or {})
    pairs = []
    indexed = {(r["round"], r["sample"], r["arm"]): r for r in results}
    for sample in sorted(int(s) for s in expected["inputHashes"]):
        for arm in ["A", "B"]:
            first, second = indexed.get((1, sample, arm)), indexed.get((2, sample, arm))
            left = (first or {}).get("inspection", {}).get("rawPhysicalCopper")
            right = (second or {}).get("inspection", {}).get("rawPhysicalCopper")
            if left and right:
                pairs.append({"sample": sample, "arm": arm, "sameStrictTracePayload": left["identityInsensitiveTracePayloadHash"] == right["identityInsensitiveTracePayloadHash"], "samePhysicalPrimitiveMultiset": left["physicalPrimitiveMultisetHash"] == right["physicalPrimitiveMultisetHash"]})
    return {"sourceArtifact": expected["artifact"], "expectedProvenance": {k: expected[k] for k in ["runId", "controllerSha", "baselineSha", "candidateSha", "pr", "dataset"]},
        "retainedHarnessProvenance": {arm: {key: harnesses.get(arm, {}).get(key) for key in ["checkoutSha", "officialHarnessHash", "adaptedHarnessHash", "adapterHash", "benchmarkShellHash", "validators"]} for arm in ["A", "B"]},
        "qualification": "PROVENANCE_CHECKS_PASSED" if not issues else "DISQUALIFIED_PROVENANCE_OR_COMPLETENESS_FAILURE",
        "integrityIssues": issues, "results": results, "firstRoundLibraryErrorTotals": {arm: dict(counts) for arm, counts in totals.items()}, "repeatGeometryComparisons": pairs,
        "limits": "Read-only inspection of retained outputs. No solver, converter or checks are rerun. Artifact API ZIP digest is recorded, not independently recomputed from extracted files. Exact raw-ID matches and exact input-only fingerprints provide evidence; unresolved converter-generated IDs remain unresolved. Shared error counts alone never establish shared origin. All original raw artifacts remain in the source workflow. Physical hashes preserve primitive segmentation and multiplicity; unequal hashes do not prove different physical unions."}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=pathlib.Path, required=True)
    parser.add_argument("--expected", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--example-limit", type=int, default=3)
    parser.add_argument("--source-metadata", type=pathlib.Path)
    args = parser.parse_args()
    result = inspect_artifact(args.directory, read(args.expected), max(0, min(args.example_limit, 5)))
    if args.source_metadata:
        result["sourceArtifactMetadataVerification"] = read(args.source_metadata)
        if result["sourceArtifactMetadataVerification"].get("qualification") != "EXACT_ARTIFACT_METADATA_VERIFIED":
            result["integrityIssues"].append({"kind": "source_artifact_metadata_not_verified"})
            result["qualification"] = "DISQUALIFIED_PROVENANCE_OR_COMPLETENESS_FAILURE"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print("ARTIFACT_INSPECTION_SUMMARY_JSON " + canonical({"sourceArtifact": result["sourceArtifact"], "qualification": result["qualification"], "integrityIssueCount": len(result["integrityIssues"]), "resultCount": len(result["results"]), "firstRoundLibraryErrorTotals": result["firstRoundLibraryErrorTotals"], "repeatGeometryComparisons": result["repeatGeometryComparisons"]}))
    for row in result["results"]:
        if row["round"] != 1 or "inspection" not in row:
            continue
        library = row["inspection"].get("checks", {}).get("libraryRoutingChecks", {})
        context = {"sample": row["sample"], "arm": row["arm"]}
        input_physical = row["inspection"].get("checks", {}).get("inputOnlyPhysicalChecks", {})
        print("ARTIFACT_INSPECTION_FINDINGS_JSON " + canonical({**context, "rawPhysicalCopper": row["inspection"]["rawPhysicalCopper"], "pinnedConverterViaAllocationSummary": row["inspection"]["pinnedConverterViaAllocationSummary"], "libraryCounts": library.get("byType"), "originEvidenceCounts": library.get("originEvidenceCounts"), "portCopperEvidenceCounts": library.get("portCopperEvidenceCounts"), "portTerminalDemandEvidenceCounts": library.get("portTerminalDemandEvidenceCounts"), "viaPadDeclaredOwnerRelationCounts": library.get("viaPadDeclaredOwnerRelationCounts"), "inputOnlyPhysicalFindings": {key: input_physical.get(key) for key in ["count", "byType", "normalizedErrorFingerprintMultisetHash", "originEvidenceCounts"]}}))
        for finding in library.get("boundedTraceAndPadFindings", []):
            print("ARTIFACT_INSPECTION_PHYSICAL_FINDING_JSON " + canonical({**context, "finding": finding}))
        for kind, examples in library.get("examplesByType", {}).items():
            if kind in ["pcb_port_not_connected_error", "pcb_trace_style_warning"]:
                for example in examples:
                    print("ARTIFACT_INSPECTION_PORT_STYLE_EXAMPLE_JSON " + canonical({**context, "type": kind, "example": example}))
    if result["integrityIssues"]:
        print("ARTIFACT_INSPECTION_ISSUES_JSON " + canonical(result["integrityIssues"][:20]))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
