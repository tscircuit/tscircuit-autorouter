import {
  getConnectionPointLayers,
  type SimpleRouteConnection,
} from "lib/types/srj-types"
import type { inspectTraceContinuity } from "./checkTraceContinuity"

type RoutingTarget = {
  x: number
  y: number
  layers: string[]
  copperIds: string[]
}

/** A partial routing job may end at a requested coordinate without a component
 * pad. Check those obligations against the same copper islands as board DRC. */
export function checkRoutedTraceEndpoints(
  board: ReturnType<typeof inspectTraceContinuity>,
  connections: SimpleRouteConnection[],
): Record<string, unknown>[] {
  const errors: Record<string, unknown>[] = []
  const points = new Map<string, RoutingTarget>()
  for (const connection of connections) {
    for (const point of connection.pointsToConnect) {
      const id = point.pointId
      if (
        !id ||
        point.pcb_port_id ||
        board.portsById.has(id) ||
        ("terminalVia" in point && point.terminalVia) ||
        points.has(id)
      )
        continue
      const layers = getConnectionPointLayers(point)
      points.set(id, {
        x: point.x,
        y: point.y,
        layers,
        copperIds: board.copperAt(point, layers),
      })
    }
  }
  for (const [source, trace] of board.firstTraceBySource) {
    for (const pointId of source.connected_source_net_ids ?? []) {
      const point = points.get(pointId)
      if (!point || board.reaches(trace.pcb_trace_id, point.copperIds)) continue
      errors.push({
        type: "pcb_trace_error",
        error_type: "pcb_trace_error",
        source_trace_id: source.source_trace_id,
        pcb_trace_id: trace.pcb_trace_id,
        pcb_component_ids: [],
        message: `Trace [${source.source_trace_id}] is missing a connection to routing point ${pointId}`,
        pcb_trace_error_id: `missing_connection_${trace.pcb_trace_id}_${pointId}`,
        center: { x: point.x, y: point.y },
        pcb_port_ids: [],
      })
    }
  }
  for (const end of board.openEnds) {
    const { trace, point, sourceTrace } = end
    const atRequestedPoint = sourceTrace?.connected_source_net_ids?.some((id) => {
      const target = points.get(id)
      return (
        target?.copperIds.includes(trace.pcb_trace_id) &&
        target.layers.includes(point.layer) &&
        Math.hypot(point.x - target.x, point.y - target.y) <= point.width / 2
      )
    })
    if (!atRequestedPoint) errors.push(board.disconnectedEndpointError(end))
  }
  return errors
}
