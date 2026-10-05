import { doSegmentsIntersect } from "@tscircuit/math-utils"
import { SegmentPoint } from "lib/solvers/UnravelSolver/types"

export const getIntraNodeCrossingsFromSegmentPoints = (
  segmentPoints: SegmentPoint[],
) => {
  // Count the number of crossings
  let numSameLayerCrossings = 0
  let numEntryExitLayerChanges = 0
  let numTransitionCrossings = 0

  // Group segment points by connection name
  const connectionGroups = new Map<string, SegmentPoint[]>()

  for (const point of segmentPoints) {
    if (!connectionGroups.has(point.connectionName)) {
      connectionGroups.set(point.connectionName, [])
    }
    connectionGroups.get(point.connectionName)!.push(point)
  }

  const pointPairs: {
    points: { x: number; y: number; z: number }[]
    z: number
    connectionName: string
  }[] = []

  const transitionPairPoints: {
    points: { x: number; y: number; z: number }[]
    connectionName: string
  }[] = []

  // Process each connection group
  for (const [connectionName, points] of connectionGroups.entries()) {
    if (points.length < 2) continue

    // For simplicity, we'll just connect the first point to all others in the group
    // This assumes a simple connection pattern
    const firstPoint = points[0]

    for (let i = 1; i < points.length; i++) {
      const secondPoint = points[i]

      const pointPair = {
        connectionName,
        z: firstPoint.z,
        points: [firstPoint, secondPoint],
      }

      if (firstPoint.z !== secondPoint.z) {
        numEntryExitLayerChanges++
        transitionPairPoints.push({
          connectionName,
          points: [firstPoint, secondPoint],
        })
      } else {
        pointPairs.push(pointPair)
      }
    }
  }

  // Check for same layer crossings
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

  // Check for transition crossings
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

  // Check for crossings between transition pairs and regular pairs
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
