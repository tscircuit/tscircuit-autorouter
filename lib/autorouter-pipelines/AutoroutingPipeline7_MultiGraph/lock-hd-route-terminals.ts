import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

/**
 * Restores stitched route endpoints to their authoritative PCB port positions
 * and marks them as fixed. Earlier geometric cleanup can slide an endpoint
 * within a pad's axis-aligned obstacle bounds, which is unsafe for a rotated
 * pad.
 */
export const lockHdRouteTerminals = (
  hdRoutes: ReadonlyArray<HighDensityRoute>,
  connections: ReadonlyArray<SimpleRouteConnection>,
  terminalIdentityByConnectionName: ReadonlyMap<
    string,
    Pick<HighDensityRoute, "startPcbPortId" | "endPcbPortId">
  > = new Map(hdRoutes.map((route) => [route.connectionName, route])),
): HighDensityRoute[] => {
  const connectionByName = new Map(
    connections.map((connection) => [connection.name, connection]),
  )

  return hdRoutes.map((hdRoute) => {
    if (hdRoute.route.length === 0) {
      throw new Error(
        `Cannot lock PCB terminals for empty route "${hdRoute.connectionName}"`,
      )
    }

    const connection = connectionByName.get(hdRoute.connectionName)
    if (!connection) {
      throw new Error(
        `Cannot lock PCB terminals: connection "${hdRoute.connectionName}" was not found`,
      )
    }
    if (connection.pointsToConnect.length !== 2) {
      throw new Error(
        `Cannot lock PCB terminals for "${hdRoute.connectionName}": expected 2 connection points, found ${connection.pointsToConnect.length}`,
      )
    }

    const terminalIdentity =
      terminalIdentityByConnectionName.get(hdRoute.connectionName) ?? hdRoute
    const terminalByPcbPortId = new Map<
      string,
      (typeof connection.pointsToConnect)[number]
    >()
    for (const terminal of connection.pointsToConnect) {
      if (!terminal.pcb_port_id) continue
      if (terminalByPcbPortId.has(terminal.pcb_port_id)) {
        throw new Error(
          `Cannot lock duplicate PCB terminal "${terminal.pcb_port_id}" for "${hdRoute.connectionName}"`,
        )
      }
      terminalByPcbPortId.set(terminal.pcb_port_id, terminal)
    }
    if (terminalByPcbPortId.size === 0) return hdRoute

    const routeEndpointPcbPortIds = [
      terminalIdentity.startPcbPortId,
      terminalIdentity.endPcbPortId,
    ].filter((pcbPortId): pcbPortId is string => pcbPortId !== undefined)
    if (routeEndpointPcbPortIds.length === 0) return hdRoute

    const uniqueRouteEndpointPcbPortIds = new Set(routeEndpointPcbPortIds)
    if (
      uniqueRouteEndpointPcbPortIds.size !== routeEndpointPcbPortIds.length ||
      routeEndpointPcbPortIds.some(
        (pcbPortId) => !terminalByPcbPortId.has(pcbPortId),
      )
    ) {
      throw new Error(
        `Cannot lock PCB terminals for "${hdRoute.connectionName}": route endpoint IDs do not match connection terminal IDs`,
      )
    }

    const startTerminal = terminalIdentity.startPcbPortId
      ? terminalByPcbPortId.get(terminalIdentity.startPcbPortId)
      : undefined
    const endTerminal = terminalIdentity.endPcbPortId
      ? terminalByPcbPortId.get(terminalIdentity.endPcbPortId)
      : undefined

    const route = hdRoute.route.map((point, pointIndex) => {
      if (pointIndex === 0 && startTerminal) {
        return {
          ...point,
          x: startTerminal.x,
          y: startTerminal.y,
          pcb_port_id: startTerminal.pcb_port_id,
        }
      }
      if (pointIndex === hdRoute.route.length - 1 && endTerminal) {
        return {
          ...point,
          x: endTerminal.x,
          y: endTerminal.y,
          pcb_port_id: endTerminal.pcb_port_id,
        }
      }
      const interiorPoint = { ...point }
      delete interiorPoint.pcb_port_id
      return interiorPoint
    })

    return { ...hdRoute, route }
  })
}
