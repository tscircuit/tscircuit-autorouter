import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types";
import {
  UnravelSection,
  UnravelIssue,
  UnravelTransitionViaIssue,
  SegmentPoint,
  SegmentPointId,
  UnravelSameLayerCrossingIssue,
  UnravelSingleTransitionCrossingIssue,
  UnravelDoubleTransitionCrossingIssue,
} from "./types";
import { getIntraNodeCrossingsFromSegments } from "lib/utils/getIntraNodeCrossingsFromSegments";
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1";
import { doSegmentsIntersect } from "@tscircuit/math-utils";
import { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { hasZRangeOverlap } from "./hasZRangeOverlap";

export const getIssuesInSection = (
  section: UnravelSection,
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>,
  pointModifications: Map<
    SegmentPointId,
    { x?: number; y?: number; z?: number }
  >,
  connMap?: ConnectivityMap,
): UnravelIssue[] => {
  const issues: UnravelIssue[] = [];

  const points: Map<SegmentPointId, { x: number; y: number; z: number }> =
    new Map(section.originalPointMap);
  for (const [segmentPointId, modPoint] of pointModifications.entries()) {
    const ogPoint = points.get(segmentPointId)!;
    points.set(segmentPointId, {
      x: modPoint.x ?? ogPoint.x,
      y: modPoint.y ?? ogPoint.y,
      z: modPoint.z ?? ogPoint.z,
    });
  }

  for (const nodeId of section.allNodeIds) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const nodeSegmentPairs = section.segmentPairsInNode.get(nodeId)!;

    // If there's a Z transition within the pair, there's a transition_via issue
    for (const pair of nodeSegmentPairs) {
      const A = points.get(pair[0])!;
      const B = points.get(pair[1])!;
      if (A.z !== B.z) {
        issues.push({
          type: "transition_via",
          segmentPoints: pair,
          capacityMeshNodeId: nodeId,
          probabilityOfFailure: 0,
        });
      }
    }

    // Find crossing issues
    for (let i = 0; i < nodeSegmentPairs.length; i++) {
      for (let j = i + 1; j < nodeSegmentPairs.length; j++) {
        if (
          connMap?.areIdsConnected(
            nodeSegmentPairs[i][0],
            nodeSegmentPairs[i][1],
          )
        ) {
          continue;
        }

        const pair1 = nodeSegmentPairs[i];
        const pair2 = nodeSegmentPairs[j];

        const A = points.get(pair1[0])!;
        const B = points.get(pair1[1])!;
        const C = points.get(pair2[0])!;
        const D = points.get(pair2[1])!;

        // Are the lines ever on the same layer? Is there any risk of overlap?
        if (!hasZRangeOverlap(A.z, B.z, C.z, D.z)) continue;

        const areCrossing = doSegmentsIntersect(A, B, C, D);
        const isSameLayer = A.z === B.z && C.z === D.z && A.z === C.z;
        if (areCrossing) {
          if (isSameLayer) {
            issues.push({
              type: "same_layer_crossing",
              segmentPoints: [pair1, pair2],
              capacityMeshNodeId: nodeId,
              crossingLine1: pair1,
              crossingLine2: pair2,
              probabilityOfFailure: 0,
            } as UnravelSameLayerCrossingIssue);
          } else if (A.z === B.z && C.z !== D.z) {
            issues.push({
              type: "single_transition_crossing",
              segmentPoints: [pair1, pair2],
              capacityMeshNodeId: nodeId,
              sameLayerCrossingLine: pair1,
              transitionCrossingLine: pair2,
              probabilityOfFailure: 0,
            } as UnravelSingleTransitionCrossingIssue);
          } else if (A.z !== B.z && C.z === D.z) {
            issues.push({
              type: "single_transition_crossing",
              segmentPoints: [pair1, pair2],
              capacityMeshNodeId: nodeId,
              sameLayerCrossingLine: pair2,
              transitionCrossingLine: pair1,
              probabilityOfFailure: 0,
            } as UnravelSingleTransitionCrossingIssue);
          } else if (A.z !== B.z && C.z !== D.z) {
            issues.push({
              type: "double_transition_crossing",
              segmentPoints: [pair1, pair2],
              capacityMeshNodeId: nodeId,
              crossingLine1: pair1,
              crossingLine2: pair2,
              probabilityOfFailure: 0,
            } as UnravelDoubleTransitionCrossingIssue);
          }
        }
      }
    }
  }

  return issues;
};
