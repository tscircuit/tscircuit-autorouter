#!/usr/bin/env python3
"""Independent ordered-copper/terminal proof for the original sample24 MST.

This deliberately does not infer a physical connection from shared net labels.
Each expected terminal pair needs a continuous exported route and real contact
on both identity-matched original pads. Clearance remains a separate audit.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os

HERE = os.path.dirname(__file__)
SPEC = importlib.util.spec_from_file_location("through_geometry", os.path.join(HERE, "check-through-obstacle-physical-clearance.py"))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
G = P.G
ORIGINAL_SHA = "ba157c96251e5c53964a7fb529981fc19347865c82379558bf820fcdef6b52a7"


def sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def board_via_dimensions(metadata):
    # Mirror getViaDimensions.ts, whose source is included in the roster hash.
    def first_finite(*values):
        return next((value for value in values if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)), None)
    hole = first_finite(metadata.get("min_via_hole_diameter"), metadata.get("minViaHoleDiameter"))
    pad = first_finite(metadata.get("min_via_pad_diameter"), metadata.get("minViaPadDiameter"), metadata.get("minViaDiameter"))
    pad = max(.3 if pad is None else pad, 0 if hole is None else hole)
    hole = pad * .5 if hole is None else hole
    return G.number_from(pad), G.number_from(hole)


def prove_trace(trace, pair, raw_by_port, count, min_width, trace_index, marker_proofs, via_defaults=(.3, .15)):
    if trace.get("connection_name") != pair["owner"]:
        raise ValueError("Trace ownership differs from its original declared net")
    points = trace.get("route", [])
    if len(points) < 2 or points[0].get("route_type") != "wire" or points[-1].get("route_type") != "wire":
        raise ValueError("Expected a nonempty ordered route with wire endpoints")
    P.validate_peer_format(trace, {"layerCount": count, "allowBlindAndBuriedVias": False})
    widths, via_count, marker_count, defaulted_pad_count, defaulted_hole_count = [], 0, 0, 0, 0
    for index, point in enumerate(points):
        kind = point.get("route_type")
        if kind == "wire":
            width = G.number_from(point.get("width"))
            if width < min_width - 1e-9:
                raise ValueError("Exported wire is narrower than the original board minimum")
            widths.append(width)
        elif kind == "via":
            # Local geometry overrides the governing SRJ defaults. Hole size
            # resolves independently, not as half a locally overridden pad.
            pad = G.number_from(point.get("via_diameter"), via_defaults[0])
            hole = G.number_from(point.get("via_hole_diameter"), via_defaults[1])
            defaulted_pad_count += point.get("via_diameter") is None
            defaulted_hole_count += point.get("via_hole_diameter") is None
            if abs(pad - 0.3) > 1e-12 or abs(hole - 0.15) > 1e-12:
                raise ValueError("Manufactured via dimensions differ from .3/.15")
            if G.z_index(point["from_layer"], count) == G.z_index(point["to_layer"], count):
                raise ValueError("Exported via does not represent a layer transition")
            via_count += 1
        elif kind == "through_obstacle":
            proof = marker_proofs.get((trace_index, index))
            if not proof:
                raise ValueError("Existing-barrel transition lacks a hash-matched independent projection proof")
            marker_count += 1
        else:
            raise ValueError("Unsupported final route primitive")
    # Exact connector coincidences give a conservative continuity proof. The
    # generic checker allows 1e-6mm; this proof accepts <=1e-9mm round-off.
    # A larger mismatch is an unproved format, not by itself a physical open.
    def connector_anchors(point):
        if point["route_type"] == "through_obstacle":
            return [point["start"], point["end"]]
        return [point]
    for a, b in zip(points, points[1:]):
        if a["route_type"] == b["route_type"] == "wire":
            continue
        distance = min(math.hypot(u["x"] - v["x"], u["y"] - v["y"]) for u in connector_anchors(a) for v in connector_anchors(b))
        if distance > 1e-9:
            raise ValueError("Connector adjacency exceeds 1e-9mm; no conservative continuity proof")
    if not any(math.hypot(a["x"] - b["x"], a["y"] - b["y"]) > 1e-12 for a, b in zip(points, points[1:]) if a["route_type"] == b["route_type"] == "wire"):
        raise ValueError("Route has no nonzero exported wire segment")

    def contact(point, terminal):
        port = terminal["pcb_port_id"]
        raw = raw_by_port[port]
        z = G.z_index(point["layer"], count)
        original_z = G.z_index(terminal["layer"], count)
        if pair["owner"] not in raw["nets"] or raw["unowned"] or raw["keepout"]:
            return None
        if z not in raw["layers"] or original_z not in raw["layers"]:
            return None
        plated = raw["metadata"].get("pcb_plated_hole_id")
        if z != original_z and (not plated or not set(range(min(z, original_z), max(z, original_z) + 1)) <= raw["layers"]):
            return None
        gap = G.obstacle_distance(point["x"], point["y"], raw)
        if gap >= point["width"] / 2 - 1e-9:
            return None
        return {"pcbPortId": port, "rawObstacleIndex": raw["index"], "rawPlatedHoleId": plated,
                "arrivalZ": z, "originalZ": original_z, "rawLayers": sorted(raw["layers"]),
                "distanceToOwnRawCopper": gap,
                "endpointXYDelta": math.hypot(point["x"] - terminal["x"], point["y"] - terminal["y"])}

    choices = []
    for terminals in [pair["points"], list(reversed(pair["points"]))]:
        contacts = [contact(points[0], terminals[0]), contact(points[-1], terminals[1])]
        if all(contacts):
            choices.append(contacts)
    if not choices:
        raise ValueError("Final endpoints do not contact both identity-matched original terminal pads")
    return {"traceIndex": trace_index, "pcbTraceId": trace["pcb_trace_id"], "mstConnectionName": pair["name"],
            "owner": pair["owner"], "contacts": choices[0], "wireWidthMin": min(widths),
            "manufacturedViaCount": via_count, "existingBarrelMarkerCount": marker_count,
            "localViaPadSizeResolvedFromGoverningDefaultCount": defaulted_pad_count,
            "localViaHoleSizeResolvedFromGoverningDefaultCount": defaulted_hole_count,
            "orderedCopperContinuous": True, "bothOriginalTerminalPadsContacted": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="/workspace/sample24-audit-original.srj.json")
    parser.add_argument("--routes", required=True)
    parser.add_argument("--roster", required=True)
    parser.add_argument("--through-report")
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    input_sha, final_sha = sha(args.input), sha(args.routes)
    if input_sha != ORIGINAL_SHA:
        raise ValueError("Original sample24 hash mismatch")
    original = json.load(open(args.input))
    roster = json.load(open(args.roster))
    if roster.get("inputSha256") != input_sha or len(roster.get("pairs", [])) != 1934:
        raise ValueError("Missing hash-bound original 1934-pair roster")
    if original.get("traces") or original.get("jumpers") or original["layerCount"] != 8 or original.get("allowBlindAndBuriedVias") is not False:
        raise ValueError("Unexpected original physical policy")
    final_metadata = dict(G.JsonStream(args.routes).records(set()))
    original_via_defaults = board_via_dimensions(original)
    via_defaults = board_via_dimensions({**original, **final_metadata})
    if original_via_defaults != (.3, .15) or via_defaults != (.3, .15):
        raise ValueError("Governing via defaults differ from the authoritative original .3/.15")
    terminals = {point["pcb_port_id"]: (connection["name"], point) for connection in original["connections"] for point in connection["pointsToConnect"]}
    if len(terminals) != 2343:
        raise ValueError("Original terminal roster mismatch")
    raw_by_port = {}
    for index, raw in enumerate(original["obstacles"]):
        port = (raw.get("circuitJsonMetadata") or {}).get("pcb_port_id")
        if port in terminals:
            if port in raw_by_port:
                raise ValueError("Original terminal has ambiguous multiple raw pads")
            raw_by_port[port] = G.compile_obstacle(raw, index, 8)
    if set(raw_by_port) != set(terminals):
        raise ValueError("Original terminal missing its identity-matched raw pad")
    expected = {}
    for pair in roster["pairs"]:
        ids = frozenset(point["pcb_port_id"] for point in pair["points"])
        if len(ids) != 2 or ids in expected or any(terminals[port][0] != pair["owner"] for port in ids):
            raise ValueError("Invalid original pair roster")
        for point in pair["points"]:
            original_point = terminals[point["pcb_port_id"]][1]
            if any(point[field] != original_point[field] for field in ["x", "y", "layer", "pcb_port_id"]):
                raise ValueError("MST roster changed an original terminal coordinate, layer or identity")
        expected[ids] = pair
    marker_proofs = {}
    if args.through_report:
        report = json.load(open(args.through_report))
        if report.get("inputSha256") != input_sha or report.get("routesSha256") != final_sha or report.get("scope") != "FINAL_TARGETED_THROUGH_OBSTACLE_CLEARANCE":
            raise ValueError("Through-marker proof provenance mismatch")
        for proof in report["existingBarrelProofs"]:
            key = (proof["traceIndex"], proof["markerIndex"])
            if key in marker_proofs:
                raise ValueError("Duplicate barrel proof")
            marker_proofs[key] = proof
    errors, proofs, seen_pairs, seen_ids = [], [], set(), set()
    for key, trace in G.JsonStream(args.routes).records({"traces"}):
        if key != "traces":
            continue
        index = len(proofs) + len(errors)
        try:
            identity = trace.get("pcb_trace_id")
            if not isinstance(identity, str) or not identity or identity in seen_ids:
                raise ValueError("Missing or duplicate output trace identity")
            seen_ids.add(identity)
            declared_ids = trace.get("connectsTo")
            if not isinstance(declared_ids, list) or len(declared_ids) != 2 or any(port not in terminals for port in declared_ids):
                raise ValueError("Trace lost its two original PCB terminal IDs")
            pair_key = frozenset(declared_ids)
            if pair_key not in expected or pair_key in seen_pairs:
                raise ValueError("Unexpected or duplicate original MST obligation")
            seen_pairs.add(pair_key)
            proofs.append(prove_trace(trace, expected[pair_key], raw_by_port, 8, original["minTraceWidth"], index, marker_proofs, via_defaults))
        except (ValueError, KeyError, TypeError) as error:
            errors.append({"traceIndex": index, "pcbTraceId": trace.get("pcb_trace_id"), "error": str(error)})
    missing = [pair["name"] for pair_key, pair in expected.items() if pair_key not in seen_pairs]
    covered = {contact["pcbPortId"] for proof in proofs for contact in proof["contacts"]}
    # The expected MST, not desired net aliases, supplies this final graph proof.
    parent = {port: port for port in terminals}
    def find(port):
        while parent[port] != port:
            parent[port] = parent[parent[port]]
            port = parent[port]
        return port
    for proof in proofs:
        a, b = [contact["pcbPortId"] for contact in proof["contacts"]]
        parent[find(a)] = find(b)
    disconnected = []
    for connection in original["connections"]:
        components = {find(point["pcb_port_id"]) for point in connection["pointsToConnect"]}
        if len(components) != 1:
            disconnected.append({"owner": connection["name"], "componentCount": len(components)})
    contacts = [contact for proof in proofs for contact in proof["contacts"]]
    result = {"scope": "FINAL_ORIGINAL_MST_ORDERED_COPPER_AND_RAW_TERMINAL_CONTACT_PROOF",
              "inputPath": os.path.abspath(args.input), "inputSha256": input_sha,
              "routesPath": os.path.abspath(args.routes), "routesSha256": final_sha,
              "rosterPath": os.path.abspath(args.roster), "rosterSha256": sha(args.roster),
              "throughReportSha256": sha(args.through_report) if args.through_report else None,
              "expectedPairCount": 1934, "provedPairCount": len(proofs), "expectedTerminalCount": 2343,
              "physicallyContactedTerminalCount": len(covered), "expectedNetCount": 409,
              "provedConnectedNetCount": 409 - len(disconnected),
              "allManufacturedViaPhysicalLayers": list(range(8)), "viaPhysicalSpanBasis": "immutable original allowBlindAndBuriedVias=false; from/to are route arrival layers",
              "governingViaPadDiameter": via_defaults[0], "governingViaHoleDiameter": via_defaults[1],
              "viaDefaultResolutionBasis": "getViaDimensions.ts snake/camel explicit fields, legacy pad field, otherwise .3 pad and half-pad hole; optional local sizes override independently",
              "localViaPadSizeResolvedFromGoverningDefaultCount": sum(proof["localViaPadSizeResolvedFromGoverningDefaultCount"] for proof in proofs),
              "localViaHoleSizeResolvedFromGoverningDefaultCount": sum(proof["localViaHoleSizeResolvedFromGoverningDefaultCount"] for proof in proofs),
              "manufacturedViaOccurrences": sum(proof["manufacturedViaCount"] for proof in proofs),
              "existingBarrelMarkerCount": sum(proof["existingBarrelMarkerCount"] for proof in proofs),
              "maximumTerminalEndpointXYDelta": max((contact["endpointXYDelta"] for contact in contacts), default=None),
              "terminalEndpointContactsBeyond1eMinus9Mm": [contact for contact in contacts if contact["endpointXYDelta"] > 1e-9],
              "errorCount": len(errors) + len(missing) + len(disconnected), "errors": errors, "missingMstConnections": missing,
              "netsWithoutCompletePairProof": disconnected, "proofs": proofs,
              "qualification": "Conservative sufficient proof for one continuous exported trace per original MST pair. Unsupported split, merged or star formats require a general conductive-union audit and are not evidence of a physical open solely from names/counts. Physical connections come from ordered copper, explicit vias and independently proved existing barrels plus identity-matched raw pad contact. Shared net names or connectsTo metadata alone never establish connectivity. Endpoint XY deltas are reported separately; a shifted endpoint can still contact the same original pad. This does not certify peer/raw/board clearances, capture completion, absence of foreign shorts, or native routing success."}
    with open(args.report, "x") as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps({key: value for key, value in result.items() if key not in ["proofs", "errors", "terminalEndpointContactsBeyond1eMinus9Mm"]}))
    return 1 if result["errorCount"] or len(covered) != 2343 else 0


if __name__ == "__main__":
    raise SystemExit(main())
