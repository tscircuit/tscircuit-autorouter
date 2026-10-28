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


def identifier_index(value, prefix):
    index = collections.defaultdict(list)
    def visit(obj, path):
        if isinstance(obj, dict):
            for key, item in obj.items():
                if key.endswith("_id") or key.endswith("_ids") or key in ["pointId", "obstacleId"]:
                    for identifier in item if isinstance(item, list) else [item]:
                        if isinstance(identifier, str):
                            index[identifier].append({"path": path, "field": key, "objectHash": digest(obj), "geometry": compact_geometry(obj)})
                if isinstance(item, (dict, list)):
                    visit(item, path + "." + key)
        elif isinstance(obj, list):
            for n, item in enumerate(obj):
                visit(item, path + f"[{n}]")
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
            owner = next((connection[key] for key in ["__netConnectionName", "netConnectionName", "rootConnectionName"] if connection.get(key)), None)
            owner = owner or (connection.get("__rootConnectionNames") or [connection.get("name")])[0]
            for alias in [connection.get("name"), connection.get("source_trace_id"), *(connection.get("__rootConnectionNames") or []), *(connection.get("mergedConnectionNames") or [])]:
                if isinstance(alias, str):
                    aliases[alias].add(owner)
            for point in connection.get("pointsToConnect", []):
                port_id = point.get("pcb_port_id")
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


def port_copper_evidence(port_id, traces, resolve, ports, port_owners):
    points = ports.get(port_id, [])
    owners = port_owners.get(port_id, set())
    if not points or len(owners) != 1:
        return {"pcb_port_id": port_id, "status": "no_exact_original_port" if not points else "ambiguous_declared_owner"}
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
        "qualification": "Geometric point/centerline evidence only; this does not excuse source-connectivity checker errors, establish pad identity or merge owners by proximity. Variable widths are bounded by endpoint widths."}


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
    input_index = identifier_index(original, "original")
    context_index = identifier_index(context, "pointPairs")
    resolve, ports, port_owners = owner_maps(original, context)
    result = {"capture": {key: capture.get(key) for key in ["actualConstructorName", "options", "inputHash", "inputMutated", "rawNewTracesHash", "constructorTimeMs"]},
        "inputGeometry": {"originalHash": file_digest(raw / "original-input.json"), "pointPairContextHash": file_digest(raw / "point-pair-context.json"), "obstacleCount": len(original.get("obstacles", [])), "connectionCount": len(original.get("connections", []))},
        "rawPhysicalCopper": physical_metrics(original, context, traces, resolve), "supplementalAvailable": supplemental is not None}
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
                        entry = {"field": field, "id": identifier, "originalExactIdentifierMatches": input_index.get(identifier, [])[:4], "pointPairExactIdentifierMatches": context_index.get(identifier, [])[:4]}
                        if identifier in trace_hashes and field in ["pcb_trace_id", "pcb_trace_ids"]:
                            entry["traceGeometryHash"] = trace_hashes[identifier]
                            entry["newlyRoutedTrace"] = identifier in new_ids
                            new_trace_participant |= identifier in new_ids
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
            if error.get("type") == "pcb_port_not_connected_error":
                port_ids = [p["id"] for p in participants if p["field"] in ["pcb_port_id", "pcb_port_ids"]]
                evidence = [port_copper_evidence(identifier, traces, resolve, ports, port_owners) for identifier in port_ids[:4]]
                example["exactPortCopperEvidence"] = evidence
                for finding in evidence:
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
        print("ARTIFACT_INSPECTION_FINDINGS_JSON " + canonical({"sample": row["sample"], "arm": row["arm"], "rawPhysicalCopper": row["inspection"]["rawPhysicalCopper"], "libraryCounts": library.get("byType"), "originEvidenceCounts": library.get("originEvidenceCounts"), "portCopperEvidenceCounts": library.get("portCopperEvidenceCounts"), "boundedTraceAndPadFindings": library.get("boundedTraceAndPadFindings", []), "boundedPortAndStyleExamples": {key: value for key, value in library.get("examplesByType", {}).items() if key in ["pcb_port_not_connected_error", "pcb_trace_style_warning"]}, "inputOnlyPhysicalFindings": row["inspection"].get("checks", {}).get("inputOnlyPhysicalChecks")}))
    if result["integrityIssues"]:
        print("ARTIFACT_INSPECTION_ISSUES_JSON " + canonical(result["integrityIssues"][:20]))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
