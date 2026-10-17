import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type ConnectionName = string
type PcbPortId = string

/**
 * Restores stitched route endpoints to their authoritative PCB port positions
 * and marks them as fixed. Earlier geometric cleanup can slide an endpoint
 * within a pad's axis-aligned obstacle bounds, which is unsafe for a rotated
 * pad.
 */
export const lockHdRouteTerminals = ({
  hdRoutes,
  connections,
}: {
  hdRoutes: ReadonlyArray<HighDensityRoute>
  connections: ReadonlyArray<SimpleRouteConnection>
}): HighDensityRoute[] => {
  const connectionByName = new Map<ConnectionName, SimpleRouteConnection>(
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

    const terminalByPcbPortId = new Map<
      PcbPortId,
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
      hdRoute.startPcbPortId,
      hdRoute.endPcbPortId,
    ].filter((pcbPortId): pcbPortId is string => pcbPortId !== undefined)
    if (routeEndpointPcbPortIds.length === 0) return hdRoute

    const uniqueRouteEndpointPcbPortIds = new Set<PcbPortId>(
      routeEndpointPcbPortIds,
    )
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

    const startTerminal = hdRoute.startPcbPortId
      ? terminalByPcbPortId.get(hdRoute.startPcbPortId)
      : undefined
    const endTerminal = hdRoute.endPcbPortId
      ? terminalByPcbPortId.get(hdRoute.endPcbPortId)
      : undefined

    const route = hdRoute.route.flatMap((point, pointIndex) => {
      const interiorPoint = { ...point }
      delete interiorPoint.pcb_port_id
      if (pointIndex === 0 && startTerminal) {
        const lockedPoint = {
          ...point,
          x: startTerminal.x,
          y: startTerminal.y,
          pcb_port_id: startTerminal.pcb_port_id,
        }
        const next = hdRoute.route[1]
        if (
          next &&
          next.z !== point.z &&
          (point.x !== lockedPoint.x || point.y !== lockedPoint.y)
        ) {
          return [lockedPoint, interiorPoint]
        }
        return [lockedPoint]
      }
      if (pointIndex === hdRoute.route.length - 1 && endTerminal) {
        const lockedPoint = {
          ...point,
          x: endTerminal.x,
          y: endTerminal.y,
          pcb_port_id: endTerminal.pcb_port_id,
        }
        const previous = hdRoute.route[pointIndex - 1]
        if (
          previous &&
          previous.z !== point.z &&
          (point.x !== lockedPoint.x || point.y !== lockedPoint.y)
        ) {
          // Moving a terminal must not also move the via at that endpoint.
          return [interiorPoint, lockedPoint]
        }
        return [lockedPoint]
      }
      return [interiorPoint]
    })

    return { ...hdRoute, route }
  })
}
