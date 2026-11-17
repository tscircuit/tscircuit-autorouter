"""Offline evidence for completed phase SRJ routes and emitted trace geometry.

This does not recreate Core's via inflation/deduplication or claim via coverage.
All geometric route fields survive comparison; only known metadata is removed.
"""
import copy
import gzip
import hashlib
import json
import math
from pathlib import Path


def _read(path):
    data = path.read_bytes()
    if path.suffix == ".gz":
        data = gzip.decompress(data)
    return json.loads(data)


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _reverse_route(route, thickness_mode):
    """Replay Core reversePcbTraceRoute, including constant segment widths."""
    reversed_route = copy.deepcopy(route[::-1])
    for point in reversed_route:
        if point["route_type"] == "wire":
            for key in ["start_width", "end_width", "width_interpolation_mode"]:
                point.pop(key, None)
        elif point["route_type"] == "through_pad":
            point["start"], point["end"] = point["end"], point["start"]
            point["start_layer"], point["end_layer"] = point["end_layer"], point["start_layer"]
    if thickness_mode == "constant":
        for index in range(len(reversed_route) - 1):
            first, second = reversed_route[index:index + 2]
            original_start = route[len(route) - index - 2]
            if first["route_type"] == second["route_type"] == original_start["route_type"] == "wire" and first["layer"] == second["layer"]:
                first["width"] = original_start["width"]
        for index, point in enumerate(reversed_route):
            if point["route_type"] != "wire":
                continue
            if index + 1 < len(route) and reversed_route[index + 1]["route_type"] == "wire" and reversed_route[index + 1]["layer"] == point["layer"]:
                continue
            original_end = len(route) - index - 1
            while original_end + 1 < len(route) and route[original_end]["route_type"] == route[original_end + 1]["route_type"] == "wire" and route[original_end]["layer"] == route[original_end + 1]["layer"]:
                original_end += 1
            point["width"] = route[original_end]["width"]
    for index in range(len(route) - 1):
        first, second = route[index:index + 2]
        if first["route_type"] == second["route_type"] == "wire" and first.get("width_interpolation_mode") and first["layer"] == second["layer"]:
            reversed_route[len(route) - index - 2].update(width=first["end_width"], start_width=first["end_width"], end_width=first["start_width"], width_interpolation_mode=first["width_interpolation_mode"])
    return reversed_route


def _normalized_route(trace, ports, pours, *, srj):
    route = []
    for index, raw in enumerate(trace["route"]):
        point = copy.deepcopy(raw)
        point.pop("circuitJsonMetadata", None)
        if point["route_type"] == "through_obstacle":
            if not srj:
                raise ValueError("Emitted Circuit JSON retained through_obstacle")
            point = {"route_type": "through_pad", "start": point["start"], "end": point["end"], "start_layer": point["from_layer"], "end_layer": point["to_layer"], "width": point["width"]}
        if point["route_type"] == "via":
            if srj:
                point.pop("layers", None)
            elif "layers" in point:
                raise ValueError("Emitted route retained SRJ-only physical layers metadata")
        if point["route_type"] not in ["wire", "via", "through_pad"]:
            raise ValueError(f"Unsupported route type {point['route_type']}")
        for key, expected_index in [("start_pcb_port_id", 0), ("end_pcb_port_id", len(trace["route"]) - 1)]:
            if key not in point:
                continue
            port = ports.get(point[key])
            if port is None or point["route_type"] != "wire" or index != expected_index or point["layer"] not in port["layers"]:
                raise ValueError(f"Unverified endpoint annotation {key}")
            if math.hypot(point["x"] - port["x"], point["y"] - port["y"]) > 1e-6:
                raise ValueError(f"Endpoint annotation {key} moved from its authored port")
            point.pop(key)
        if "is_inside_copper_pour" in point or "copper_pour_id" in point:
            pour = pours.get(point.get("copper_pour_id"))
            if point.get("is_inside_copper_pour") is not True or pour is None or point["route_type"] != "wire" or pour["layer"] != point["layer"]:
                raise ValueError("Unverified derived pour-membership annotation")
            point.pop("is_inside_copper_pour")
            point.pop("copper_pour_id")
        route.append(point)
    return route


