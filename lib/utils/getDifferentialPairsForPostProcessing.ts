import type {
  DifferentialPair,
  LengthMatchingPair,
} from "@tscircuit/length-matching-solver"
import type { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

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
    if (matches.length !== 1)
      throw new Error(
        `${errorPrefix} connection "${connectionName}" must resolve to exactly one final point-pair connection, got ${matches.length}`,
      )
    return [matches[0]!.name]
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
