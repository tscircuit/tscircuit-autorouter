#!/usr/bin/env python3
"""Audit emitted PCB via annuli against foreign-net straight BRep pours.

Coordinates are board-world millimetres: +X right, +Y up; layers are physical
copper layers. BRep inputs must be valid simple outer rings with disjoint holes.
No routing, geometry approximation, snapping, or polygon reconstruction occurs.
"""
import argparse
import collections
import gzip
import hashlib
import json
import math
from pathlib import Path

EPSILON_MM = 1e-9  # Classify uncertain near contacts conservatively, never waive them.


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def read_json(path):
    raw = Path(path).read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw), digest(raw)


def finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"Invalid finite number: {label}")
    return 0.0 if value == 0 else value


def ring_points(ring):
    if set(ring) != {"vertices"}:
        raise ValueError("Only straight BRep rings containing vertices are supported")
    points = []
    for vertex in ring["vertices"]:
        if set(vertex) != {"x", "y"}:
            raise ValueError("Only straight XY BRep vertices are supported")
        points.append((finite(vertex["x"], "ring.x"), finite(vertex["y"], "ring.y")))
    if len(points) > 1 and points[0] == points[-1]:
        points.pop()
    if len(set(points)) < 3:
        raise ValueError("Degenerate BRep ring")
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in edges(points)) / 2
    if area == 0:
        raise ValueError("Zero-area BRep ring")
    return points


def edges(points):
    return zip(points, points[1:] + points[:1])


def point_in_ring(point, points):
    inside = False
    x, y = point
    for a, b in edges(points):
        if (a[1] > y) != (b[1] > y):
            crossing_x = a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])
            if x < crossing_x:
                inside = not inside
    return inside


def point_in_copper(point, rings):
    return point_in_ring(point, rings[0]) and not any(point_in_ring(point, ring) for ring in rings[1:])


