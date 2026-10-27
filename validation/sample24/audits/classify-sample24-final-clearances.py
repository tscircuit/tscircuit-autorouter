#!/usr/bin/env python3
"""Classify conservative raw findings using original structural obstacle roles."""
import argparse
import hashlib
import importlib.util
import json
import os


def sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def opaque(obstacle):
    metadata = obstacle.get("circuitJsonMetadata") or {}
    return not obstacle.get("connectedTo") and not obstacle.get("offBoardConnectsTo") and not obstacle.get("isNonPlatedHole") and not any(metadata.get(key) for key in ["pcb_smtpad_id", "pcb_plated_hole_id", "pcb_port_id", "pcb_via_id"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="/workspace/sample24-audit-original.srj.json")
    parser.add_argument("--routes", required=True)
    parser.add_argument("--via-report", required=True)
    parser.add_argument("--through-report")
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    input_sha, final_sha = sha(args.input), sha(args.routes)
    if input_sha != "ba157c96251e5c53964a7fb529981fc19347865c82379558bf820fcdef6b52a7":
        raise ValueError("Original board hash mismatch")
    original = json.load(open(args.input))
    obstacles = original["obstacles"]
    via = json.load(open(args.via_report))
    if via.get("inputSha256") != input_sha or via.get("routesSha256") != final_sha or via.get("requestedClearance") != .1 or via.get("scope") != "FINAL_OUTPUT" or via.get("transitionCoverageCertified") is not True:
        raise ValueError("Expected hash-matched .1mm raw-via report")
    findings = []
    projected_board_checks, projected_board_violations = 0, []
    def classify(finding, gap, raw_index, target):
        if raw_index is None:
            category, required, numerical = "FOREIGN_ROUTED_COPPER", .1, 1e-6
        else:
            obstacle = obstacles[raw_index]
            metadata = obstacle.get("circuitJsonMetadata") or {}
            if opaque(obstacle):
                category, required, numerical = "OPAQUE_ELECTRICALLY_UNOWNED_BARRIER", 0, 1e-8
            elif obstacle.get("isNonPlatedHole"):
                category = "NON_PLATED_HOLE"
                required = original.get("minTraceToHoleEdgeClearance", .2) if target.startswith("PROJECTED_WIRE") else .1
                numerical = 1e-6
            elif metadata.get("pcb_smtpad_id") or metadata.get("pcb_plated_hole_id"):
                category, required, numerical = "IDENTIFIED_PAD_COPPER", .1, 1e-6
            else:
                raise ValueError("Unclassified original obstacle; cannot infer a copper role")
        source_overlap = finding.get("kind") == "GEOMETRIC_COPPER_INTERSECTION" or finding.get("positiveCopperOverlap") is True
        applicable_tolerance = numerical if category in ["OPAQUE_ELECTRICALLY_UNOWNED_BARRIER", "NON_PLATED_HOLE"] else .005
        findings.append({"target": target, "category": category, "rawObstacleIndex": raw_index,
                         "actualCopperEdgeGap": gap, "nominalRequiredClearance": required,
                         "applicableToleranceMm": applicable_tolerance,
                         "positiveCopperOverlap": source_overlap,
                         "belowNominalBeyondGeometricEpsilon": gap + numerical < required,
                         "beyondApplicableTolerance": gap + applicable_tolerance < required,
                         "conservativeExtraMarginOnly": required == 0 and gap >= -numerical,
                         "sourceFinding": finding})
    for finding in via["geometricCopperIntersections"] + via["clearanceOnlyFindings"]:
        classify(finding, finding["copperEdgeGap"], finding["obstacleIndex"], "MANUFACTURED_VIA_VS_RAW")
    if args.through_report:
        through = json.load(open(args.through_report))
        if through.get("inputSha256") != input_sha or through.get("routesSha256") != final_sha or through.get("scope") != "FINAL_TARGETED_THROUGH_OBSTACLE_CLEARANCE":
            raise ValueError("Through report provenance mismatch")
        for finding in through["findings"]:
            if finding["kind"] == "PROJECTED_WIRE_VS_RAW" and obstacles[finding["other"]["obstacleIndex"]].get("isNonPlatedHole"):
                continue  # Rechecked below over the full reference hole margin.
            classify(finding, finding["actualCopperEdgeGap"], finding["other"].get("obstacleIndex") if finding["kind"] == "PROJECTED_WIRE_VS_RAW" else None, finding["kind"])
        projection_path = through["projectionPath"]
        projected = json.load(open(projection_path))
        if sha(projection_path) != through["projectionSha256"] or projected["routesSha256"] != final_sha:
            raise ValueError("Projection provenance mismatch")
        spec = importlib.util.spec_from_file_location("through_geometry", os.path.join(os.path.dirname(__file__), "check-through-obstacle-physical-clearance.py"))
        geometry = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(geometry)
        wires = list(projected["projectedWires"])
        for disk in projected["projectedVias"]:
            wires.append({**disk, "start": disk["center"], "end": disk["center"], "width": disk["diameter"]})
        holes = [(index, geometry.G.compile_obstacle(obstacle, index, 8)) for index, obstacle in enumerate(obstacles) if obstacle.get("isNonPlatedHole")]
        hole_gap = original.get("minTraceToHoleEdgeClearance", .2)
        outline = [(point["x"], point["y"]) for point in original["outline"]]
        edges = list(zip(outline, outline[1:] + outline[:1]))
        for wire in wires:
            for index, hole in holes:
                gap = geometry.raw_segment_distance(wire["start"], wire["end"], hole) - wire["width"] / 2
                if gap + 1e-6 < hole_gap:
                    finding = {"kind": "PROJECTED_WIRE_VS_RAW_HOLE_REFERENCE_DEFAULT", "positiveCopperOverlap": gap < -1e-6,
                               "traceId": wire["traceId"], "markerIndex": wire["markerIndex"], "rawObstacleIndex": index}
                    classify(finding, gap, index, "PROJECTED_WIRE_VS_RAW_HOLE_REFERENCE_DEFAULT")
            projected_board_checks += 1
            radius = wire["width"] / 2 + original.get("minBoardEdgeClearance", 0)
            inside = all(geometry.G.polygon_distance(point["x"], point["y"], outline) == 0 for point in [wire["start"], wire["end"]])
            boundary_distance = min(geometry.segment_distance(wire["start"], wire["end"], {"x": a[0], "y": a[1]}, {"x": b[0], "y": b[1]}) for a, b in edges)
            bounds = original["bounds"]
            inside_bounds = all(bounds["minX"] <= point["x"] - radius and point["x"] + radius <= bounds["maxX"] and bounds["minY"] <= point["y"] - radius and point["y"] + radius <= bounds["maxY"] for point in [wire["start"], wire["end"]])
            if not inside or not inside_bounds or boundary_distance < radius - 1e-6:
                projected_board_violations.append({"traceId": wire["traceId"], "markerIndex": wire["markerIndex"],
                                                   "start": wire["start"], "end": wire["end"], "width": wire["width"],
                                                   "boundaryDistance": boundary_distance, "requiredRadius": radius})
    result = {"scope": "CLASSIFIED_INDEPENDENT_SCOPED_FINDINGS_NOT_WHOLE_BOARD_DRC",
              "inputSha256": input_sha, "routesSha256": final_sha,
              "viaReportSha256": sha(args.via_report), "throughReportSha256": sha(args.through_report) if args.through_report else None,
              "opaqueUnownedObstacleCount": sum(opaque(obstacle) for obstacle in obstacles),
              "identifiedPadObstacleCount": sum(bool((obstacle.get("circuitJsonMetadata") or {}).get("pcb_smtpad_id") or (obstacle.get("circuitJsonMetadata") or {}).get("pcb_plated_hole_id")) for obstacle in obstacles),
              "nonPlatedHoleObstacleCount": sum(bool(obstacle.get("isNonPlatedHole")) for obstacle in obstacles),
              "projectedWireBoardChecks": projected_board_checks, "projectedWireBoardViolationCount": len(projected_board_violations),
              "projectedWireBoardViolations": projected_board_violations,
              "findingCount": len(findings),
              "positiveCopperOverlapCount": sum(finding["positiveCopperOverlap"] for finding in findings),
              "belowNominalBeyondGeometricEpsilonCount": sum(finding["belowNominalBeyondGeometricEpsilon"] for finding in findings),
              "beyondApplicableToleranceCount": sum(finding["beyondApplicableTolerance"] for finding in findings),
              "conservativeExtraMarginOnlyCount": sum(finding["conservativeExtraMarginOnly"] for finding in findings),
              "findings": findings,
              "qualification": "Structural opaque-unowned classification uses no identifier prefix or inferred physical kind. Opaque barriers use overlap-only, identified pads use actual original/default .1mm rules. Reference trace/NPTH default is .2mm; all actual through-marker projections are additionally scanned against the six holes over that full margin and checked against original board outline/bounds with zero added edge margin. Applicable tolerances are recorded per finding: NPTH trace1e-6mm, pad/peer5um, opaque1e-8mm; nominal deficits remain separately counted. Planning .15mm is not enforced. Zero counts here do not certify ordinary wires, via pairs, electrical connectivity or completion. Positive intersections from the clearance-zero raw-via report must also be reviewed."}
    with open(args.report, "x") as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps({key: value for key, value in result.items() if key != "findings"}))


if __name__ == "__main__":
    main()
