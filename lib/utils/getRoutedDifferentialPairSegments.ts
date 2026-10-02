import type { DifferentialPair as RoutedDifferentialPair } from "@tscircuit/length-matching-solver"
import { distance } from "@tscircuit/math-utils"
import type { DifferentialPair, SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { orderPointPairChain } from "./orderPointPairChain"

export function getRoutedDifferentialPairSegments({
  differentialPairs,
  connections,
  hdRoutes,
}: {
  differentialPairs: DifferentialPair[]
  connections: SimpleRouteConnection[]
  hdRoutes: HighDensityRoute[]
}): RoutedDifferentialPair[] {
  return differentialPairs.flatMap((pair) => {
    const chains = pair.connectionNames.map((connectionName) =>
      orderPointPairChain(
        connections.filter(
          (connection) =>
            connection.name === connectionName ||
            connection.__rootConnectionNames?.includes(connectionName) ||
            connection.__netConnectionName === connectionName,
        ),
      ),
    )
    const [positive, negative] = chains
    if (
      !positive ||
      !negative ||
      positive.connections.length !== negative.connections.length
    )
      throw new Error(
        "Differential pair paths must have the same number of constrained segments",
      )
    const forwardDistance =
      distance(positive.start, negative.start) +
      distance(positive.end, negative.end)
    const reversedDistance =
      distance(positive.start, negative.end) +
      distance(positive.end, negative.start)
    if (positive.connections.length > 1 && forwardDistance === reversedDistance)
      throw new Error(
        "Differential pair path endpoint correspondence is ambiguous",
      )
    let negativeConnections = negative.connections
    if (reversedDistance < forwardDistance)
      negativeConnections = [...negativeConnections].reverse()

    return positive.connections.map((positiveConnection, segmentIndex) => {
      const negativeConnection = negativeConnections[segmentIndex]!
      if (positiveConnection === negativeConnection)
        throw new Error(
          "Differential pair members resolve to the same connection",
        )
      const connectionNames: [string, string] = [
        positiveConnection.name,
        negativeConnection.name,
      ]
      const pairRoutes = connectionNames.map((connectionName) => {
        const matchingRoutes = hdRoutes.filter(
          (route) => route.connectionName === connectionName,
        )
        if (matchingRoutes.length !== 1)
          throw new Error(
            `Differential pair connection "${connectionName}" requires exactly one routed segment`,
          )
        return matchingRoutes[0]!
      })
      // Per-segment budgets bound the sum over the entire declared pair.
      const resolvedPair: RoutedDifferentialPair = {
        connectionNames,
        lengthTolerance: pair.lengthTolerance / positive.connections.length,
      }
      if (pair.maxUncoupledLength !== undefined)
        resolvedPair.maxUncoupledLength =
          pair.maxUncoupledLength / positive.connections.length
      if (pair.traceGap !== undefined) {
        const centerlineDistance =
          pair.traceGap +
          pairRoutes.reduce(
            (halfWidthTotal, route) =>
              halfWidthTotal + route.traceThickness / 2,
            0,
          )
        resolvedPair.minimumCenterlineDistance = centerlineDistance
        resolvedPair.maximumCenterlineDistance = centerlineDistance
      }
      return resolvedPair
    })
  })
}