def segment_radial_range(point, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    denominator = dx * dx + dy * dy
    fraction = max(0.0, min(1.0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / denominator)) if denominator else 0.0
    minimum = math.hypot(point[0] - (a[0] + fraction * dx), point[1] - (a[1] + fraction * dy))
    maximum = max(math.dist(point, a), math.dist(point, b))
    return minimum, maximum


def annulus_to_region(point, inner_radius, outer_radius, rings):
    """Exact segment/radial interval intersection for a valid polygon and annulus.

    minimumCopperGapMm is the nonnegative Euclidean set distance; zero means
    contact. No negative value is presented as an exact penetration depth.
    Near-contact classifications retain the positive raw gap for inspection.
    """
    raw_gap = math.inf
    minimum_boundary_distance = math.inf
    boundary_area = False
    boundary_touch = False
    for ring in rings:
        for a, b in edges(ring):
            low, high = segment_radial_range(point, a, b)
            minimum_boundary_distance = min(minimum_boundary_distance, low)
            if low < outer_radius and high > inner_radius:
                boundary_area = True
            elif low <= outer_radius and high >= inner_radius:
                boundary_touch = True
            raw_gap = min(raw_gap, max(low - outer_radius, inner_radius - high, 0.0))
    annulus_sample = (point[0] + (inner_radius + outer_radius) / 2, point[1])
    sample_inside = point_in_copper(annulus_sample, rings)
    if boundary_area or sample_inside:
        kind = "overlap"
        raw_gap = 0.0
    elif boundary_touch:
        kind = "tangent"
        raw_gap = 0.0
    elif raw_gap <= EPSILON_MM:
        kind = "near_contact"
    else:
        kind = "clear"
    return {
        "contactKind": kind,
        "minimumCopperGapMm": raw_gap,
        "wholeOuterDiskInsideCopper": point_in_copper(point, rings) and minimum_boundary_distance > outer_radius,
    }


def authored_clearances(case_task):
    if case_task is None:
        return {}, None
    task, _ = read_json(case_task)
    source, source_sha = read_json(task["sourcePath"])
    if source_sha != task["sourceSha256"]:
        raise ValueError("Authored source SHA does not match case task")
    rules = collections.defaultdict(set)
    for zone in source["planeIntent"]["zones"]:
        clearance = finite(zone["clearance"], "authored pour clearance")
        if clearance < 0:
            raise ValueError("Negative authored pour clearance")
        rules[(zone["netName"], zone["layer"])].add(clearance)
    if any(len(values) != 1 for values in rules.values()):
        raise ValueError("Ambiguous authored pour clearances for net/layer")
    return {key: next(iter(values)) for key, values in rules.items()}, source_sha


def audit(circuit, circuit_sha=None, clearances=None):
    clearances = clearances or {}
    errors = []
    source_nets = {record["source_net_id"]: record for record in circuit if record["type"] == "source_net"}
    source_traces = {record["source_trace_id"]: record for record in circuit if record["type"] == "source_trace"}
    pcb_traces = {record["pcb_trace_id"]: record for record in circuit if record["type"] == "pcb_trace"}
    boards = [record for record in circuit if record["type"] == "pcb_board"]
    if len(boards) != 1:
        raise ValueError("Audit requires one owning PCB board")
    board = boards[0]
    count = board["num_layers"]
    if not isinstance(count, int) or count < 1:
        raise ValueError("Invalid physical board layer count")
    layers = ["top"] if count == 1 else ["top", *[f"inner{i}" for i in range(1, count - 1)], "bottom"]
    parent = {net: net for net in source_nets}

    def root(net):
        while parent[net] != net:
            net = parent[net]
        return net

    def union(a, b):
        a, b = sorted((root(a), root(b)))
        parent[b] = a

    net_by_connectivity = collections.defaultdict(list)
    for net, record in source_nets.items():
        if record.get("subcircuit_connectivity_map_key"):
            net_by_connectivity[record["subcircuit_connectivity_map_key"]].append(net)
    for nets in net_by_connectivity.values():
        for net in nets[1:]:
            union(nets[0], net)
    net_by_name = collections.defaultdict(set)
    for net, record in source_nets.items():
        net_by_name[record["name"]].add(root(net))

    def resolve_owner(record, trace=None):
        references = []
        for owner_record in [record, *([trace] if trace else [])]:
            if owner_record.get("source_net_id"):
                net = owner_record["source_net_id"]
                if net not in source_nets:
                    raise ValueError("Unknown explicit source_net_id")
                references.append(root(net))
            if owner_record.get("source_trace_id"):
                trace_id = owner_record["source_trace_id"]
                if trace_id in source_nets:
                    references.append(root(trace_id))
                elif trace_id in source_traces:
                    nets = source_traces[trace_id].get("connected_source_net_ids", [])
                    if not nets or any(net not in source_nets for net in nets):
                        raise ValueError("Unresolved source-trace net ownership")
                    references.extend(root(net) for net in nets)
                else:
                    raise ValueError("Unknown explicit source_trace_id")
            if owner_record.get("subcircuit_connectivity_map_key"):
                key = owner_record["subcircuit_connectivity_map_key"]
                if key not in net_by_connectivity:
                    raise ValueError("Unresolved connectivity-map ownership")
                references.extend(root(net) for net in net_by_connectivity[key])
            name = owner_record.get("connection_name")
            if name in source_nets:
                references.append(root(name))
            elif name in net_by_name:
                references.extend(net_by_name[name])
            elif name in source_traces:
                references.extend(root(net) for net in source_traces[name].get("connected_source_net_ids", []) if net in source_nets)
        if len(set(references)) != 1:
            raise ValueError("Missing or conflicting canonical via/trace owner")
        return references[0]

    pours = collections.defaultdict(list)
    for pour in (record for record in circuit if record["type"] == "pcb_copper_pour"):
        try:
            if pour["shape"] != "brep" or set(pour["brep_shape"]) != {"outer_ring", "inner_rings"}:
                raise ValueError("Only straight BRep pour geometry is supported")
            owner = resolve_owner(pour)
            layer = pour["layer"]
            if layer not in layers:
                raise ValueError("Pour references unknown physical layer")
            rings = [ring_points(pour["brep_shape"]["outer_ring"]), *[ring_points(ring) for ring in pour["brep_shape"]["inner_rings"]]]
            area = lambda ring: abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in edges(ring))) / 2
            pours[(owner, layer)].append({"id": pour["pcb_copper_pour_id"], "rings": rings, "area": area(rings[0]) - sum(area(ring) for ring in rings[1:]), "geometrySha256": digest(canonical(rings).encode())})
        except (KeyError, ValueError, TypeError) as error:
            errors.append({"record": pour.get("pcb_copper_pour_id"), "error": str(error)})

    vias = []
    for via in (record for record in circuit if record["type"] == "pcb_via"):
        try:
            trace = None
            if via.get("pcb_trace_id"):
                if via["pcb_trace_id"] not in pcb_traces:
                    raise ValueError("Via references missing PCB trace")
                trace = pcb_traces[via["pcb_trace_id"]]
            owner = resolve_owner(via, trace)
            physical = via["layers"]
            if not physical or len(physical) != len(set(physical)) or any(layer not in layers for layer in physical):
                raise ValueError("Invalid physical via layer span")
            physical = [layer for layer in layers if layer in physical]
            first, last = layers.index(physical[0]), layers.index(physical[-1])
            if physical != layers[first:last + 1]:
                raise ValueError("Noncontiguous physical via span")
            if board.get("allow_blind_and_buried_vias") is False and physical != layers:
                raise ValueError("Through-via policy requires every physical copper layer")
            for endpoint in [via.get("from_layer"), via.get("to_layer")]:
                if endpoint is not None and endpoint not in physical:
                    raise ValueError("Logical via endpoint outside physical span")
            x, y = finite(via["x"], "via.x"), finite(via["y"], "via.y")
            outer, inner = finite(via["outer_diameter"], "outer diameter") / 2, finite(via["hole_diameter"], "hole diameter") / 2
            if not 0 <= inner < outer:
                raise ValueError("Invalid annular via copper dimensions")
            geometry = {"owner": owner, "x": x, "y": y, "outerDiameter": outer * 2, "holeDiameter": inner * 2, "physicalLayers": physical}
            key = canonical(geometry)
            vias.append({"id": via["pcb_via_id"], "key": key, "geometry": geometry, "point": (x, y), "inner": inner, "outer": outer})
        except (KeyError, ValueError, TypeError) as error:
            errors.append({"record": via.get("pcb_via_id"), "error": str(error)})

    contacts, near_contacts, deficits = [], [], []
    minimum_gap = math.inf
    whole_disk_region_count = 0
    pair_count = 0
    for via in vias:
        for (owner, layer), regions in sorted(pours.items()):
            if owner == via["geometry"]["owner"] or layer not in via["geometry"]["physicalLayers"]:
                continue
            pair_count += 1
            assessments = [(region, annulus_to_region(via["point"], via["inner"], via["outer"], region["rings"])) for region in regions]
            whole_disk_region_count += sum(result["wholeOuterDiskInsideCopper"] for _, result in assessments)
            gap = min(result["minimumCopperGapMm"] for _, result in assessments)
            minimum_gap = min(minimum_gap, gap)
            rank = {"clear": 0, "near_contact": 1, "tangent": 2, "overlap": 3}
            kind = max((result["contactKind"] for _, result in assessments), key=rank.get)
            key = canonical([via["geometry"], owner, layer])
            owner_names = {record["name"] for net, record in source_nets.items() if root(net) == owner}
            required_set = {clearances[(name, layer)] for name in owner_names if (name, layer) in clearances}
            if len(required_set) > 1:
                errors.append({"record": key, "error": "Conflicting canonical-net authored clearances"})
            required = next(iter(required_set)) if len(required_set) == 1 else None
            row = {"key": key, "viaId": via["id"], "viaGeometry": via["geometry"], "foreignNet": owner, "layer": layer, "contactKind": kind, "minimumCopperGapMm": gap, "requiredClearanceMm": required, "clearanceMarginMm": gap - required if required is not None else None, "pourEvidence": [{"id": region["id"], "geometrySha256": region["geometrySha256"], **result} for region, result in assessments if result["contactKind"] != "clear" or result["minimumCopperGapMm"] == gap]}
            if kind in ("overlap", "tangent"):
                contacts.append(row)
            elif kind == "near_contact":
                near_contacts.append(row)
            if required is not None and gap < required:
                deficits.append(row)
    groups = [{"key": canonical([owner, layer]), "owner": owner, "layer": layer, "regionCount": len(regions), "areaMm2": sum(region["area"] for region in regions), "geometrySha256": digest(canonical(sorted(region["geometrySha256"] for region in regions)).encode())} for (owner, layer), regions in sorted(pours.items())]
    return {"circuitRawSha256": circuit_sha, "valid": not errors, "errors": errors, "physicalLayers": layers, "viaCount": sum(record["type"] == "pcb_via" for record in circuit), "resolvedViaCount": len(vias), "viaGeometryMultiset": dict(sorted(collections.Counter(via["key"] for via in vias).items())), "pourGroups": groups, "foreignViaPourGroupPairsChecked": pair_count, "wholeOuterDiskInsideForeignRegionCount": whole_disk_region_count, "physicalContactCount": len(contacts), "nearContactCount": len(near_contacts), "blockingContactCount": len(contacts) + len(near_contacts), "nearContacts": near_contacts, "uniqueContactViaGeometryCount": len({canonical(row["viaGeometry"]) for row in contacts}), "minimumCopperGapMm": minimum_gap if math.isfinite(minimum_gap) else None, "physicalContacts": contacts, "clearanceDeficitCount": len(deficits), "clearanceDeficits": deficits, "clearanceRuleKnown": bool(clearances), "clearanceComparisonToleranceMm": 0, "contactClassificationToleranceMm": EPSILON_MM}


