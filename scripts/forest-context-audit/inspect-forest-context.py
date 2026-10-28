#!/usr/bin/env python3
"""Bounded read-only geometry contexts from the exact retained forest V3 artifacts."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
import pathlib

HERE = pathlib.Path(__file__).resolve().parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


base = module("forest_context_base", "inspect-artifact.py")
identity = module("forest_context_identity", "inspect-via-identity-equivalence.py")
metadata_verifier = module("forest_context_metadata", "verify-artifact-metadata.py")
MAIN = "637b6c581128238f6c61227a1c15be423d24baca"
V3 = "fac5f6b05d411648c1460b25ac5a279b680cfa2c"
CONTROLLER = "18b424105b076620ef11f2b7eed9caa79ff81e05"
SOURCES = {
    "srj18": (12792716491, "sha256:e1270a908cbdc783c7533491fda9ab07df8941d2829545483167a2f587ace167"),
    "srj24": (12795901020, "sha256:a62348f8fad63436071633961704f278fb79aeb4be081d43d1200ca1632b3b7f"),
}
GEOMETRY_KEYS = ["route_type", "x", "y", "z", "layer", "layers", "width", "from_layer", "to_layer", "via_diameter", "via_hole_diameter"]
HEADER_KEYS = ["type", "pcb_trace_id", "connection_name", "connectsTo", "source_trace_id", "__replaces_pcb_trace_id", "__rootConnectionNames", "__netConnectionName", "width"]
FILES = ["original-input.json", "raw-new-traces.json", "raw-solver-output.json", "point-pair-context.json", "capture-provenance.json", "supplemental-validation.json", "latest-progress-evidence.json"]
COLLECTION_FILES = {"rawNewTraces": "raw-new-traces.json", "rawSolverOutput": "raw-solver-output.json", "endCapturedPointPairContext": "point-pair-context.json"}


def traces(value):
    return value if isinstance(value, list) else value.get("traces", []) if isinstance(value, dict) else []


def geometry(route):
    return [{key: point[key] for key in GEOMETRY_KEYS if key in point} for point in route]


def point_xy(point):
    return isinstance(point, dict) and all(type(point.get(key)) in [int, float] and math.isfinite(point[key]) for key in ["x", "y"])


def nearest_index(route, center):
    candidates = [(math.hypot(p["x"] - center["x"], p["y"] - center["y"]), n) for n, p in enumerate(route) if point_xy(p)]
    return min(candidates)[1] if candidates else 0


def trace_context(trace, audit, point_index=None, center=None, allow_full=False):
    route = trace.get("route", [])
    if not isinstance(route, list):
        route = []
    full = allow_full and len(route) <= 256
    index = point_index if type(point_index) is int else nearest_index(route, center) if center and point_xy(center) else 0
    lo, hi = (0, len(route)) if full else (max(0, index - 4), min(len(route), index + 5))
    return {"header": {key: trace[key] for key in HEADER_KEYS if key in trace},
        "originalIdentity": audit.normalized_owner(trace.get("connection_name")),
        "routePointCount": len(route), "routeOnlyPayloadHash": base.digest(route),
        "physicalGeometryOnlyHash": base.digest(geometry(route)),
        "allMetadataExceptTraceIdPayloadHash": base.digest(base.trace_payload(trace)),
        "routeSelection": "full_selected_trace_at_most256vertices" if full else "at_most4vertices_each_side_of_selected_or_nearest_vertex",
        "routeStartIndex": lo, "routeEndIndexExclusive": hi, "routeVertices": route[lo:hi],
        "firstRoutePoint": route[0] if route else None, "lastRoutePoint": route[-1] if route else None}


def by_id(collection, trace_id, audit, **kwargs):
    found = [(n, t) for n, t in enumerate(collection) if t.get("pcb_trace_id") == trace_id]
    return {"exactId": trace_id, "matchCount": len(found), "matchesTruncated": len(found) > 3,
        "matches": [{"traceIndex": n, **trace_context(t, audit, **kwargs)} for n, t in found[:3]]}


def filename_status(raw):
    return {name: {"available": (raw / name).is_file(),
        **({"bytes": (raw / name).stat().st_size, "sha256": base.file_digest(raw / name)} if (raw / name).is_file() else {})} for name in FILES}


def load_present(path):
    return base.read(path) if path.is_file() else None


def original_for(records, sample, arm, expected):
    # A successful same-input baseline may supply ORIGINAL INPUT only. Its
    # copper is never substituted for the failed candidate's missing output.
    keys = [(1, sample, arm), (1, sample, "A" if arm == "B" else "B")]
    for key in keys:
        record_path = records.get(key)
        path = record_path.parent / "raw/original-input.json" if record_path else None
        if path and path.is_file() and base.file_digest(path) == expected["inputHashes"][str(sample)]:
            return base.read(path), {"record": list(key), "file": str(path.relative_to(record_path.parent.parent.parent)),
                "sha256": base.file_digest(path), "qualification": "Exact normalized original input only; no cross-arm route substitution"}
    return None, {"unavailable": True, "expectedInputHash": expected["inputHashes"][str(sample)]}


def collections_for(raw):
    return {key: traces(load_present(raw / filename)) for key, filename in COLLECTION_FILES.items()}


def query_collections(raw, query):
    return {key: {"sourceFileAvailable": (raw / COLLECTION_FILES[key]).is_file(), **query(value)} for key, value in collections_for(raw).items()}


def terminal_context(original, port_id):
    if original is None:
        return {"unavailable": True}
    connections = [{"originalConnectionIndex": n, "connection": c} for n, c in enumerate(original.get("connections", []))
        if any(p.get("pcb_port_id") == port_id or p.get("pointId") == port_id for p in c.get("pointsToConnect", []))]
    obstacles = [{"originalObstacleIndex": n, "obstacle": o} for n, o in enumerate(original.get("obstacles", []))
        if port_id in (o.get("connectedTo") or []) or port_id in (o.get("offBoardConnectsTo") or [])
        or port_id in (o.get("circuitJsonMetadata") or {}).values()]
    return {"portId": port_id, "originalConnectionCount": len(connections), "originalConnections": connections[:8],
        "originalObstacleCount": len(obstacles), "originalObstacles": obstacles[:16],
        "truncated": len(connections) > 8 or len(obstacles) > 16}


def intersects_box(a, b, box):
    # AABB selection is a conservative context query, NOT a copper/contact test.
    return point_xy(a) and point_xy(b) and not (max(a["x"], b["x"]) < box["minX"] or min(a["x"], b["x"]) > box["maxX"]
        or max(a["y"], b["y"]) < box["minY"] or min(a["y"], b["y"]) > box["maxY"])


def nearby(collection, audit, box, original=None, context=None):
    found = []
    for n, trace in enumerate(collection):
        route = trace.get("route", [])
        indices = [i for i, point in enumerate(route) if point_xy(point) and box["minX"] <= point["x"] <= box["maxX"] and box["minY"] <= point["y"] <= box["maxY"]]
        indices += [i for i, (a, b) in enumerate(zip(route, route[1:])) if intersects_box(a, b, box)]
        if indices:
            selected = sorted(set(indices))[:32]
            found.append({"traceIndex": n, "matchingPointOrSegmentStartIndexes": sorted(set(indices))[:32],
                "matchingIndexesTruncated": len(set(indices)) > 32,
                "matchingExactSegmentOrPointContexts": [{"startIndex": i, "vertices": route[i:i + 2]} for i in selected],
                "materializedSelectedVias": [{"routePointIndex": i, "rawVia": route[i], "materializedVia": base.materialized_via(original, context or original, route[i])}
                    for i in selected if original is not None and route[i].get("route_type") == "via"],
                **trace_context(trace, audit, point_index=min(indices))})
    return {"selection": "Conservative XY point/segment AABB intersection, all owner labels; no checker rerun or contact verdict",
        "box": box, "matchingTraceCount": len(found), "matchesTruncated": len(found) > 32, "matches": found[:32]}


def reference_context(raw, original, audit):
    supplemental = load_present(raw / "supplemental-validation.json")
    if supplemental is None:
        return {"unavailable": True}
    check = supplemental.get("referenceFullCopperChecks") or {}
    errors = check.get("errors", [])
    collection = collections_for(raw)["rawNewTraces"]
    participants = []
    for error_index, error in enumerate(errors):
        ids = {identifier for key, value in error.items() if key.endswith("_id") or key.endswith("_ids")
            for identifier in (value if isinstance(value, list) else [value]) if isinstance(identifier, str)}
        center = error.get("center") or error.get("pcb_center")
        participants.append({"errorIndex": error_index, "traceContexts": [by_id(collection, trace_id, audit, center=center) for trace_id in sorted(ids) if any(t.get("pcb_trace_id") == trace_id for t in collection)][:3],
            "originalObstacleMatches": [{"originalObstacleIndex": n, "obstacle": o} for n, o in enumerate(original.get("obstacles", []))
                if ids.intersection(v for v in (o.get("circuitJsonMetadata") or {}).values() if isinstance(v, str))][:8]})
    return {"count": check.get("count"), "byType": check.get("byType"), "retainedErrorCount": len(errors),
        "errors": errors, "participants": participants, "qualification": "Every retained reference error, without rerunning a checker; snippets are bounded exact-ID lookups"}


def inspect(directory, expected, source_metadata, selectors):
    dataset = expected.get("dataset")
    if dataset not in SOURCES or expected.get("runId") != 40630414562 or expected.get("candidateSha") != V3 or expected.get("baselineSha") != MAIN or expected.get("controllerSha") != CONTROLLER:
        raise ValueError("Only exact original forest V3 full-population sources are permitted")
    if (expected["artifact"]["id"], expected["artifact"]["digest"]) != SOURCES[dataset]:
        raise ValueError("Wrong retained V3 artifact ID/digest")
    if source_metadata.get("qualification") != "EXACT_ARTIFACT_METADATA_VERIFIED" or source_metadata.get("issues") or metadata_verifier.validate(source_metadata.get("metadata", {}), expected):
        raise ValueError("Source API metadata not exactly verified")
    if selectors.get("artifactRun") != 40630414562 or selectors.get("candidate") != V3 or len(selectors.get("selectors", [])) != 15:
        raise ValueError("All15 reviewed original V3 via occurrence selectors are required")
    verified = base.inspect_artifact(directory, expected, 0)
    if verified["integrityIssues"]:
        raise ValueError("Existing strict full-population/raw-hash verification failed: " + base.canonical(verified["integrityIssues"][:8]))
    provenance_paths = [p for p in directory.rglob("provenance.json") if base.read(p).get("dataset") == dataset and base.read(p).get("experiment", {}).get("pr") == 3198]
    root = provenance_paths[0].parent
    records = {(r["round"], r["sampleNumber"], r["arm"]): p for p in root.rglob("audit-result.json") if (r := base.read(p))}
    out = {"schemaVersion": 1, "source": expected, "sourceArtifactMetadataVerification": source_metadata,
        "inspectorProvenance": {"githubRunId": os.environ.get("GITHUB_RUN_ID"), "githubSha": os.environ.get("GITHUB_SHA"),
            "runtimeSourceHashes": {name: base.file_digest(HERE / name) for name in ["inspect-forest-context.py", "inspect-artifact.py", "inspect-via-identity-equivalence.py", "verify-artifact-metadata.py", "via-finding-selectors.json"]}},
        "retainedHarnessProvenance": verified.get("retainedHarnessProvenance"),
        "fullPopulationAndCaptureQualification": verified["qualification"], "integrityIssues": [], "contexts": [],
        "limits": ["Read-only retained-data query; no solve, converter or checker is run.",
            "End-captured point-pair context is serialized after solve and is NOT an immutable initial snapshot.",
            "Payload hashes preserve metadata; metadata-hash changes do not establish geometry mutation. Physical geometry hashes omit identity fields but preserve segmentation, order, widths, layers and via dimensions.",
            "Exact-ID matches may be duplicated; unmatched or duplicate identifiers remain explicit. Near-XY selection does not confer electrical permission or prove contact.",
            "If a failed candidate has no raw output, no final copper or first destructive phase is reconstructed from a different run or baseline."]}
    cache = {}

    def board(sample, arm="B"):
        key = (sample, arm)
        if key not in cache:
            record_path = records[(1, sample, arm)]
            original, origin = original_for(records, sample, arm, expected)
            raw = record_path.parent / "raw"
            cache[key] = (raw, base.read(record_path), original, origin, identity.IdentityAudit(original) if original is not None else None)
        return cache[key]

    if dataset == "srj24":
        raw, record, original, origin, audit = board(8)
        collection = collections_for(raw)
        point_context = load_present(raw / "point-pair-context.json")
        terminal = terminal_context(original, "pcb_port_578")
        out["contexts"].append({"kind": "lost_terminal24_8", "sample": 8, "arm": "B", "official": record.get("official"),
            "lastObservedCallbackEvidence": record.get("lastObservedEvidence"),
            "availableFiles": filename_status(raw), "originalInputSource": origin, "originalTerminalAndObstacleContext": terminal,
            "endCapturedPointPairTerminalContext": terminal_context(point_context, "pcb_port_578"),
            "routeContexts": query_collections(raw, lambda value: nearby(value, audit, {"minX": 39.4, "maxX": 40.6, "minY": 8.22, "maxY": 9.42})) if audit else {},
            "qualification": "Candidate filename inventory is authoritative. Baseline may supply only the identical original input; missing candidate output means final route/first bad phase are unavailable."})
        for sample in [15, 20, 21]:
            for arm in ["A", "B"]:
                raw, _, original, origin, audit = board(sample, arm)
                out["contexts"].append({"kind": "all_reference_errors", "sample": sample, "arm": arm, "originalInputSource": origin,
                    "availableFiles": filename_status(raw), "reference": reference_context(raw, original, audit) if audit else {"unavailable": True}})
        raw, _, original, origin, audit = board(15)
        out["contexts"].append({"kind": "forest49_final_geometry", "sample": 15, "arm": "B", "originalInputSource": origin,
            "collections": query_collections(raw, lambda value: by_id(value, "pipeline9_forest_49", audit, center={"x": -14.78, "y": -13.075}, allow_full=True)),
            "originalPad104ExactMetadataMatches": [{"originalObstacleIndex": n, "obstacle": o} for n, o in enumerate(original.get("obstacles", []))
                if "pcb_smtpad_104" in (o.get("circuitJsonMetadata") or {}).values()],
            "qualification": "Compare exact route vertices/geometry hash with independently retained initial prefix; all-metadata payload hashes alone cannot prove route mutation."})
        raw, _, original, origin, audit = board(25)
        end_context = load_present(raw / "point-pair-context.json")
        for name, box, pair in [("native_cmn57_final_context", {"minX": 44, "maxX": 45.1, "minY": 51.9, "maxY": 53}, [13, 14]),
                ("native_cmn42_final_context", {"minX": 46.19, "maxX": 47.39, "minY": 50.535, "maxY": 51.735}, [13, 16])]:
            out["contexts"].append({"kind": name, "sample": 25, "arm": "B", "originalInputSource": origin,
                "originalOwnerRelation": audit.relation(*[f"source_net_altium_pcb_{n}" for n in pair]),
                "capturedPhysicalDefaults": {"layerCount": original.get("layerCount"), "allowBlindAndBuriedVias": original.get("allowBlindAndBuriedVias"),
                    "viaOuterAndHoleDefaults": base.via_defaults(original, end_context or original), "minTraceWidth": original.get("minTraceWidth"), "defaultObstacleMargin": original.get("defaultObstacleMargin")},
                "collections": query_collections(raw, lambda value: nearby(value, audit, box, original, end_context)),
                "originalPad338ExactMetadataMatches": [{"originalObstacleIndex": n, "obstacle": o} for n, o in enumerate(original.get("obstacles", []))
                    if "pcb_smtpad_338" in (o.get("circuitJsonMetadata") or {}).values()] if pair == [13, 16] else [],
                "qualification": "Local captured-node replay is separate evidence. These snippets only expose final retained geometry; no whole-board conflict or repair verdict is inferred from proximity."})
    for selector in selectors.get("selectors", []):
        if selector["dataset"] != dataset:
            continue
        sample, arm = selector["sample"], selector["arm"]
        raw, _, original, origin, audit = board(sample, arm)
        context = load_present(raw / "point-pair-context.json")
        collections = collections_for(raw)
        combined = base.combined_traces(original, collections["rawNewTraces"])
        first = selector["firstOccurrence"]
        trace = combined[first["traceIndex"]]
        route = trace.get("route", [])
        if trace.get("pcb_trace_id") != first["pcb_trace_id"] or base.digest(base.trace_payload(trace)) != first["traceGeometryHash"]:
            raise ValueError("Exact prior via selector trace/payload no longer matches")
        via = route[first["routePointIndex"]]
        materialized = base.materialized_via(original, context or original, via)
        if via.get("route_type") != "via" or any(materialized.get(k) != selector["materializedVia"].get(k) for k in materialized):
            raise ValueError("Exact prior via selector geometry no longer matches")
        out["contexts"].append({"kind": "via_pad_occurrence_context", "sample": sample, "arm": arm, "selector": selector,
            "originalInputSource": origin, "combinedTraceContext": trace_context(trace, audit, point_index=first["routePointIndex"]),
            "collections": query_collections(raw, lambda value: by_id(value, first["pcb_trace_id"], audit, center=via)),
            "originalObstacles": [{"originalObstacleIndex": n, "obstacle": original["obstacles"][n],
                "originalExplicitRelation": audit.obstacle_relation(trace.get("connection_name"), n)} for n in selector["originalObstacleIndexes"]],
            "materializedVia": materialized,
            "qualification": "Exact emitted occurrence selector, not an independent hazard count. Original typed identity proof is kept separate from coordinates and solver-created aliases."})
    return out


def main():
    parser = argparse.ArgumentParser()
    for name in ["directory", "expected", "source-metadata", "selectors", "output"]:
        parser.add_argument("--" + name, type=pathlib.Path, required=True)
    args = parser.parse_args()
    result = inspect(args.directory, base.read(args.expected), base.read(args.source_metadata), base.read(args.selectors))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print("FOREST_CONTEXT_SUMMARY_JSON " + base.canonical({"dataset": result["source"]["dataset"], "sourceArtifact": result["source"]["artifact"],
        "candidateSha": V3, "qualification": result["fullPopulationAndCaptureQualification"], "contextCount": len(result["contexts"]),
        "inspectorProvenance": result["inspectorProvenance"], "reportSha256": base.file_digest(args.output)}))
    for index, context in enumerate(result["contexts"]):
        # Keep log records small. The full bounded report remains an artifact;
        # selected trace vertices are streamed in chunks instead of one long
        # line that GitHub might truncate.
        header = {k: v for k, v in context.items() if k not in ["collections", "combinedTraceContext", "routeContexts", "reference"]}
        print("FOREST_CONTEXT_RECORD_JSON " + base.canonical({"contextIndex": index, **header}))
        if "reference" in context:
            reference = context["reference"]
            print("FOREST_CONTEXT_REFERENCE_JSON " + base.canonical({"contextIndex": index, **{k: v for k, v in reference.items() if k not in ["errors", "participants"]}}))
            for n, error in enumerate(reference.get("errors", [])):
                participant = reference.get("participants", [])[n]
                print("FOREST_CONTEXT_REFERENCE_ERROR_JSON " + base.canonical({"contextIndex": index, "errorIndex": n, "error": error, "participants": participant}))
        for group in ["collections", "routeContexts"]:
            for collection_name, collection in context.get(group, {}).items():
                print("FOREST_CONTEXT_COLLECTION_JSON " + base.canonical({"contextIndex": index, "collection": collection_name, **{k: v for k, v in collection.items() if k != "matches"}}))
                for match in collection.get("matches", []):
                    vertices = match.get("routeVertices", [])
                    print("FOREST_CONTEXT_TRACE_JSON " + base.canonical({"contextIndex": index, "collection": collection_name, **{k: v for k, v in match.items() if k != "routeVertices"}}))
                    for lo in range(0, len(vertices), 64):
                        print("FOREST_CONTEXT_VERTICES_JSON " + base.canonical({"contextIndex": index, "collection": collection_name, "traceIndex": match.get("traceIndex"), "selectedVertexOffset": lo, "vertices": vertices[lo:lo + 64]}))
        if "combinedTraceContext" in context:
            print("FOREST_CONTEXT_COMBINED_TRACE_JSON " + base.canonical({"contextIndex": index, **context["combinedTraceContext"]}))


if __name__ == "__main__":
    main()
