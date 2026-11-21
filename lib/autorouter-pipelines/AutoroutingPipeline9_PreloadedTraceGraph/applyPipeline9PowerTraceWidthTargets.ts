import type { SimpleRouteConnection, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

export function applyPipeline9PowerTraceWidthTargets({
  connections,
  hdRoutes,
  routedTraces,
  widthTargets,
}: {
  connections: readonly SimpleRouteConnection[]
  hdRoutes: readonly HighDensityRoute[]
  routedTraces: SimplifiedPcbTraces
  widthTargets: ReadonlyMap<string, number>
}): void {
  const routeCountByConnectionName = new Map<string, number>()
  for (const { connectionName } of hdRoutes) {
    routeCountByConnectionName.set(
      connectionName,
      (routeCountByConnectionName.get(connectionName) ?? 0) + 1,
    )
  }

  // Conversion emits one trace per route, grouped in the input connection order.
  let traceIndex = 0
  for (const { name, pointsToConnect } of connections) {
    const routeCount = routeCountByConnectionName.get(name)
    if (!routeCount) continue

    const target = widthTargets.get(name)
    const portIds = pointsToConnect
      .map(({ pointId }) => pointId)
      .filter((pointId): pointId is string => Boolean(pointId))

    for (let index = 0; index < routeCount; index++) {
      const trace = routedTraces[traceIndex++]
      const tracePortIds = trace?.connectsTo
      if (
        !trace ||
        !tracePortIds ||
        tracePortIds.length !== portIds.length ||
        portIds.some((pointId, index) => tracePortIds[index] !== pointId)
      ) {
        throw new Error(`Converted route does not match connection "${name}"`)
      }
      if (target !== undefined) trace.nominalTraceWidth = target
    }
  }
  if (traceIndex !== routedTraces.length) {
    throw new Error("Converted route count does not match the input connections")
  }
}
