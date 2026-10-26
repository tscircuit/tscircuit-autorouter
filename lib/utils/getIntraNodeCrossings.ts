import { doSegmentsIntersect } from "@tscircuit/math-utils"
import {
  NodeWithPortPoints,
  type PortPoint,
} from "lib/types/high-density-types"

// Intersection calculation is only accurate to 0.00001 (0.01mm)
const intSpace = (a: number) => Math.round(a * 10000)

export const getIntraNodeCrossings = (
  node: NodeWithPortPoints,
  options?: {
    portPairs: readonly (readonly [PortPoint, PortPoint])[]
    areConnectionsConnected: (first: string, second: string) => boolean
  },
) => {
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

  if (options) {
    for (const [start, end] of options.portPairs) {
      const pair = {
        connectionName: start.connectionName,
        z: start.z,
        points: [start, end].map((point) => ({
          x: intSpace(point.x),
          y: intSpace(point.y),
          z: point.z,
        })),
      }
      if (start.z === end.z) pointPairs.push(pair)
      else transitionPairPoints.push(pair)
    }
  } else {
    for (const A of node.portPoints) {
      if (pointPairs.some((p) => p.connectionName === A.connectionName)) {
        continue
      }
      if (
        transitionPairPoints.some((p) => p.connectionName === A.connectionName)
      ) {
        continue
      }
      const pointPair = {
        connectionName: A.connectionName,
        z: A.z,
        points: [{ x: intSpace(A.x), y: intSpace(A.y), z: A.z }],
      }
      for (const B of node.portPoints) {
        if (A.connectionName !== B.connectionName) continue
        if (A.x === B.x && A.y === B.y) continue
        pointPair.points.push({ x: intSpace(B.x), y: intSpace(B.y), z: B.z })
      }
      if (pointPair.points.some((p) => p.z !== pointPair.z)) {
        transitionPairPoints.push(pointPair)
        continue
      }
      pointPairs.push(pointPair)
    }
  }

  // TODO maybe these should be returned as "number of non-crossing connections"
  pointPairs = pointPairs.filter((p) => p.points.length > 1)

  for (let i = 0; i < pointPairs.length; i++) {
    for (let j = i + 1; j < pointPairs.length; j++) {
      const pair1 = pointPairs[i]
      const pair2 = pointPairs[j]
      if (
        options?.areConnectionsConnected(
          pair1.connectionName,
          pair2.connectionName,
        )
      )
        continue
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
        options?.areConnectionsConnected(
          pair1.connectionName,
          pair2.connectionName,
        )
      )
        continue

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
