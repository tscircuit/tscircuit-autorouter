import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

const POSITION_EPSILON = 1e-6

const pointsCoincide = (
  left: { x: number; y: number },
  right: { x: number; y: number },
): boolean => Math.hypot(left.x - right.x, left.y - right.y) <= POSITION_EPSILON

/**
 * Reasserts the authoritative PCB terminal layer after route simplification.
 * A wrong-layer route island is joined to the terminal with a coincident via
 * transition instead of silently changing the layer of a nonzero-length
 * segment.
 */
export const lockPipeline9TerminalLayers = (
  hdRoutes: ReadonlyArray<HighDensityRoute>,
  connections: ReadonlyArray<SimpleRouteConnection>,
  layerCount: number,
): HighDensityRoute[] => {
  const connectionByName = new Map(
    connections.map((connection) => [connection.name, connection]),
  )

  return hdRoutes.map((hdRoute) => {
    const connection = connectionByName.get(hdRoute.connectionName)
    if (!connection || hdRoute.route.length === 0) return hdRoute

    const terminalByPcbPortId = new Map(
      connection.pointsToConnect.flatMap((terminal) =>
        terminal.pcb_port_id
          ? [
              [
                terminal.pcb_port_id,
                {
                  ...terminal,
                  z: mapLayerNameToZ(
                    getConnectionPointLayer(terminal),
                    layerCount,
                  ),
                },
              ] as const,
            ]
          : [],
      ),
    )
    const route = hdRoute.route.map((point) => ({ ...point }))
    const vias = hdRoute.vias.map((via) => ({ ...via }))
    const addVia = (point: { x: number; y: number }) => {
      if (!vias.some((via) => pointsCoincide(via, point))) {
        vias.push({ x: point.x, y: point.y })
      }
    }

    const start = route[0]
    const startTerminal = start?.pcb_port_id
      ? terminalByPcbPortId.get(start.pcb_port_id)
      : undefined
    if (start && startTerminal && start.z !== startTerminal.z) {
      const {
        pcb_port_id: startPcbPortId,
        toNextSegmentType,
        ...startWithoutIdentity
      } = start
      route.splice(
        0,
        1,
        {
          ...startWithoutIdentity,
          x: startTerminal.x,
          y: startTerminal.y,
          z: startTerminal.z,
          pcb_port_id: startPcbPortId,
        },
        {
          ...startWithoutIdentity,
          x: startTerminal.x,
          y: startTerminal.y,
          z: start.z,
          ...(toNextSegmentType ? { toNextSegmentType } : {}),
        },
      )
      addVia(startTerminal)
    }

    const end = route.at(-1)
    const endTerminal = end?.pcb_port_id
      ? terminalByPcbPortId.get(end.pcb_port_id)
      : undefined
    if (end && endTerminal && end.z !== endTerminal.z) {
      const {
        pcb_port_id: endPcbPortId,
        toNextSegmentType: _toNextSegmentType,
        ...endWithoutIdentity
      } = end
      route.splice(
        route.length - 1,
        1,
        {
          ...endWithoutIdentity,
          x: endTerminal.x,
          y: endTerminal.y,
          z: end.z,
        },
        {
          ...endWithoutIdentity,
          x: endTerminal.x,
          y: endTerminal.y,
          z: endTerminal.z,
          pcb_port_id: endPcbPortId,
        },
      )
      addVia(endTerminal)
    }

    return { ...hdRoute, route, vias }
  })
}
