import type { DifferentialPair as RoutedDifferentialPair } from "@tscircuit/length-matching-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { ConnectionPoint, DifferentialPair, SimpleRouteConnection } from "lib/types/srj-types"
import { getPointKey } from "./getPointKey"

/** Resolve logical pair members to matching edges of their terminal trees. */
export function resolveDifferentialPairSegments({
  differentialPairs,
  connections,
  hdRoutes,
  pipelineName,
}: {
  differentialPairs: DifferentialPair[]
  connections: SimpleRouteConnection[]
  hdRoutes: HighDensityRoute[]
  pipelineName: string
}): RoutedDifferentialPair[] {
  return differentialPairs.flatMap((pair): RoutedDifferentialPair[] => {
    const label = `${pipelineName}: differential pair ${pair.connectionNames.join("/")}`
    const [positive, negative] = pair.connectionNames.map(
      (name): SimpleRouteConnection[] => connections.filter(
        (connection): boolean => connection.name === name ||
          connection.__rootConnectionNames?.includes(name) === true ||
          connection.__netConnectionName === name,
      ),
    ) as [SimpleRouteConnection[], SimpleRouteConnection[]]
    if (positive.length === 0 || positive.length !== negative.length)
      throw new Error(
        `${label} must decompose into the same non-zero number of corresponding segments, got ${positive.length} and ${negative.length}`,
      )
    for (const connection of [...positive, ...negative]) {
      if (connection.pointsToConnect.length !== 2)
        throw new Error(`${label}: "${connection.name}" is not a point-pair connection`)
    }

    const terminalMatches = new Map<string, string>()
    if (positive.length > 1) {
      const [positivePoints, negativePoints] = [positive, negative].map(
        (members): ConnectionPoint[] => [...new Map(members.flatMap(
          (member): [string, ConnectionPoint][] => member.pointsToConnect.map(
            (point): [string, ConnectionPoint] => [getPointKey(point), point],
          ),
        )).values()],
      ) as [ConnectionPoint[], ConnectionPoint[]]
      if (positivePoints.length !== negativePoints.length)
        throw new Error(`${label} does not have the same number of corresponding terminals`)
      const matchedNegativePoints = new Set<string>()
      for (const point of positivePoints) {
        // Selectors constrain ownership when present. Opaque pcb_port_id values
        // identify ports, but cannot establish P/N component correspondence.
        const candidates = negativePoints.filter(
          (other): boolean => !point.port_selector || !other.port_selector ||
            point.port_selector.split(".")[0] === other.port_selector.split(".")[0],
        ).map((other): { point: ConnectionPoint; distance: number } => ({
          point: other,
          distance: Math.hypot(point.x - other.x, point.y - other.y),
        })).sort((a, b): number => a.distance - b.distance)
        const closest = candidates[0]
        if (!closest ||
          (candidates[1] && Math.abs(candidates[1].distance - closest.distance) < 1e-6) ||
          matchedNegativePoints.has(getPointKey(closest.point)))
          throw new Error(
            `${label} has no unique corresponding terminal for "${point.port_selector ?? getPointKey(point)}"; supply component-qualified port_selector values or unambiguous terminal geometry`,
          )
        const negativeKey = getPointKey(closest.point)
        terminalMatches.set(getPointKey(point), negativeKey)
        matchedNegativePoints.add(negativeKey)
      }
    }

    const usedNegativeConnections = new Set<string>()
    return positive.map((positiveConnection): RoutedDifferentialPair => {
      const negativeMatches = positive.length === 1 ? negative : negative.filter(
        (connection): boolean => positiveConnection.pointsToConnect.every(
          (point): boolean => connection.pointsToConnect.some(
            (other): boolean => getPointKey(other) === terminalMatches.get(getPointKey(point)),
          ),
        ),
      )
      if (negativeMatches.length !== 1 || usedNegativeConnections.has(negativeMatches[0]!.name))
        throw new Error(
          `${label} has no unique corresponding segment for "${positiveConnection.name}"; the terminal trees must have matching topology`,
        )
      const negativeConnection = negativeMatches[0]!
      usedNegativeConnections.add(negativeConnection.name)
      const connectionNames: [string, string] = [positiveConnection.name, negativeConnection.name]
      if (connectionNames[0] === connectionNames[1])
        throw new Error(`${label} resolves both members to "${connectionNames[0]}"`)
      const pairRoutes = connectionNames.map((connectionName): HighDensityRoute => {
        const matchingRoutes = hdRoutes.filter(
          (route): boolean => route.connectionName === connectionName,
        )
        if (matchingRoutes.length !== 1)
          throw new Error(
            `${pipelineName}: differential pair connection "${connectionName}" must resolve to exactly one final HD route, got ${matchingRoutes.length}`,
          )
        return matchingRoutes[0]!
      })
      const resolvedPair: RoutedDifferentialPair = {
        connectionNames,
        lengthTolerance: pair.lengthTolerance,
      }
      if (pair.maxUncoupledLength !== undefined)
        resolvedPair.maxUncoupledLength = pair.maxUncoupledLength
      if (pair.traceGap !== undefined) {
        const centerlineDistance = pair.traceGap + pairRoutes.reduce(
          (total, route): number => total + route.traceThickness / 2,
          0,
        )
        resolvedPair.minimumCenterlineDistance = centerlineDistance
        resolvedPair.maximumCenterlineDistance = centerlineDistance
      }
      return resolvedPair
    })
  })
}
