import type {
  ConnectionPoint,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import { getConnectionPointLayers } from "lib/types"

type TraceEndpoint = {
  x: number
  y: number
  layers: string[]
}

const ENDPOINT_MATCH_TOLERANCE = 1e-3

const getTraceEndpoint = (
  trace: SimplifiedPcbTrace,
  endpointIndex: 0 | 1,
): TraceEndpoint | null => {
  const routePoint =
    endpointIndex === 0 ? trace.route[0] : trace.route[trace.route.length - 1]
  if (!routePoint || !("x" in routePoint) || !("y" in routePoint)) {
    return null
  }

  const layers =
    routePoint.route_type === "via"
      ? [routePoint.from_layer, routePoint.to_layer]
      : routePoint.route_type === "wire"
        ? [routePoint.layer]
        : []
  return { x: routePoint.x, y: routePoint.y, layers }
}

const doesConnectionPointMatchEndpoint = (
  point: ConnectionPoint,
  endpoint: TraceEndpoint,
  connectionName: string,
  srj: SimpleRouteJson,
): boolean => {
  if (
    Math.abs(point.x - endpoint.x) > ENDPOINT_MATCH_TOLERANCE ||
    Math.abs(point.y - endpoint.y) > ENDPOINT_MATCH_TOLERANCE
  ) {
    return false
  }

  const pointIds = [point.pointId, point.pcb_port_id].filter(
    (pointId): pointId is string => pointId !== undefined,
  )
  const pointLayers = new Set(getConnectionPointLayers(point))
  for (const obstacle of srj.obstacles) {
    if (
      Math.abs(obstacle.center.x - point.x) > ENDPOINT_MATCH_TOLERANCE ||
      Math.abs(obstacle.center.y - point.y) > ENDPOINT_MATCH_TOLERANCE
    ) {
      continue
    }
    const connectedTo = obstacle.connectedTo ?? []
    if (
      !connectedTo.includes(connectionName) &&
      !pointIds.some((pointId) => connectedTo.includes(pointId))
    ) {
      continue
    }
    for (const layer of obstacle.layers) {
      pointLayers.add(layer)
    }
  }

  return endpoint.layers.some((layer) => pointLayers.has(layer))
}

export const inferPreloadedTraceConnectivity = (
  srj: SimpleRouteJson,
): SimpleRouteJson => {
  if (srj.traces === undefined) {
    return srj
  }

  const connectionsByName = new Map(
    srj.connections.map((connection) => [connection.name, connection]),
  )
  const traces = srj.traces.map((trace) => {
    const connection = connectionsByName.get(trace.connection_name)
    const endpoints = [
      getTraceEndpoint(trace, 0),
      getTraceEndpoint(trace, 1),
    ].filter((endpoint): endpoint is TraceEndpoint => endpoint !== null)
    const inferredPointIds =
      connection?.pointsToConnect
        .filter((point) =>
          endpoints.some((endpoint) =>
            doesConnectionPointMatchEndpoint(
              point,
              endpoint,
              trace.connection_name,
              srj,
            ),
          ),
        )
        .map((point) => point.pointId)
        .filter((pointId): pointId is string => pointId !== undefined) ?? []

    return {
      ...trace,
      connectsTo: [
        ...new Set([...(trace.connectsTo ?? []), ...inferredPointIds]),
      ],
    }
  })

  return { ...srj, traces }
}
