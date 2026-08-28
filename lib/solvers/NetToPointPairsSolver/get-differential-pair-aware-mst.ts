import type {
  ConnectionPoint,
  DifferentialPair,
  PointKey,
  SimpleRouteConnection,
} from "lib/types"
import { getPointKey } from "lib/utils/getPointKey"
import { buildMinimumSpanningTree } from "./buildMinimumSpanningTree"

const REQUIRED_CONNECTION_EDGE_WEIGHT = 0

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
    PointKey,
    Map<PointKey, SimpleRouteConnection>
  >()
  const requiredEdges = requiredConnections.map((requiredConnection) => {
    const [from, to] = requiredConnection.pointsToConnect
    const fromPointKey = getPointKey(from!)
    const toPointKey = getPointKey(to!)
    let requiredConnectionsFromPoint =
      requiredConnectionByPointPair.get(fromPointKey)
    if (!requiredConnectionsFromPoint) {
      requiredConnectionsFromPoint = new Map<PointKey, SimpleRouteConnection>()
      requiredConnectionByPointPair.set(
        fromPointKey,
        requiredConnectionsFromPoint,
      )
    }
    requiredConnectionsFromPoint.set(toPointKey, requiredConnection)

    let requiredConnectionsToPoint =
      requiredConnectionByPointPair.get(toPointKey)
    if (!requiredConnectionsToPoint) {
      requiredConnectionsToPoint = new Map<PointKey, SimpleRouteConnection>()
      requiredConnectionByPointPair.set(toPointKey, requiredConnectionsToPoint)
    }
    requiredConnectionsToPoint.set(fromPointKey, requiredConnection)
    return {
      from: from!,
      to: to!,
      weight: REQUIRED_CONNECTION_EDGE_WEIGHT,
    }
  })
  const minimumSpanningTreeEdges = buildMinimumSpanningTree(
    connection.pointsToConnect,
    { extraEdges: [...options.extraEdges, ...requiredEdges] },
  )
  const requiredConnectionNames = new Set(
    requiredConnections.map((requiredConnection) => requiredConnection.name),
  )

  return {
    edges: minimumSpanningTreeEdges.map((edge) => {
      return {
        ...edge,
        requiredConnection: requiredConnectionByPointPair
          .get(getPointKey(edge.from))
          ?.get(getPointKey(edge.to)),
      }
    }),
    remainingRootConnectionNames: mergedRootConnectionNames.filter(
      (rootConnectionName) => !requiredConnectionNames.has(rootConnectionName),
    ),
  }
}
