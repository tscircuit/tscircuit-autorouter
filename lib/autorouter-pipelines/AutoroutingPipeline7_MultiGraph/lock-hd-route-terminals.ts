import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

/**
 * Finalizes generated routes by restoring authoritative PCB terminal positions,
 * deriving vias from layer transitions, and clearing stale same-layer segment
 * markers. Earlier geometric cleanup can slide an endpoint within a pad's
 * axis-aligned obstacle bounds, which is unsafe for a rotated pad.
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
    const routeEndpointPcbPortIds = [
      terminalIdentity.startPcbPortId,
      terminalIdentity.endPcbPortId,
    ].filter((pcbPortId): pcbPortId is string => pcbPortId !== undefined)
    let startTerminal: (typeof connection.pointsToConnect)[number] | undefined
    let endTerminal: (typeof connection.pointsToConnect)[number] | undefined
    if (terminalByPcbPortId.size > 0 && routeEndpointPcbPortIds.length > 0) {
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
      if (terminalIdentity.startPcbPortId) {
        startTerminal = terminalByPcbPortId.get(terminalIdentity.startPcbPortId)
      }
      if (terminalIdentity.endPcbPortId) {
        endTerminal = terminalByPcbPortId.get(terminalIdentity.endPcbPortId)
      }
    }

    const hasLockedTerminals =
      startTerminal !== undefined || endTerminal !== undefined
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
      if (hasLockedTerminals) delete interiorPoint.pcb_port_id
      return interiorPoint
    })

    const finalizedRoute = route.map((point, pointIndex, points) => {
      const finalizedPoint = { ...point }
      const nextPoint = points[pointIndex + 1]
      if (
        finalizedPoint.toNextSegmentType === "through_obstacle" &&
        (!nextPoint || finalizedPoint.z === nextPoint.z)
      ) {
        delete finalizedPoint.toNextSegmentType
      }
      return finalizedPoint
    })
    const vias: HighDensityRoute["vias"] = []
    for (
      let pointIndex = 0;
      pointIndex < finalizedRoute.length - 1;
      pointIndex++
    ) {
      const point = finalizedRoute[pointIndex]!
      const nextPoint = finalizedRoute[pointIndex + 1]!
      if (point.z === nextPoint.z) continue
      if (point.toNextSegmentType === "through_obstacle") continue
      vias.push({ x: point.x, y: point.y })
    }

    return { ...hdRoute, route: finalizedRoute, vias }
  })
}
