import { doSegmentsIntersect } from "@tscircuit/math-utils"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { getNodePortPointPairs } from "./nodeWithPortPointPairs"

// Intersection calculation is only accurate to 0.00001 (0.01mm)
const intSpace = (a: number) => Math.round(a * 10000)

export const getIntraNodeCrossings = (node: NodeWithPortPoints) => {
  // Count the number of crossings
  let numSameLayerCrossings = 0
  let pointPairs: {
    points: { x: number; y: number; z: number }[]
    z: number
    connectionName: string
  }[] = []

  const transitionPairPoints: {
    points: { x: number; y: number; z: number }[]
    connectionName: string
  }[] = []

  for (const pair of getNodePortPointPairs(node)) {
    const pointPair = {
      connectionName: pair.connectionName,
      z: pair.start.z,
      points: [
        {
          x: intSpace(pair.start.x),
          y: intSpace(pair.start.y),
          z: pair.start.z,
        },
        {
          x: intSpace(pair.end.x),
          y: intSpace(pair.end.y),
          z: pair.end.z,
        },
      ],
    }
    if (pointPair.points.some((p) => p.z !== pointPair.z)) {
      transitionPairPoints.push(pointPair)
      continue
    }
    pointPairs.push(pointPair)
  }

  // TODO maybe these should be returned as "number of non-crossing connections"
  pointPairs = pointPairs.filter((p) => p.points.length > 1)

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

  let numTransitionPairCrossings = 0
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
        numTransitionPairCrossings++
      }
    }
  }

  return {
    numSameLayerCrossings,
    numEntryExitLayerChanges: transitionPairPoints.length,
    numTransitionPairCrossings,
  }
}
