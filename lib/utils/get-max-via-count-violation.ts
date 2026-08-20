import type {
  SimpleRouteConnection,
  SimplifiedPcbTraces,
} from "lib/types"

export interface MaxViaCountViolation {
  connectionName: string
  actualViaCount: number
  maxViaCount: number
}

/** Return the first routed connection that exceeds its declared via limit. */
export const getMaxViaCountViolation = ({
  connections,
  routedConnections,
  traces,
}: {
  connections: readonly SimpleRouteConnection[]
  routedConnections?: readonly SimpleRouteConnection[]
  traces: SimplifiedPcbTraces
}): MaxViaCountViolation | null => {
  const viaCountByConnectionName = new Map<string, number>()
  for (const trace of traces) {
    const traceViaCount = trace.route.filter(
      (routePoint) => routePoint.route_type === "via",
    ).length
    const routedConnection = routedConnections
      ?.filter((connection) =>
        trace.pcb_trace_id.startsWith(`${connection.name}_`),
      )
      .sort((a, b) => b.name.length - a.name.length)[0]
    const rootConnectionNames =
      routedConnection?.__rootConnectionNames ?? [trace.connection_name]

    for (const connectionName of rootConnectionNames) {
      viaCountByConnectionName.set(
        connectionName,
        (viaCountByConnectionName.get(connectionName) ?? 0) + traceViaCount,
      )
    }
  }

  for (const connection of connections) {
    if (connection.maxViaCount === undefined) continue
    const actualViaCount = viaCountByConnectionName.get(connection.name) ?? 0
    if (actualViaCount <= connection.maxViaCount) continue

    return {
      connectionName: connection.name,
      actualViaCount,
      maxViaCount: connection.maxViaCount,
    }
  }

  return null
}
