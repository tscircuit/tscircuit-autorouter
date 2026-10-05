import { doSegmentsIntersect } from "@tscircuit/math-utils"
import { SegmentWithAssignedPoints } from "lib/solvers/CapacityMeshSolver/CapacitySegmentToPointSolver"
import { NodeWithPortPoints } from "lib/types/high-density-types"

/**
 * Get the number of crossings between segments on the same node
 */
export const getIntraNodeCrossingsFromSegments = (
  segments: SegmentWithAssignedPoints[],
): {
  numSameLayerCrossings: number
  numEntryExitLayerChanges: number
  numTransitionCrossings: number
} => {
  // Count the number of crossings
  let numSameLayerCrossings = 0
  const pointPairs: {
    points: { x: number; y: number; z: number }[]
    z: number
    connectionName: string
  }[] = []

  const transitionPairPoints: {
    points: { x: number; y: number; z: number }[]
    connectionName: string
  }[] = []

  let numEntryExitLayerChanges = 0

  const portPoints = segments.flatMap((seg) => seg.assignedPoints!)

  for (const { connectionName: aConnName, point: A } of portPoints) {
    if (pointPairs.some((p) => p.connectionName === aConnName)) {
      continue
    }
    if (transitionPairPoints.some((p) => p.connectionName === aConnName)) {
      continue
    }
    const pointPair = {
      connectionName: aConnName,
      z: A.z,
      points: [A],
    }
    for (const { connectionName: bConnName, point: B } of portPoints) {
      if (aConnName !== bConnName) continue
      if (A === B) continue
      pointPair.points.push(B)

      if (pointPair.points.some((p) => p.z !== pointPair.z)) {
        numEntryExitLayerChanges++
        transitionPairPoints.push(pointPair)
        break
      } else {
        pointPairs.push(pointPair)
        break
      }
    }
  }

  for (let i = 0; i < pointPairs.length; i++) {
    for (let j = i + 1; j < pointPairs.length; j++) {
      const pair1 = pointPairs[i]
      const pair2 = pointPairs[j]
      if (
        pair1.z === pair2.z &&
        doSegmentsIntersect(
          pair1.points[0],
          pair1.points[1],
          pair2.points[0],
          pair2.points[1],
        )
      ) {
        numSameLayerCrossings++
      }
    }
  }

  let numTransitionCrossings = 0
  for (let i = 0; i < transitionPairPoints.length; i++) {
    for (let j = i + 1; j < transitionPairPoints.length; j++) {
      const pair1 = transitionPairPoints[i]
      const pair2 = transitionPairPoints[j]

      if (
        doSegmentsIntersect(
          pair1.points[0],
          pair1.points[1],
          pair2.points[0],
          pair2.points[1],
        )
      ) {
        numTransitionCrossings++
      }
    }
  }

  for (let i = 0; i < transitionPairPoints.length; i++) {
    for (let j = 0; j < pointPairs.length; j++) {
      const pair1 = transitionPairPoints[i]
      const pair2 = pointPairs[j]
      if (
        doSegmentsIntersect(
          pair1.points[0],
          pair1.points[1],
          pair2.points[0],
          pair2.points[1],
        )
      ) {
        numTransitionCrossings++
      }
    }
  }

  return {
    numSameLayerCrossings,
    numEntryExitLayerChanges,
    numTransitionCrossings,
  }
}
