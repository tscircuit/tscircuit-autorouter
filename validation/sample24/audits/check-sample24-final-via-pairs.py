#!/usr/bin/env python3
"""Independent all-output through-via pair audit, retaining foreign owners."""
import argparse
import hashlib
import importlib.util
import json
import math
import os

HERE = os.path.dirname(__file__)
SPEC = importlib.util.spec_from_file_location("electrical", os.path.join(HERE, "verify-sample24-final-electrical.py"))
E = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(E)
G = E.G


def compare_pair(a, b, hole_clearance=.1, copper_clearance=.1):
    same_owner = a["owner"] == b["owner"]
    distance = math.hypot(a["x"] - b["x"], a["y"] - b["y"])
    if same_owner and distance <= 1e-9:
        return None
    hole_gap = distance - (a["holeDiameter"] + b["holeDiameter"]) / 2
    copper_gap = distance - (a["padDiameter"] + b["padDiameter"]) / 2
    if hole_gap >= hole_clearance and (same_owner or copper_gap >= copper_clearance):
        return None
    return {"first": a, "second": b, "sameDeclaredOwner": same_owner, "centerDistance": distance,
            "drillEdgeGap": hole_gap, "minimumDrillEdgeGap": hole_clearance,
            "foreignCopperEdgeGap": None if same_owner else copper_gap,
            "minimumForeignCopperEdgeGap": None if same_owner else copper_clearance,
            "drillDeficitBeyond1eMinus6Mm": hole_gap + 1e-6 < hole_clearance,
            "foreignCopperDeficitBeyond1eMinus6Mm": not same_owner and copper_gap + 1e-6 < copper_clearance,
            "beyondReferenceFiveMicrometreTolerance": hole_gap + .005 < hole_clearance or (not same_owner and copper_gap + .005 < copper_clearance),
            "positiveForeignCopperOverlap": not same_owner and copper_gap < -1e-9}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="/workspace/sample24-audit-original.srj.json")
    parser.add_argument("--routes", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    input_sha, final_sha = E.sha(args.input), E.sha(args.routes)
    if input_sha != E.ORIGINAL_SHA:
        raise ValueError("Original board hash mismatch")
    original = json.load(open(args.input))
    if original["layerCount"] != 8 or original.get("allowBlindAndBuriedVias") is not False:
        raise ValueError("This audit requires the original full8 through policy")
    metadata = {**original, **dict(G.JsonStream(args.routes).records(set()))}
    pad_default, hole_default = E.board_via_dimensions(metadata)
    if (pad_default, hole_default) != (.3, .15):
        raise ValueError("Governing via defaults differ from original .3/.15")
    owners = {connection["name"] for connection in original["connections"]}
    unique = {}
    occurrence_count = trace_count = 0
    for key, trace in G.JsonStream(args.routes).records({"traces"}):
        if key != "traces":
            continue
        trace_count += 1
        owner = trace.get("connection_name")
        if owner not in owners:
            raise ValueError("Unknown original declared source owner; no geometric ownership inference allowed")
        for point_index, point in enumerate(trace.get("route", [])):
            if point.get("route_type") != "via":
                continue
            G.z_index(point["from_layer"], 8)
            G.z_index(point["to_layer"], 8)
            x, y = point["x"], point["y"]
            if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not math.isfinite(x) or not math.isfinite(y):
                raise ValueError("Nonfinite via coordinates")
            pad = G.number_from(point.get("via_diameter"), pad_default)
            hole = G.number_from(point.get("via_hole_diameter"), hole_default)
            if hole > pad:
                raise ValueError("Drill exceeds its pad diameter")
            occurrence_count += 1
            key = (owner, x, y)
            record = unique.setdefault(key, {"owner": owner, "x": x, "y": y, "padDiameter": pad, "holeDiameter": hole, "declarations": []})
            # Same-owner coincident declarations describe one physical barrel;
            # maximal dimensions preserve every declared copper/drill envelope.
            record["padDiameter"] = max(record["padDiameter"], pad)
            record["holeDiameter"] = max(record["holeDiameter"], hole)
            record["declarations"].append({"traceId": trace.get("pcb_trace_id"), "pointIndex": point_index, "padDiameter": pad, "holeDiameter": hole})
    vias = list(unique.values())
    if not vias:
        raise ValueError("No manufactured vias; refusing a vacuous sample24 via-pair certification")
    hole_clearance = original.get("minViaHoleEdgeToViaHoleEdgeClearance", .1)
    copper_clearance = original.get("minPadEdgeToPadEdgeClearance", .1)
    cell = max(max(via["padDiameter"] for via in vias) + copper_clearance,
               max(via["holeDiameter"] for via in vias) + hole_clearance)
    buckets, findings, narrow_checks, near_same_owner = {}, [], 0, 0
    for via in vias:
        bx, by = math.floor(via["x"] / cell), math.floor(via["y"] / cell)
        for dx in [-1, 0, 1]:
            for dy in [-1, 0, 1]:
                for peer in buckets.get((bx + dx, by + dy), []):
                    narrow_checks += 1
                    if via["owner"] == peer["owner"] and math.hypot(via["x"] - peer["x"], via["y"] - peer["y"]) <= 1e-9:
                        near_same_owner += 1
                    finding = compare_pair(via, peer, hole_clearance, copper_clearance)
                    if finding:
                        findings.append(finding)
        buckets.setdefault((bx, by), []).append(via)
    result = {"scope": "FINAL_OUTPUT_INDEPENDENT_VIA_PAIRS_NOT_COMPLETION_OR_WHOLE_BOARD_DRC",
              "inputSha256": input_sha, "routesSha256": final_sha,
              "physicalLayers": list(range(8)), "allowBlindAndBuriedVias": False,
              "governingPadDiameter": pad_default, "governingHoleDiameter": hole_default,
              "traceCount": trace_count, "viaOccurrences": occurrence_count, "uniquePhysicalViaCountWithinDeclaredOwners": len(vias),
              "sameOwnerRepeatedCoincidentDeclarations": occurrence_count - len(vias), "sameOwnerNumericalCoincidencePairs": near_same_owner,
              "minimumDrillEdgeClearance": hole_clearance, "minimumForeignCopperEdgeClearance": copper_clearance,
              "narrowPhasePairChecks": narrow_checks, "nominalDeficitPairCount": len(findings),
              "drillDeficitBeyond1eMinus6MmCount": sum(finding["drillDeficitBeyond1eMinus6Mm"] for finding in findings),
              "foreignCopperDeficitBeyond1eMinus6MmCount": sum(finding["foreignCopperDeficitBeyond1eMinus6Mm"] for finding in findings),
              "beyondReferenceFiveMicrometreToleranceCount": sum(finding["beyondReferenceFiveMicrometreTolerance"] for finding in findings),
              "positiveForeignCopperOverlapCount": sum(finding["positiveForeignCopperOverlap"] for finding in findings),
              "findings": findings,
              "qualification": "Never deduplicates coincident foreign owners. Owners are exact original declared connection names, not geometric unions. Same-owner exact-XY declarations union maximal envelopes; centers within1e-9mm are treated as numerical coincidence, matching the existing physical predicate. Shared same-owner copper does not waive distinct drill spacing. All barrels occupy0..7 under the original policy. Reference5um and existing physical-predicate1e-6mm tolerance comparisons are reported separately; .15 planning margin is not enforced. This is not electrical connectivity, wire clearance or capture-completion proof."}
    with open(args.report, "x") as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps({key: value for key, value in result.items() if key != "findings"}))
    return 1 if result["beyondReferenceFiveMicrometreToleranceCount"] or result["positiveForeignCopperOverlapCount"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
