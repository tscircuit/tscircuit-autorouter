import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import {
  getPortPointPairsFromNodeWithPortPoints,
  getPortPointsFromNodeWithPortPoints,
} from "lib/utils/getPortPointsFromNodeWithPortPoints"

const uniqueAvailableZ = (node: NodeWithPortPoints) => {
  if (node.availableZ?.length) {
    return [...new Set(node.availableZ)].sort((a, b) => a - b)
  }
  return [
    ...new Set(
      getPortPointsFromNodeWithPortPoints(node).map((point) => point.z ?? 0),
    ),
  ].sort((a, b) => a - b)
}

export const hasImpossibleSameLayerCrossingGeometry = (
  node: NodeWithPortPoints,
) =>
  uniqueAvailableZ(node).length === 1 &&
  getIntraNodeCrossingsUsingCircle(node).numSameLayerCrossings > 0

export const createInvalidDirectConnectionRoutes = (
  node: NodeWithPortPoints,
  traceThickness: number,
  viaDiameter: number,
): HighDensityIntraNodeRoute[] => {
  const [z] = uniqueAvailableZ(node)

  return getPortPointPairsFromNodeWithPortPoints(node).map(([start, end]) => ({
    connectionName: start.connectionName,
    rootConnectionName: start.rootConnectionName ?? end.rootConnectionName,
    traceThickness,
    viaDiameter,
    route: [
      { x: start.x, y: start.y, z: z ?? start.z ?? 0 },
      { x: end.x, y: end.y, z: z ?? end.z ?? 0 },
    ],
    vias: [],
  }))
}

export const createInvalidSameLayerCrossingRoutes =
  createInvalidDirectConnectionRoutes
