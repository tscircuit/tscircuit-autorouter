import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getPowerTraceExpansionConnectionNames } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/getPowerTraceExpansionConnectionNames"

const resolveFinalConnectionNames = (
  connectionName: string,
  finalConnectionNames: ReadonlySet<string>,
  finalRoutes: ReadonlyArray<HighDensityRoute>,
): string[] =>
  [...finalConnectionNames].filter(
    (name) =>
      name === connectionName ||
      finalRoutes.some(
        (route) =>
          route.connectionName === name &&
          (route.rootConnectionName === connectionName ||
            route.connectionName === connectionName),
      ),
  )

/** Returns connections that the first final optimization pass must leave inert. */
export const getProtectedConnectionNames = ({
  originalSrj,
  hdRoutes,
}: {
  originalSrj: SimpleRouteJson
  hdRoutes: ReadonlyArray<HighDensityRoute>
}): Set<string> => {
  const finalConnectionNames = new Set(
    hdRoutes.map((route) => route.connectionName),
  )
  const protectedNames = new Set<string>()

  for (const pair of originalSrj.differentialPairs ?? []) {
    for (const connectionName of pair.connectionNames) {
      for (const name of resolveFinalConnectionNames(
        connectionName,
        finalConnectionNames,
        hdRoutes,
      )) {
        protectedNames.add(name)
      }
    }
  }
  for (const connection of originalSrj.connections) {
    if (!connection.pointsToConnect.some((point) => "terminalVia" in point)) {
      continue
    }
    for (const name of resolveFinalConnectionNames(
      connection.name,
      finalConnectionNames,
      hdRoutes,
    )) {
      protectedNames.add(name)
    }
  }
  for (const connectionName of getPowerTraceExpansionConnectionNames(originalSrj)) {
    for (const name of resolveFinalConnectionNames(
      connectionName,
      finalConnectionNames,
      hdRoutes,
    )) {
      protectedNames.add(name)
    }
  }
  for (const trace of originalSrj.traces ?? []) {
    for (const name of resolveFinalConnectionNames(
      trace.connection_name,
      finalConnectionNames,
      hdRoutes,
    )) {
      protectedNames.add(name)
    }
  }

  return protectedNames
}
