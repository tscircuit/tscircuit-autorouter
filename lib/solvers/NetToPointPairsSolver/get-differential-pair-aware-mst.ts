import type {
  ConnectionPoint,
  DifferentialPair,
  SimpleRouteConnection,
} from "lib/types"
import { getPointKey } from "lib/utils/getPointKey"
import { buildMinimumSpanningTree } from "./buildMinimumSpanningTree"

type WeightedEdge = {
  from: ConnectionPoint
  to: ConnectionPoint
  weight: number
}

type DifferentialPairAwareMstEdge = WeightedEdge & {
  requiredConnection?: SimpleRouteConnection
}

export const getDifferentialPairAwareMst = (
  connection: SimpleRouteConnection,
  options: {
    originalConnections: SimpleRouteConnection[]
    differentialPairs: DifferentialPair[]
    extraEdges: WeightedEdge[]
  },
): {
  edges: DifferentialPairAwareMstEdge[]
  remainingRootConnectionNames: string[]
} => {
  const mergedRootConnectionNames = connection.__rootConnectionNames ?? [
    connection.name,
  ]
  const differentialPairConnectionNames = new Set(
    options.differentialPairs.flatMap((pair) => pair.connectionNames),
  )
  const requiredConnections = options.originalConnections.filter(
    (originalConnection) =>
      differentialPairConnectionNames.has(originalConnection.name) &&
      mergedRootConnectionNames.includes(originalConnection.name) &&
      originalConnection.pointsToConnect.length === 2,
  )
  const requiredConnectionByPointPair = new Map<
    string,
    SimpleRouteConnection
  >()
  const requiredEdges = requiredConnections.map((requiredConnection) => {
    const [from, to] = requiredConnection.pointsToConnect
    const pointPairKey = [getPointKey(from!), getPointKey(to!)]
      .sort()
      .join("|")
    requiredConnectionByPointPair.set(pointPairKey, requiredConnection)
    return { from: from!, to: to!, weight: 0 }
  })
  const minimumSpanningTreeEdges = buildMinimumSpanningTree(
    connection.pointsToConnect,
    { extraEdges: [...options.extraEdges, ...requiredEdges] },
  )
  const requiredConnectionNames = new Set(
    requiredConnections.map(
      (requiredConnection) => requiredConnection.name,
    ),
  )

  return {
    edges: minimumSpanningTreeEdges.map((edge) => {
      const pointPairKey = [getPointKey(edge.from), getPointKey(edge.to)]
        .sort()
        .join("|")
      return {
        ...edge,
        requiredConnection:
          requiredConnectionByPointPair.get(pointPairKey),
      }
    }),
    remainingRootConnectionNames: mergedRootConnectionNames.filter(
      (rootConnectionName) =>
        !requiredConnectionNames.has(rootConnectionName),
    ),
  }
}
