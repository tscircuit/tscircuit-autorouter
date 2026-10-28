#!/usr/bin/env python3
"""Present selected retained inspection facts; never rerun checks or routing."""
import argparse
import json
import pathlib


def select(value, keys):
    return {key: value[key] for key in keys if key in value}


def clean(row):
    official = row.get("official") or {}
    return bool(official.get("didSolve") and not official.get("didTimeout") and official.get("relaxedDrcPassed"))


def compact_finding(finding):
    result = select(finding, ["fingerprint", "type", "location", "originEvidence"])
    result["message"] = str(finding.get("message", ""))[:400]
    participants = []
    for participant in finding.get("participants", [])[:12]:
        item = select(participant, ["field", "id", "originalExactIdentifierMatchCount", "pointPairExactIdentifierMatchCount", "newlyRoutedTrace", "traceGeometryHash"])
        allocation = participant.get("pinnedConverterViaAllocation")
        if allocation:
            first = allocation["firstRawOccurrence"]
            item["allocatedVia"] = {"geometry": allocation["materializedGeometry"], "firstOccurrence": select(first, ["traceIndex", "routePointIndex", "pcb_trace_id", "connection_name", "owner", "traceGeometryHash"]),
                **select(allocation, ["rawOccurrenceCount", "deduplicatedOccurrenceCount", "hasDistinctResolvedRawOwners", "hasUnresolvedRawOwner"]), "ownerTagCount": len(allocation.get("rawOccurrenceOwnerTags", [])), "ownerTags": allocation.get("rawOccurrenceOwnerTags", [])[:8]}
        obstacles = []
        for match in participant.get("originalExactIdentifierMatches", [])[:4]:
            obstacle = match.get("containingObstacle")
            if not obstacle:
                continue
            geometry = select(obstacle, ["type", "shape", "center", "x", "y", "width", "height", "radius", "layers", "layer", "ccwRotationDegrees", "obstacleId", "rawObstacleHash"])
            references = obstacle.get("connectedTo") or []
            geometry["connectedToCount"] = len(references)
            geometry["connectedToExamples"] = references[:16]
            geometry["ownerReferenceExamples"] = (obstacle.get("declaredOwnerReferences") or [])[:16]
            geometry["sourceIdentity"] = {key: value for key, value in (obstacle.get("sourceIdentity") or {}).items() if key.endswith("_id") or key in ["source_component_name", "source_port_name"]}
            obstacles.append(geometry)
        if obstacles:
            item["exactOriginalObstacleMatches"] = obstacles
        traces = participant.get("rawTraceParticipantDigests") or []
        if traces:
            item["rawTraceEndpoints"] = [select(trace, ["pcb_trace_id", "connection_name", "owner", "firstRoutePoint", "lastRoutePoint", "errorLocationEndpointDistances", "originalTerminalsAtExactErrorXY", "originalTerminalsAtExactErrorXYCount"]) for trace in traces[:4]]
        participants.append(item)
    result["participants"] = participants
    relations = []
    for relation in finding.get("viaPadDeclaredOwnerRelations", [])[:8]:
        references = relation.get("padRawConnectedToOwnerReferences") or []
        relations.append({**select(relation, ["viaId", "padId", "firstAllocatedViaOwner", "relation", "originalExactIdentifierMatchesTruncated", "originalExactIdentifierMatchCount"]), "padOwnerReferenceCount": len(references), "padOwnerReferenceExamples": references[:16]})
    if relations:
        result["requestOwnerRelations"] = relations
    if finding.get("exactPortCopperEvidence"):
        result["portEvidence"] = [{"pcb_port_id": value.get("pcb_port_id"), "status": value.get("status"), "demand": select(value.get("terminalDemandEvidence") or {}, ["classification", "originalExactPortConnectionCount", "declaredOwnerGroup", "pointPairContextExactPortMembership", "routedDeclaredOwnerPresence"]),
            "pointCopperExample": [{"point": point.get("point"), "nearestSameDeclaredOwnerCopper": select(point["nearestSameDeclaredOwnerCopper"], ["centerlineDistance", "layer", "widthRange", "withinMinimumEndpointHalfWidth", "withinMaximumEndpointHalfWidth", "traceGeometryHash"]) if point.get("nearestSameDeclaredOwnerCopper") is not None else None} for point in value.get("points", [])[:1]]} for value in finding["exactPortCopperEvidence"][:1]]
    return result


def present(report):
    if report.get("qualification") != "PROVENANCE_CHECKS_PASSED" or report.get("integrityIssues"):
        raise ValueError("Inspection provenance/completeness did not pass")
    output = [("COMPACT_INSPECTION_SUMMARY_JSON", select(report, ["sourceArtifact", "expectedProvenance", "qualification", "integrityIssues", "firstRoundLibraryErrorTotals", "repeatGeometryComparisons"]))]
    for row in report["results"]:
        if row.get("round") != 1:
            continue
        context = {"sample": row["sample"], "arm": row["arm"], "nominalOfficialClean": clean(row)}
        inspection = row.get("inspection") or {}
        checks = inspection.get("checks") or {}
        library = checks.get("libraryRoutingChecks") or {}
        raw = inspection.get("rawPhysicalCopper") or {}
        findings = library.get("boundedTraceAndPadFindings") or []
        finding_limit = 64 if clean(row) else 2
        output.append(("COMPACT_INSPECTION_BOARD_JSON", {**context, "official": row.get("official"), "rawPhysicalCopper": {**select(raw, ["traceCount", "identityInsensitiveTracePayloadHash", "physicalPrimitiveMultisetHash", "rawViaOccurrenceCount", "rawUniqueOwnedViaSiteSpanCount", "rawForeignOwnerCoincidentViaSiteSpanCount", "rawViaSiteSpansWithUnresolvedOwner", "tracesWithUnresolvedOrAmbiguousOwner", "viasWithUnresolvedSpan"]), "foreignSiteExamples": (raw.get("rawForeignOwnerCoincidentExamples") or [])[:2]},
            "checks": {name: select(value, ["count", "byType", "normalizedErrorFingerprintMultisetHash"]) for name, value in checks.items()},
            "libraryEvidence": select(library, ["originEvidenceCounts", "portCopperEvidenceCounts", "portTerminalDemandEvidenceCounts", "viaPadDeclaredOwnerRelationCounts"]),
            "physicalFindingCoverage": {"reportedTraceAndPadTypeTotal": sum((library.get("byType") or {}).get(kind, 0) for kind in ["pcb_trace_error", "pcb_pad_pad_clearance_error"]), "availableSelectedFindingCount": len(findings), "emittedFindingCount": min(len(findings), finding_limit), "fullReportRetained": True}}))
        for finding in findings[:finding_limit]:
            output.append(("COMPACT_INSPECTION_PHYSICAL_FINDING_JSON", {**context, "finding": compact_finding(finding)}))
        for kind, examples in (library.get("examplesByType") or {}).items():
            if kind in ["pcb_port_not_connected_error", "pcb_trace_style_warning"] and examples:
                output.append(("COMPACT_INSPECTION_PORT_STYLE_EXAMPLE_JSON", {**context, "type": kind, "example": compact_finding(examples[0])}))
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=pathlib.Path, required=True)
    args = parser.parse_args()
    for marker, value in present(json.loads(args.report.read_text())):
        print(marker + " " + json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
