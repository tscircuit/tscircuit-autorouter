import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver";
import { CapacityMeshNodeId } from "lib/types";

/**
 * Filter verboseInput to only include content related to the given relevant node IDs
 */
export function filterUnravelMultiSectionInput(
  input: ConstructorParameters<typeof UnravelSectionSolver>[0],
  relevantNodeIds: Set<CapacityMeshNodeId>,
) {
  const filteredInput = { ...input };

  const relevantSegmentIds = new Set<string>();

  for (const [nodeId, segments] of input.nodeIdToSegmentIds.entries()) {
    if (relevantNodeIds.has(nodeId)) {
      for (const segmentId of segments) {
        relevantSegmentIds.add(segmentId);
      }
    }
  }

  const relevantSegmentPointIds = new Set<string>();

  for (const [segmentPointId, point] of input.segmentPointMap!.entries()) {
    if (relevantSegmentIds.has(point.segmentId)) {
      relevantSegmentPointIds.add(segmentPointId);
    }
  }

  filteredInput.nodeMap = new Map(
    input.nodeMap!.entries().filter(([id]) => relevantNodeIds.has(id)),
  );

  filteredInput.nodeIdToSegmentIds = new Map(
    input
      .nodeIdToSegmentIds!.entries()
      .filter(([id]) => relevantNodeIds.has(id)),
  );

  filteredInput.segmentIdToNodeIds = new Map(
    input
      .segmentIdToNodeIds!.entries()
      .filter(([segmentId]) => relevantSegmentIds.has(segmentId)),
  );

  filteredInput.dedupedSegments = filteredInput.dedupedSegments.filter(
    (segment) => {
      // Use the segment's nodePortSegmentId to check if it's relevant
      return relevantSegmentIds.has(segment.nodePortSegmentId!);
    },
  );

  filteredInput.dedupedSegmentMap = new Map(
    input
      .dedupedSegmentMap!.entries()
      .filter(([segmentId]) => relevantSegmentIds.has(segmentId)),
  );

  filteredInput.segmentPointMap = new Map(
    input
      .segmentPointMap!.entries()
      .filter(([segmentPointId]) =>
        relevantSegmentPointIds.has(segmentPointId),
      ),
  );

  filteredInput.nodeToSegmentPointMap = new Map(
    input
      .nodeToSegmentPointMap!.entries()
      .filter(([nodeId]) => relevantNodeIds.has(nodeId)),
  );

  filteredInput.segmentToSegmentPointMap = new Map(
    input
      .segmentToSegmentPointMap!.entries()
      .filter(([segmentId]) => relevantSegmentIds.has(segmentId)),
  );

  return filteredInput;
}
