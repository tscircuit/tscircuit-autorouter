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
): HighDensityRoute[] => {
  const connectionByName = new Map(
    connections.map((connection) => [connection.name, connection]),
  )

  return hdRoutes.map((hdRoute) => {
    if (hdRoute.route.length === 0) return hdRoute

    const connection = connectionByName.get(hdRoute.connectionName)
    if (!connection || connection.pointsToConnect.length !== 2) return hdRoute

    const firstRoutePoint = hdRoute.route[0]!
    const lastRoutePoint = hdRoute.route[hdRoute.route.length - 1]!
    const [firstConnectionPoint, secondConnectionPoint] =
      connection.pointsToConnect
    const directDistance =
      Math.hypot(
        firstRoutePoint.x - firstConnectionPoint!.x,
        firstRoutePoint.y - firstConnectionPoint!.y,
      ) +
      Math.hypot(
        lastRoutePoint.x - secondConnectionPoint!.x,
        lastRoutePoint.y - secondConnectionPoint!.y,
      )
    const reversedDistance =
      Math.hypot(
        firstRoutePoint.x - secondConnectionPoint!.x,
        firstRoutePoint.y - secondConnectionPoint!.y,
      ) +
      Math.hypot(
        lastRoutePoint.x - firstConnectionPoint!.x,
        lastRoutePoint.y - firstConnectionPoint!.y,
      )
    const [startTerminal, endTerminal] =
      directDistance <= reversedDistance
        ? [firstConnectionPoint!, secondConnectionPoint!]
        : [secondConnectionPoint!, firstConnectionPoint!]

    const startPcbPortId = startTerminal.pcb_port_id
    const endPcbPortId = endTerminal.pcb_port_id

    if (!startPcbPortId && !endPcbPortId) return hdRoute

    const route = hdRoute.route.map((point, pointIndex) => {
      if (pointIndex === 0 && startPcbPortId) {
        return {
          ...point,
          x: startTerminal.x,
          y: startTerminal.y,
          pcb_port_id: startPcbPortId,
        }
      }
      if (pointIndex === hdRoute.route.length - 1 && endPcbPortId) {
        return {
          ...point,
          x: endTerminal.x,
          y: endTerminal.y,
          pcb_port_id: endPcbPortId,
        }
      }
      return point
    })

    return { ...hdRoute, route }
  })
}
