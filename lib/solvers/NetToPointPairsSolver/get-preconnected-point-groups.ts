import type {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"

const MIN_TRACE_ENDPOINT_MATCH_TOLERANCE = 0.001
type WireRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>

const getConnectionPointAtTraceEndpoint = (
  endpoint: WireRoutePoint,
  connectionPoints: ConnectionPoint[],
): ConnectionPoint | undefined => {
  const tolerance = Math.max(
    MIN_TRACE_ENDPOINT_MATCH_TOLERANCE,
    endpoint.width / 2,
  )
  let bestPoint: ConnectionPoint | undefined
  let bestPointUsesEndpointLayer = false
  let bestDistance = Infinity

  for (const point of connectionPoints) {
    const pointUsesEndpointLayer =
      "layers" in point
        ? point.layers.includes(endpoint.layer)
        : point.layer === endpoint.layer
    const pointDistance = Math.hypot(point.x - endpoint.x, point.y - endpoint.y)
    if (pointDistance > tolerance) continue
    if (
      !bestPoint ||
      (pointUsesEndpointLayer && !bestPointUsesEndpointLayer) ||
      (pointUsesEndpointLayer === bestPointUsesEndpointLayer &&
        pointDistance < bestDistance)
    ) {
      bestPoint = point
      bestPointUsesEndpointLayer = pointUsesEndpointLayer
      bestDistance = pointDistance
    }
  }

  return bestPoint
}

const getTraceConnectedPointGroups = (
  connection: SimpleRouteConnection,
  srj: SimpleRouteJson | undefined,
): ConnectionPoint[][] => {
  if (!srj?.traces?.length) return []

  const pointById = new Map(
    connection.pointsToConnect.flatMap((point) =>
      point.pointId ? [[point.pointId, point] as const] : [],
    ),
  )
  const routedTraceGroups: ConnectionPoint[][] = []
  const rootConnectionNames = new Set([
    connection.name,
    ...(connection.__rootConnectionNames ?? []),
  ])
  for (const trace of srj.traces) {
    const traceConnectsTo = trace.connectsTo ?? []
    if (traceConnectsTo.length > 0) {
      const connectedPointIds = traceConnectsTo.filter((connectsTo) =>
        pointById.has(connectsTo),
      )
      if (connectedPointIds.length >= 2) {
        routedTraceGroups.push(
          connectedPointIds.map((pointId) => pointById.get(pointId)!),
        )
      }
      continue
    }

    if (!rootConnectionNames.has(trace.connection_name)) continue

    // Some SRJs omit connectsTo on pre-routed traces, so infer the connected
    // point pair from route endpoints when the trace belongs to this net.
    const wireRoutePoints = trace.route.filter(
      (routePoint) => routePoint.route_type === "wire",
    )
    const startPoint = wireRoutePoints[0]
      ? getConnectionPointAtTraceEndpoint(
          wireRoutePoints[0],
          connection.pointsToConnect,
        )
      : undefined
    const endPoint = wireRoutePoints.at(-1)
      ? getConnectionPointAtTraceEndpoint(
          wireRoutePoints.at(-1)!,
          connection.pointsToConnect,
        )
      : undefined

    if (startPoint && endPoint && startPoint !== endPoint) {
      routedTraceGroups.push([startPoint, endPoint])
    }
  }

  return routedTraceGroups
}

export const getPreconnectedPointGroups = (
  connection: SimpleRouteConnection,
  srj?: SimpleRouteJson,
): ConnectionPoint[][] => {
  const pointById = new Map(
    connection.pointsToConnect.flatMap((point) =>
      point.pointId ? [[point.pointId, point] as const] : [],
    ),
  )
  const externalGroups = (connection.externallyConnectedPointIds ?? [])
    .map((group) =>
      group.flatMap((pointId) => {
        const point = pointById.get(pointId)
        return point ? [point] : []
      }),
    )
    .filter((group) => group.length >= 2)

  return [...externalGroups, ...getTraceConnectedPointGroups(connection, srj)]
}
