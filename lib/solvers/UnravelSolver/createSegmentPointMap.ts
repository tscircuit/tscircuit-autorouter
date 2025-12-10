import { CapacityMeshNodeId } from "lib/types"
import { SegmentWithAssignedPoints } from "../CapacityMeshSolver/CapacitySegmentToPointSolver"
import {
  SegmentId,
  SegmentPoint,
  SegmentPointId,
  SegmentPointMap,
} from "./types"

export type SegmentPointMapAndReverseMaps = {
  segmentPointMap: SegmentPointMap
  nodeToSegmentPointMap: Map<CapacityMeshNodeId, SegmentPointId[]>
  segmentToSegmentPointMap: Map<SegmentId, SegmentPointId[]>
}

export const createSegmentPointMap = (
  dedupedSegments: SegmentWithAssignedPoints[],
  segmentIdToNodeIds: Map<SegmentId, CapacityMeshNodeId[]>,
): SegmentPointMapAndReverseMaps => {
  const segmentPointMap: SegmentPointMap = new Map()
  const nodeToSegmentPointMap: Map<CapacityMeshNodeId, SegmentPointId[]> =
    new Map()
  const segmentToSegmentPointMap: Map<SegmentId, SegmentPointId[]> = new Map()

  const segmentPoints: SegmentPoint[] = []
  let highestSegmentPointId = 0
  for (const segment of dedupedSegments) {
    for (const point of segment.assignedPoints!) {
      const sp = {
        segmentPointId: `SP${highestSegmentPointId++}`,
        segmentId: segment.nodePortSegmentId!,
        capacityMeshNodeIds: segmentIdToNodeIds.get(
          segment.nodePortSegmentId!,
        )!,
        connectionName: point.connectionName,
        rootConnectionName: point.rootConnectionName,
        x: point.point.x,
        y: point.point.y,
        z: point.point.z,
        directlyConnectedSegmentPointIds: [],
      }

      segmentPointMap.set(sp.segmentPointId, sp)
      for (const nodeId of sp.capacityMeshNodeIds) {
        nodeToSegmentPointMap.set(nodeId, [
          ...(nodeToSegmentPointMap.get(nodeId) ?? []),
          sp.segmentPointId,
        ])
      }

      segmentToSegmentPointMap.set(segment.nodePortSegmentId!, [
        ...(segmentToSegmentPointMap.get(segment.nodePortSegmentId!) ?? []),
        sp.segmentPointId,
      ])

      segmentPoints.push(sp)
    }
  }

  return {
    segmentPointMap,
    nodeToSegmentPointMap,
    segmentToSegmentPointMap,
  }
}