def compare(before, after):
    old_contacts = {row["key"] for row in before["physicalContacts"]}
    new_contacts = {row["key"] for row in after["physicalContacts"]}
    old_near = {row["key"] for row in before["nearContacts"]}
    new_near = {row["key"] for row in after["nearContacts"]}
    before_vias = before["viaGeometryMultiset"]
    after_vias = after["viaGeometryMultiset"]
    missing_vias = {key: count - after_vias.get(key, 0) for key, count in before_vias.items() if count > after_vias.get(key, 0)}
    added_vias = {key: count - before_vias.get(key, 0) for key, count in after_vias.items() if count > before_vias.get(key, 0)}
    before_groups = {row["key"] for row in before["pourGroups"]}
    after_groups = {row["key"] for row in after["pourGroups"]}
    missing_groups = sorted(before_groups - after_groups)
    return {"resolvedPhysicalContactKeys": sorted(old_contacts - new_contacts), "newPhysicalContactKeys": sorted(new_contacts - old_contacts), "retainedPhysicalContactKeys": sorted(old_contacts & new_contacts), "resolvedNearContactKeys": sorted(old_near - new_near), "newNearContactKeys": sorted(new_near - old_near), "retainedNearContactKeys": sorted(old_near & new_near), "missingOrMovedViaGeometry": missing_vias, "addedOrMovedViaGeometry": added_vias, "missingForeignPourGroups": missing_groups, "sameViaGeometryMultiset": before_vias == after_vias, "candidatePhysicallyClear": before["valid"] and after["valid"] and not after["physicalContacts"] and not after["nearContacts"] and not missing_vias and not added_vias and not missing_groups, "candidateClearanceDeficitCount": after["clearanceDeficitCount"], "note": "Physical acceptance blocks both proven contacts and conservative near contacts. It excludes authored positive-gap clearance deficits, reported separately. Removed/moved vias or missing plane groups cannot masquerade as a repair."}


