import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"

const uniqueAvailableZ = (node: NodeWithPortPoints) => {
  if (node.availableZ?.length) {
    return [...new Set(node.availableZ)].sort((a, b) => a - b)
  }
  return [...new Set(node.portPoints.map((point) => point.z ?? 0))].sort(
    (a, b) => a - b,
  )
}

export const hasImpossibleSameLayerCrossingGeometry = (
  node: NodeWithPortPoints,
) =>
  uniqueAvailableZ(node).length === 1 &&
  getIntraNodeCrossingsUsingCircle(node).numSameLayerCrossings > 0

export const createInvalidSameLayerCrossingRoutes = (
  node: NodeWithPortPoints,
  traceThickness: number,
  viaDiameter: number,
): HighDensityIntraNodeRoute[] => {
  const pointsByConnection = new Map<string, PortPoint[]>()
  const [z] = uniqueAvailableZ(node)

  for (const portPoint of node.portPoints) {
    pointsByConnection.set(portPoint.connectionName, [
      ...(pointsByConnection.get(portPoint.connectionName) ?? []),
      portPoint,
    ])
  }

  return Array.from(pointsByConnection.entries()).flatMap(
    ([connectionName, points]) => {
      if (points.length < 2) return []
      const start = points[0]
      const end = points[points.length - 1]

      return [
        {
          connectionName,
          rootConnectionName: start.rootConnectionName,
          traceThickness,
          viaDiameter,
          route: [
            { x: start.x, y: start.y, z: z ?? start.z ?? 0 },
            { x: end.x, y: end.y, z: z ?? end.z ?? 0 },
          ],
          vias: [],
        },
      ]
    },
  )
}
