import { segmentToBoxMinDistance, segmentToCircleMinDistance } from "@tscircuit/math-utils"
import type { PcbTraceError } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type Point = { x: number; y: number }
export type CopperPourTraceError = PcbTraceError & Record<string, unknown> & { center: Point; pcb_trace_ids: string[] }
type CopperPourTraceEvaluator = (traces: readonly SimplifiedPcbTrace[]) => CopperPourTraceError[]

/** Compile real pour reservations separately from the repair engine's pad index. */
export const createCopperPourTraceEvaluator = (
  srj: SimpleRouteJson,
  traceClearance: number,
  _connMap?: ConnectivityMap,
): CopperPourTraceEvaluator => {
  const pours = srj.obstacles.flatMap((obstacle, index) =>
    obstacle.isCopperPour ? [{ obstacle, id: obstacle.obstacleId ?? `copper_pour_${index}` }] : [],
  )
  if (pours.length === 0) return () => []
  if (!Number.isFinite(traceClearance) || traceClearance < 0)
    throw new Error("Copper-pour trace clearance must be finite and non-negative")
  // Repair planning can merge its connectivity map and rewrite output metadata.
  // Only the native source declarations can grant ownership of reserved copper.
  const connectivity = getConnectivityMapFromSimpleRouteJson(srj)
  for (const connection of srj.connections) {
    if (connection.source_trace_id) {
      connectivity.addConnections([[connection.name, connection.source_trace_id]])
    }
  }
  const reservations = pours.map(({ obstacle, id }) => {
    const rotation = obstacle.ccwRotationDegrees ?? 0
    if (![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height, rotation].every(Number.isFinite) || obstacle.width <= 0 || obstacle.height <= 0)
      throw new Error(`Invalid copper-pour reservation geometry "${id}"`)
    const radians = rotation * Math.PI / 180
    return {
      obstacle, id, cosine: Math.cos(radians), sine: Math.sin(radians),
      nets: new Set(obstacle.connectedTo.map(name => connectivity.getNetConnectedToId(name) ?? name)),
    }
  })
  return (traces): CopperPourTraceError[] => {
    const errors: CopperPourTraceError[] = []
    for (const trace of traces) {
      const traceNet = connectivity.getNetConnectedToId(trace.connection_name)
      for (let pointIndex = 0; pointIndex + 1 < trace.route.length; pointIndex++) {
        const start = trace.route[pointIndex]!
        const end = trace.route[pointIndex + 1]!
        // Manufactured through vias have native antipads. Only lateral copper
        // on the reserved layer can short the foreign plane.
        if (start.route_type !== "wire" || end.route_type !== "wire" || start.layer !== end.layer) continue
        const radius = Math.max(start.width, end.width) / 2
        if (![start.x, start.y, end.x, end.y, radius].every(Number.isFinite) || radius <= 0)
          throw new Error(`Invalid wire geometry in pcb_trace "${trace.pcb_trace_id}"`)
        for (const reservation of reservations) {
          const { obstacle, id, cosine, sine, nets } = reservation
          if (!obstacle.layers.includes(start.layer) || (traceNet !== undefined && nets.has(traceNet))) continue
          const localStart = {
            x: cosine * (start.x - obstacle.center.x) + sine * (start.y - obstacle.center.y),
            y: -sine * (start.x - obstacle.center.x) + cosine * (start.y - obstacle.center.y),
          }
          const localEnd = {
            x: cosine * (end.x - obstacle.center.x) + sine * (end.y - obstacle.center.y),
            y: -sine * (end.x - obstacle.center.x) + cosine * (end.y - obstacle.center.y),
          }
          const distance = obstacle.shape === "circle"
            ? segmentToCircleMinDistance(start, end, { ...obstacle.center, radius: Math.max(obstacle.width, obstacle.height) / 2 })
            : segmentToBoxMinDistance(localStart, localEnd, {
                center: { x: 0, y: 0 }, width: obstacle.width, height: obstacle.height,
              })
          if (distance - radius >= traceClearance - 1e-9) continue
          const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
          errors.push({
            type: "pcb_trace_error", error_type: "pcb_trace_error",
            pcb_trace_error_id: `copper_pour_overlap_${trace.pcb_trace_id}_${id}_${pointIndex}`,
            pcb_trace_id: trace.pcb_trace_id, pcb_trace_ids: [trace.pcb_trace_id],
            source_trace_id: trace.connection_name ?? trace.pcb_trace_id,
            pcb_component_ids: [], pcb_port_ids: (trace.connectsTo ?? []).filter(name => name.startsWith("pcb_port_")),
            center, message: `pcb_trace "${trace.pcb_trace_id}" violates copper-pour reservation "${id}" on ${start.layer}`,
          })
        }
      }
    }
    return errors
  }
}
