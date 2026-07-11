import type {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { getConnectionPointLayers } from "lib/types/srj-types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

const ENDPOINT_IDENTITY_TOLERANCE = 1e-6

type RoutePoint = HighDensityRoute["route"][number]

type EndpointIdentitySrj = Pick<
  SimpleRouteJson,
  "connections" | "layerCount" | "obstacles"
>

const pointHasExactTerminalCoordinates = (
  point: RoutePoint,
  terminal: ConnectionPoint,
): boolean => {
  return (
    Math.abs(point.x - terminal.x) <= ENDPOINT_IDENTITY_TOLERANCE &&
    Math.abs(point.y - terminal.y) <= ENDPOINT_IDENTITY_TOLERANCE
  )
}

const pointIsInsideTerminalObstacle = (
  srj: EndpointIdentitySrj,
  point: RoutePoint,
  terminal: ConnectionPoint,
  connection: SimpleRouteConnection,
  allowConnectionIdentity: boolean,
): boolean => {
  const terminalIds = [terminal.pcb_port_id, terminal.pointId].filter(
    (terminalId): terminalId is string => terminalId !== undefined,
  )
  const connectedIds = [
    ...terminalIds,
    ...(allowConnectionIdentity
      ? [connection.name, connection.rootConnectionName].filter(
          (connectionId): connectionId is string => connectionId !== undefined,
        )
      : []),
  ]
  if (connectedIds.length === 0) return false

  return srj.obstacles.some((obstacle) => {
    const supportsLayer =
      obstacle.zLayers?.includes(point.z) ??
      obstacle.layers.some(
        (layerName) => mapLayerNameToZ(layerName, srj.layerCount) === point.z,
      )
    const containsPoint =
      Math.abs(point.x - obstacle.center.x) <=
        obstacle.width / 2 + ENDPOINT_IDENTITY_TOLERANCE &&
      Math.abs(point.y - obstacle.center.y) <=
        obstacle.height / 2 + ENDPOINT_IDENTITY_TOLERANCE
    return (
      supportsLayer &&
      containsPoint &&
      connectedIds.some((connectedId) =>
        obstacle.connectedTo.includes(connectedId),
      )
    )
  })
}

const pointMatchesTerminal = (
  point: RoutePoint,
  terminal: ConnectionPoint,
  connection: SimpleRouteConnection,
  srj: EndpointIdentitySrj,
): boolean => {
  const hasExactCoordinates = pointHasExactTerminalCoordinates(point, terminal)
  const terminalDirectlySupportsLayer = getConnectionPointLayers(terminal).some(
    (layerName) => mapLayerNameToZ(layerName, srj.layerCount) === point.z,
  )
  return (
    (hasExactCoordinates && terminalDirectlySupportsLayer) ||
    pointIsInsideTerminalObstacle(
      srj,
      point,
      terminal,
      connection,
      hasExactCoordinates,
    )
  )
}

const getAuthoritativeTerminal = (params: {
  route: HighDensityRoute
  point: RoutePoint
  pointIndex: number
  connection: SimpleRouteConnection
  srj: EndpointIdentitySrj
}): ConnectionPoint => {
  const exactCoordinateTerminals = params.connection.pointsToConnect.filter(
    (terminal) => pointHasExactTerminalCoordinates(params.point, terminal),
  )
  let matches = exactCoordinateTerminals.filter((terminal) =>
    pointMatchesTerminal(params.point, terminal, params.connection, params.srj),
  )
  if (matches.length === 0) {
    matches = params.connection.pointsToConnect.filter((terminal) =>
      pointMatchesTerminal(
        params.point,
        terminal,
        params.connection,
        params.srj,
      ),
    )
  }

  if (params.point.pcb_port_id !== undefined) {
    matches = matches.filter(
      (terminal) => terminal.pcb_port_id === params.point.pcb_port_id,
    )
  }
  if (params.point.pointId !== undefined) {
    matches = matches.filter(
      (terminal) => terminal.pointId === params.point.pointId,
    )
  }

  if (matches.length !== 1) {
    const endpointName =
      params.pointIndex === 0
        ? "start"
        : params.pointIndex === params.route.route.length - 1
          ? "end"
          : `point ${params.pointIndex}`
    throw new Error(
      `Cannot attach authoritative identity to ${endpointName} of route "${params.route.connectionName}": expected exactly one matching terminal at (${params.point.x}, ${params.point.y}, z${params.point.z}), found ${matches.length}`,
    )
  }

  return matches[0]!
}

const getConnectionsByName = (
  connections: SimpleRouteConnection[],
): Map<string, SimpleRouteConnection> => {
  const connectionsByName = new Map<string, SimpleRouteConnection>()
  for (const connection of connections) {
    if (connectionsByName.has(connection.name)) {
      throw new Error(
        `Cannot attach route endpoint identities: duplicate connection name "${connection.name}"`,
      )
    }
    connectionsByName.set(connection.name, connection)
  }
  return connectionsByName
}

/**
 * Restores authoritative terminal identities after geometric route processing.
 * Global DRC repair uses pcb_port_id to keep physical terminals immovable.
 */
export const attachRouteEndpointIdentities = (
  srj: EndpointIdentitySrj,
  hdRoutes: readonly HighDensityRoute[],
): HighDensityRoute[] => {
  const connectionsByName = getConnectionsByName(srj.connections)

  return hdRoutes.map((route) => {
    const connection = connectionsByName.get(route.connectionName)
    if (!connection) {
      throw new Error(
        `Cannot attach route endpoint identities: route "${route.connectionName}" has no matching connection`,
      )
    }
    if (connection.pointsToConnect.length !== 2) {
      throw new Error(
        `Cannot attach route endpoint identities for "${route.connectionName}": expected a point-pair connection, found ${connection.pointsToConnect.length} terminals`,
      )
    }
    if (route.route.length === 0) {
      throw new Error(
        `Cannot attach route endpoint identities: route "${route.connectionName}" is empty`,
      )
    }

    const routePoints = route.route.map((point) => ({ ...point }))
    const endpointIndexes = new Set([0, routePoints.length - 1])
    for (const pointIndex of endpointIndexes) {
      const point = routePoints[pointIndex]!
      const terminal = getAuthoritativeTerminal({
        route,
        point,
        pointIndex,
        connection,
        srj,
      })
      routePoints[pointIndex] = {
        ...point,
        pointId: terminal.pointId,
        pcb_port_id: terminal.pcb_port_id,
      }
    }

    return { ...route, route: routePoints }
  })
}