def self_test():
    rectangle = lambda left, bottom, right, top: [(left, bottom), (right, bottom), (right, top), (left, top)]
    checks = []
    def check(name, region, expected_kind, expected_gap=None, inner=0.2, outer=1.0):
        result = annulus_to_region((0, 0), inner, outer, region)
        assert result["contactKind"] == expected_kind, (name, result)
        if expected_gap is not None:
            assert math.isclose(result["minimumCopperGapMm"], expected_gap, abs_tol=1e-12), (name, result)
        checks.append(name)
    check("annulus wholly inside foreign copper", [rectangle(-3, -3, 3, 3)], "overlap", 0)
    check("outer boundary partial overlap", [rectangle(0.8, -2, 2, 2)], "overlap", 0)
    check("outer boundary tangent", [rectangle(1, -2, 2, 2)], "tangent", 0)
    check("separate positive gap", [rectangle(1.3, -2, 2, 2)], "clear", 0.3)
    check("near tangent conservatively blocked", [rectangle(1 + 5e-10, -2, 2, 2)], "near_contact", 5e-10)
    check("annulus in sufficiently large hole", [rectangle(-4, -4, 4, 4), rectangle(-1.5, -1.5, 1.5, 1.5)], "clear", 0.5)
    check("hole boundary cuts annulus", [rectangle(-4, -4, 4, 4), rectangle(-0.8, -0.8, 0.8, 0.8)], "overlap", 0)
    check("hole boundary tangent", [rectangle(-4, -4, 4, 4), rectangle(-1, -1, 1, 1)], "tangent", 0)
    check("foreign island wholly in drill void", [rectangle(-0.05, -0.05, 0.05, 0.05)], "clear", 0.2 - math.hypot(0.05, 0.05))
    check("foreign island inside annular band", [rectangle(0.4, -0.05, 0.5, 0.05)], "overlap", 0)
    check("foreign island reaches drill boundary", [rectangle(0.12, -0.16, 0.13, 0.16)], "overlap", 0)
    def circuit():
        return [{"type": "pcb_board", "num_layers": 4, "allow_blind_and_buried_vias": False}, {"type": "source_net", "source_net_id": "signal", "name": "SIGNAL", "subcircuit_connectivity_map_key": "signal_key"}, {"type": "source_net", "source_net_id": "ground", "name": "GND", "subcircuit_connectivity_map_key": "ground_key"}, {"type": "source_trace", "source_trace_id": "source_trace", "connected_source_net_ids": ["signal"]}, {"type": "pcb_trace", "pcb_trace_id": "trace", "connection_name": "signal", "source_trace_id": "source_trace"}, {"type": "pcb_via", "pcb_via_id": "via", "pcb_trace_id": "trace", "subcircuit_connectivity_map_key": "signal_key", "x": 0, "y": 0, "outer_diameter": 2, "hole_diameter": 0.4, "layers": ["top", "inner1", "inner2", "bottom"], "from_layer": "top", "to_layer": "inner2"}, {"type": "pcb_copper_pour", "pcb_copper_pour_id": "pour", "source_net_id": "ground", "layer": "bottom", "shape": "brep", "brep_shape": {"outer_ring": {"vertices": [{"x": x, "y": y} for x, y in rectangle(-3, -3, 3, 3)]}, "inner_rings": []}}]
    original = circuit(); baseline = audit(original)
    assert baseline["valid"] and baseline["physicalContactCount"] == 1
    checks.append("physical through span includes layer beyond logical endpoints")
    own = circuit(); own[-1]["source_net_id"] = "signal"
    assert audit(own)["physicalContactCount"] == 0
    checks.append("same canonical net excluded")
    conflict = circuit(); conflict[-2]["subcircuit_connectivity_map_key"] = "ground_key"
    assert not audit(conflict)["valid"]
    checks.append("conflicting explicit owner blocks audit")
    unknown = circuit(); unknown[-2]["pcb_trace_id"] = "missing"
    assert not audit(unknown)["valid"]
    checks.append("unresolved trace owner blocks audit")
    skipped = circuit(); skipped[-2]["layers"] = ["top", "bottom"]
    assert not audit(skipped)["valid"]
    checks.append("missing physical through layers blocks audit")
    renamed = circuit(); renamed[-1]["pcb_copper_pour_id"] = "new_pour"; renamed[-2]["pcb_via_id"] = "new_via"
    assert not compare(baseline, audit(renamed))["newPhysicalContactKeys"]
    checks.append("regenerated record IDs do not create new findings")
    removed = circuit(); removed.pop(-2)
    assert not compare(baseline, audit(removed))["candidatePhysicallyClear"]
    checks.append("deleted via cannot count as resolved contact")
    removed_pour = circuit(); removed_pour.pop()
    assert not compare(baseline, audit(removed_pour))["candidatePhysicallyClear"]
    checks.append("deleted plane group cannot count as resolved contact")
    clear = circuit(); clear[-1]["brep_shape"]["inner_rings"] = [{"vertices": [{"x": x, "y": y} for x, y in rectangle(-1.25, -1.25, 1.25, 1.25)]}]
    checked = audit(clear, clearances={("GND", "bottom"): 0.254})
    assert checked["physicalContactCount"] == 0 and checked["clearanceDeficitCount"] == 1
    assert math.isclose(checked["clearanceDeficits"][0]["clearanceMarginMm"], -0.004, abs_tol=1e-12)
    assert compare(baseline, checked)["candidatePhysicallyClear"]
    checks.append("positive-gap clearance deficit remains distinct from short")
    near = circuit(); boundary = 1 + 5e-10
    near[-1]["brep_shape"]["inner_rings"] = [{"vertices": [{"x": x, "y": y} for x, y in rectangle(-boundary, -boundary, boundary, boundary)]}]
    near_audit = audit(near)
    assert near_audit["physicalContactCount"] == 0 and near_audit["nearContactCount"] == 1
    assert not compare(baseline, near_audit)["candidatePhysicallyClear"]
    checks.append("conservative near contact blocks acceptance without claiming a short")
    return {"passed": True, "controlCount": len(checks), "controls": checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--circuit")
    parser.add_argument("--baseline")
    parser.add_argument("--candidate")
    parser.add_argument("--case-task")
    parser.add_argument("--output")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    proof = {"schemaVersion": 1, "units": "mm", "geometryAssumption": "Valid non-self-intersecting straight BRep outer rings with disjoint holes; via copper is the closed annulus excluding its drill void.", "minimumGapMeaning": "Exact nonnegative Euclidean separation of annular copper and polygon copper, zero for physical overlap/tangency. Signed clearanceMarginMm is gap minus authored required clearance, not penetration depth."}
    status = 0
    try:
        if args.self_test:
            proof["selfTest"] = self_test()
        rules, source_sha = authored_clearances(args.case_task)
        proof["authoredSourceSha256"] = source_sha
        if args.circuit:
            if args.baseline or args.candidate:
                parser.error("Use --circuit or --baseline with --candidate")
            circuit, sha = read_json(args.circuit)
            proof["audit"] = audit(circuit, sha, rules)
            status = int(not proof["audit"]["valid"])
        elif args.baseline and args.candidate:
            before, sha_before = read_json(args.baseline)
            after, sha_after = read_json(args.candidate)
            proof["baseline"] = audit(before, sha_before, rules)
            proof["candidate"] = audit(after, sha_after, rules)
            proof["comparison"] = compare(proof["baseline"], proof["candidate"])
            status = int(not proof["comparison"]["candidatePhysicallyClear"])
        elif not args.self_test:
            parser.error("Specify --circuit, --baseline/--candidate, or --self-test")
    except (ValueError, KeyError, TypeError, AssertionError) as error:
        proof["fatalError"] = str(error)
        status = 1
    if args.output:
        Path(args.output).write_text(json.dumps(proof, indent=2, allow_nan=False) + "\n")
    summary = {key: value for key, value in proof.items() if key not in ("baseline", "candidate", "audit")}
    for name in ("baseline", "candidate", "audit"):
        if name in proof:
            summary[name] = {key: proof[name][key] for key in ("valid", "errors", "viaCount", "resolvedViaCount", "wholeOuterDiskInsideForeignRegionCount", "physicalContactCount", "nearContactCount", "blockingContactCount", "uniqueContactViaGeometryCount", "clearanceDeficitCount")}
    print(json.dumps(summary, indent=2, allow_nan=False))
    raise SystemExit(status)


if __name__ == "__main__":
    main()