def normalize_emitted_trace_route(trace, circuit):
    """Preserve all geometry, normalize only checked derived route annotations.

    Endpoints must resolve to an authored port at the same point and layer.
    Pour annotations must be a true/id pair referencing a real same-layer pour;
    this checks reference validity, not polygon containment or annotation truth.
    Unknown fields and all through-pad geometry remain in the returned route.
    """
    ports = {row["pcb_port_id"]: row for row in circuit if row["type"] == "pcb_port"}
    pours = {row["pcb_copper_pour_id"]: row for row in circuit if row["type"] == "pcb_copper_pour"}
    return _normalized_route(trace, ports, pours, srj=False)


def analyze_materialization(directory, *, authored_pours):
    """Return evidence, never interpret pending originals as materialized copper.

    directory contains circuit.json.gz, progress.json and phase output SRJs.
    Source-port-driven orientation is replayed only when the emitted source
    trace identifies its first authored source port. Missing proof is reported.
    """
    directory = Path(directory)
    circuit = _read(directory / "circuit.json.gz")
    progress = _read(directory / "progress.json")
    ports = {row["pcb_port_id"]: row for row in circuit if row["type"] == "pcb_port"}
    pours = {row["pcb_copper_pour_id"]: row for row in circuit if row["type"] == "pcb_copper_pour"}
    source_traces = {row["source_trace_id"]: row for row in circuit if row["type"] == "source_trace"}
    source_port_to_pcb = {}
    for port in ports.values():
        source_port_to_pcb.setdefault(port.get("source_port_id"), []).append(port)
    emitted = {row["pcb_trace_id"]: row for row in circuit if row["type"] == "pcb_trace"}
    emitted_count = sum(row["type"] == "pcb_trace" for row in circuit)
    if emitted_count != len(emitted):
        raise ValueError("Duplicate emitted PCB trace IDs")
    accepted = {}
    phase_outputs = []
    completed_files = set()
    for phase in progress["phases"]:
        if phase["status"] != "completed":
            continue
        filename = f"phase-{phase['index']}-output.srj.json.gz"
        completed_files.add(filename)
        payload = _read(directory / filename)
        traces = payload["traces"]
        phase_outputs.append({"phase": phase["name"], "index": phase["index"], "file": filename, "payloadSha256": _digest(payload), "traceCount": len(traces), "viaRoutePointCount": sum(point["route_type"] == "via" for trace in traces for point in trace["route"])})
        if len({trace["pcb_trace_id"] for trace in traces}) != len(traces):
            raise ValueError(f"Duplicate output trace IDs in {filename}")
        replacements = {trace["pcb_trace_id"] for trace in traces} | {trace["__replaces_pcb_trace_id"] for trace in traces if trace.get("__replaces_pcb_trace_id")}
        accepted = {key: trace for key, trace in accepted.items() if key not in replacements}
        accepted.update({trace["pcb_trace_id"]: trace for trace in traces})
    output_files = {path.name for path in directory.glob("phase-*-output.srj.json.gz")}
    if output_files != completed_files:
        raise ValueError("Completed phase statuses and output file inventory disagree")
    route_evidence = []
    for trace_id, trace in sorted(accepted.items()):
        actual = emitted.get(trace_id)
        evidence = {"pcbTraceId": trace_id, "connectionName": trace.get("connection_name"), "acceptedTraceSha256": _digest(trace), "materialized": False, "sourceDrivenReversal": False}
        if actual is None:
            evidence["reason"] = "accepted_trace_not_emitted"
            route_evidence.append(evidence)
            continue
        try:
            expected_route = _normalized_route(trace, ports, pours, srj=True)
            actual_route = _normalized_route(actual, ports, pours, srj=False)
            source_id = actual.get("source_trace_id")
            source_trace = source_traces.get(source_id)
            source_ports = source_trace.get("connected_source_port_ids", []) if source_trace else []
            candidates = source_port_to_pcb.get(source_ports[0], []) if source_ports else []
            if len(candidates) > 1:
                raise ValueError("Ambiguous authored PCB source port for orientation")
            if candidates and len(expected_route) >= 2:
                port = candidates[0]
                first = expected_route[0].get("start", expected_route[0])
                last = expected_route[-1].get("start", expected_route[-1])
                if math.hypot(last["x"] - port["x"], last["y"] - port["y"]) < math.hypot(first["x"] - port["x"], first["y"] - port["y"]):
                    expected_route = _reverse_route(expected_route, trace.get("route_thickness_mode", "constant"))
                    evidence["sourceDrivenReversal"] = True
            evidence.update(expectedRouteSha256=_digest(expected_route), emittedRouteSha256=_digest(actual_route), sourceTraceId=source_id)
            evidence["materialized"] = expected_route == actual_route and trace.get("connection_name") == actual.get("connection_name") and trace.get("curvedSegments") == actual.get("curvedSegments") and trace.get("route_thickness_mode") == actual.get("route_thickness_mode") and ("source_trace_id" not in trace or trace["source_trace_id"] == source_id)
            if not evidence["materialized"]:
                evidence["reason"] = "normalized_route_or_owner_mismatch"
        except (ValueError, KeyError) as error:
            evidence["reason"] = str(error)
        route_evidence.append(evidence)
    missing = [row["pcbTraceId"] for row in route_evidence if row.get("reason") == "accepted_trace_not_emitted"]
    mismatched = [row["pcbTraceId"] for row in route_evidence if not row["materialized"] and row["pcbTraceId"] not in missing]
    unexpected = sorted(set(emitted) - set(accepted))
    annotation_fields = ["start_pcb_port_id", "end_pcb_port_id", "is_inside_copper_pour", "copper_pour_id", "circuitJsonMetadata"]
    emitted_annotations = [{"pcbTraceId": trace_id, "pointIndex": index, "values": {key: point[key] for key in annotation_fields if key in point}} for trace_id, trace in sorted(emitted.items()) for index, point in enumerate(trace["route"]) if any(key in point for key in annotation_fields)]
    return {
        "phaseOutputs": phase_outputs,
        "acceptedTraceCount": len(accepted),
        "acceptedTraceObjectsSha256": _digest([accepted[key] for key in sorted(accepted)]),
        "acceptedViaRoutePointCount": sum(point["route_type"] == "via" for trace in accepted.values() for point in trace["route"]),
        "emittedTraceCount": emitted_count,
        "emittedViaCount": sum(row["type"] == "pcb_via" for row in circuit),
        "matchedAcceptedTraceCount": sum(row["materialized"] for row in route_evidence),
        "missingAcceptedTraceCount": len(missing),
        "missingAcceptedTraceIds": missing,
        "mismatchedAcceptedTraceIds": mismatched,
        "unexpectedEmittedTraceIds": unexpected,
        "allAcceptedTraceRoutesMaterialized": bool(accepted) and not missing and not mismatched and not unexpected,
        "materializationVacuous": not accepted,
        "exactViaMaterializationVerified": False,
        "viaScope": "Counts only. Via inflation, physical layer span and same-net deduplication are not reconstructed here; compare complete emitted via records separately.",
        "emittedRouteAnnotations": {"fieldCounts": {key: sum(key in row["values"] for row in emitted_annotations) for key in annotation_fields}, "sha256": _digest(emitted_annotations), "rows": emitted_annotations, "identityClaimed": False, "pourMembershipIndependentlyVerified": False},
        "traceScope": "Full route geometry, curvedSegments, thickness mode and routing owner; Core through-pad conversion and source-port-driven reversal replayed. Only circuitJsonMetadata, SRJ via.layers, coordinate/layer-verified endpoint annotations and reference/layer-verified derived pour-membership annotations normalized. Annotation identity and polygon-membership truth are separate claims; annotation evidence is retained.",
        "phasePublicationPolicy": {
            "coreBaseCommit": "f8f2ed3273cea45e70e78ddc7470ba9fc47a1e73",
            "sourcePath": "lib/components/primitive-components/Group/Group.ts",
            "sourceSha256": "9ddb264132ddc6642a655ea2d42c5a631ba5c5805224f34a33718944b905e560",
            "authoredPoursBlockIntermediatePublication": authored_pours,
            "intermediatePublicationEligibility": "blocked_by_authored_pours" if authored_pours else "not_blocked_by_pours_other_core_guards_still_apply",
            "renderCompleted": progress["renderCompleted"],
            "acceptedRoutesPendingFinalResult": bool(accepted) and authored_pours and not progress["renderCompleted"] and bool(missing),
            "evidence": "Group.ts acceptedTracePhase excludes CopperPour descendants, existing pours, assignable vias, generated jumpers/test points, and jumper routes. Original plane_escape outputs are real routes, but authored-pour boards await final-result publication.",
        },
        "routes": route_evidence,
    }
