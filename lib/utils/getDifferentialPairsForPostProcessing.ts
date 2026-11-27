import type {
  DifferentialPair,
  LengthMatchingPair,
} from "@tscircuit/length-matching-solver"
import type { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import {
  type ConnectionPoint,
  type SimpleRouteConnection,
  type SimpleRouteJson,
  getConnectionPointLayers,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

function getConnectionPointVertexKey(point: ConnectionPoint): string {
  if (point.pointId) return `id:${point.pointId}`
  const layers = [...getConnectionPointLayers(point)].sort().join(",")
  return `xy:${point.x.toFixed(6)},${point.y.toFixed(6)}:${layers}`
}

/**
 * Resolves an ordered multi-hop MST chain when a two-terminal differential pair
 * member shares its net with additional points (such as a termination resistor).
 * Returns null if no simple path exists or multiple ambiguous paths exist.
 */
function findUniqueSimplePathBetweenEndpoints({
  endpoints,
  pointPairConnections,
}: {
  endpoints: [ConnectionPoint, ConnectionPoint]
  pointPairConnections: SimpleRouteConnection[]
}): [string, ...string[]] | null {
  const startKey = getConnectionPointVertexKey(endpoints[0])
  const endKey = getConnectionPointVertexKey(endpoints[1])
  if (startKey === endKey) return null

  const adjacency = new Map<
    string,
    Array<{ neighborKey: string; connectionName: string }>
  >()
  for (const pairConnection of pointPairConnections) {
    if (pairConnection.pointsToConnect.length !== 2) return null
    const fromKey = getConnectionPointVertexKey(
      pairConnection.pointsToConnect[0]!,
    )
    const toKey = getConnectionPointVertexKey(
      pairConnection.pointsToConnect[1]!,
    )
    const fromEdges = adjacency.get(fromKey) ?? []
    fromEdges.push({ neighborKey: toKey, connectionName: pairConnection.name })
    adjacency.set(fromKey, fromEdges)
    const toEdges = adjacency.get(toKey) ?? []
    toEdges.push({ neighborKey: fromKey, connectionName: pairConnection.name })
    adjacency.set(toKey, toEdges)
  }

  const foundPaths: string[][] = []
  const visitedVertices = new Set<string>([startKey])
  const activePath: string[] = []

  const search = (vertexKey: string): void => {
    if (foundPaths.length > 1) return
    if (vertexKey === endKey) {
      foundPaths.push([...activePath])
      return
    }
    for (const edge of adjacency.get(vertexKey) ?? []) {
      if (visitedVertices.has(edge.neighborKey)) continue
      visitedVertices.add(edge.neighborKey)
      activePath.push(edge.connectionName)
      search(edge.neighborKey)
      activePath.pop()
      visitedVertices.delete(edge.neighborKey)
    }
  }

  search(startKey)
  if (foundPaths.length !== 1 || foundPaths[0]!.length === 0) return null
  return foundPaths[0] as [string, ...string[]]
}

/** Consume emitted path hops; retain main's alias lookup for legacy members. */
export const getDifferentialPairsForPostProcessing = ({
  srj,
  pointPairConnections,
  pathHopsByConnectionName,
  hdRoutes,
  pipelineName,
}: {
  srj: SimpleRouteJson
  pointPairConnections: SimpleRouteConnection[]
  pathHopsByConnectionName: NetToPointPairsSolver["pathHopsByConnectionName"]
  hdRoutes: HighDensityRoute[]
  pipelineName?: string
}): {
  differentialPairs: DifferentialPair[]
  differentialPairLanes: LengthMatchingPair[]
} => {
  const errorPrefix = pipelineName
    ? `${pipelineName}: differential pair`
    : "Differential pair"
  const getHopNames = (connectionName: string): [string, ...string[]] => {
    const connection = srj.connections.find((c) => c.name === connectionName)
    if (connection?.path) {
      if (connection.path.length < 2)
        throw new Error(
          `${errorPrefix} connection "${connectionName}" needs at least two path points`,
        )
      const hops = pathHopsByConnectionName.get(connectionName)
      if (!hops)
        throw new Error(
          `${errorPrefix} connection "${connectionName}" hop ${connection.path[0]} -> ${connection.path[1]} is missing from NetToPointPairsSolver output`,
        )
      return hops.map((hop) => {
        if (hop.emittedConnectionName === undefined)
          throw new Error(
            `${errorPrefix} connection "${connectionName}" hop ${hop.fromPointId} -> ${hop.toPointId} is missing from NetToPointPairsSolver output`,
          )
        return hop.emittedConnectionName
      }) as [string, ...string[]]
    }
    // Two-terminal connections without paths keep main's alias resolution,
    // including older SRJ inputs whose terminals do not have point IDs.
    const matches = pointPairConnections.filter(
      (c) =>
        c.name === connectionName ||
        c.__rootConnectionNames?.includes(connectionName) ||
        c.__netConnectionName === connectionName,
    )
    if (matches.length === 1) return [matches[0]!.name]
    if (matches.length > 1 && connection?.pointsToConnect.length === 2) {
      const uniquePath = findUniqueSimplePathBetweenEndpoints({
        endpoints: [
          connection.pointsToConnect[0]!,
          connection.pointsToConnect[1]!,
        ],
        pointPairConnections: matches,
      })
      if (uniquePath) return uniquePath
    }
    throw new Error(
      `${errorPrefix} connection "${connectionName}" must resolve to exactly one final point-pair connection, got ${matches.length}`,
    )
  }
  const differentialPairs: DifferentialPair[] = []
  const differentialPairLanes: LengthMatchingPair[] = []
  for (const pair of srj.differentialPairs ?? []) {
    const positiveHops = getHopNames(pair.connectionNames[0])
    const negativeHops = getHopNames(pair.connectionNames[1])
    if (positiveHops.length !== negativeHops.length)
      throw new Error(
        `${errorPrefix} ${pair.connectionNames.join("/")} paths have different numbers of hops`,
      )
    if (
      new Set([...positiveHops, ...negativeHops]).size !==
      positiveHops.length + negativeHops.length
    )
      throw new Error(
        `${errorPrefix} ${pair.connectionNames.join("/")} must have distinct lane hops`,
      )
    const pairRoutes = [...positiveHops, ...negativeHops].map((name) => {
      const routes = hdRoutes.filter((route) => route.connectionName === name)
      if (routes.length !== 1)
        throw new Error(
          `${errorPrefix} connection "${name}" must resolve to exactly one final HD route, got ${routes.length}`,
        )
      return routes[0]!
    })
    if (positiveHops.length > 1) {
      differentialPairLanes.push({
        connectionNames: [positiveHops, negativeHops],
        lengthTolerance: pair.lengthTolerance,
      })
      continue
    }
    const resolvedPair: DifferentialPair = {
      connectionNames: [positiveHops[0], negativeHops[0]],
      lengthTolerance: pair.lengthTolerance,
    }
    if (pair.maxUncoupledLength !== undefined)
      resolvedPair.maxUncoupledLength = pair.maxUncoupledLength
    if (pair.traceGap !== undefined) {
      const centerlineDistance =
        pair.traceGap +
        pairRoutes.reduce((total, route) => total + route.traceThickness / 2, 0)
      resolvedPair.minimumCenterlineDistance = centerlineDistance
      resolvedPair.maximumCenterlineDistance = centerlineDistance
    }
    differentialPairs.push(resolvedPair)
  }
  return { differentialPairs, differentialPairLanes }
}
