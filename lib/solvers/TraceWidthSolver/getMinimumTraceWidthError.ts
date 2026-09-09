import type { RootConnectionName, SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

export function getMinimumTraceWidthError({
  routes,
  connections,
}: {
  routes: HighDensityRoute[]
  connections: SimpleRouteConnection[]
}): string | null {
  const minimumWidths = new Map<RootConnectionName, number>()
  for (const connection of connections) {
    if (connection.minTraceWidth !== undefined) {
      minimumWidths.set(connection.name, connection.minTraceWidth)
    }
  }

  for (const route of routes) {
    const minTraceWidth =
      minimumWidths.get(route.connectionName) ??
      minimumWidths.get(route.rootConnectionName ?? route.connectionName)
    if (minTraceWidth === undefined) continue

    for (const point of route.route) {
      const traceWidth = point.traceThickness ?? route.traceThickness
      if (traceWidth < minTraceWidth) {
        return `Connection "${route.connectionName}" requires at least ${minTraceWidth}mm copper width, but the routed width is ${traceWidth}mm`
      }
    }
  }

  return null
}
