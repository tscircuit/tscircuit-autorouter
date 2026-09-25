import {
  pointToSegmentDistance,
  segmentToBoundsMinDistance,
} from "@tscircuit/math-utils"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"

/** Validate finished trace copper against the original, unexpanded drill geometry. */
export function getTraceToHoleClearanceError(
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTraces,
): string | null {
  const required = srj.minTraceToHoleEdgeClearance
  if (required === undefined) return null
  const holes = srj.obstacles.filter((obstacle) => obstacle.isHole)
  for (const trace of traces) {
    for (let index = 1; index < trace.route.length; index++) {
      const a = trace.route[index - 1]!
      const b = trace.route[index]!
      // Jumper bodies and explicit route breaks are not PCB trace copper.
      if (
        (a.route_type !== "wire" && a.route_type !== "via") ||
        (b.route_type !== "wire" && b.route_type !== "via")
      )
        continue
      // Wire-to-via segments also carry copper up to the via position.
      if (a.route_type !== "wire" && b.route_type !== "wire") continue
      if (
        a.route_type === "wire" &&
        b.route_type === "wire" &&
        a.layer !== b.layer
      )
        continue
      const wire = a.route_type === "wire" ? a : b
      if (wire.route_type !== "wire") continue
      const halfWidth =
        Math.max(
          a.route_type === "wire" ? a.width : 0,
          b.route_type === "wire" ? b.width : 0,
        ) / 2
      for (const hole of holes) {
        if (!hole.layers.includes(wire.layer)) continue
        let distance: number
        if (hole.shape === "circle") {
          distance = pointToSegmentDistance(hole.center, a, b) - hole.width / 2
        } else {
          const angle = ((hole.ccwRotationDegrees ?? 0) * Math.PI) / 180
          const cos = Math.cos(angle)
          const sin = Math.sin(angle)
          const ax = a.x - hole.center.x
          const ay = a.y - hole.center.y
          const bx = b.x - hole.center.x
          const by = b.y - hole.center.y
          distance = segmentToBoundsMinDistance(
            { x: ax * cos + ay * sin, y: -ax * sin + ay * cos },
            { x: bx * cos + by * sin, y: -bx * sin + by * cos },
            {
              minX: -hole.width / 2,
              maxX: hole.width / 2,
              minY: -hole.height / 2,
              maxY: hole.height / 2,
            },
          )
        }
        const clearance = distance - halfWidth
        if (clearance < required - 1e-6) {
          const name =
            hole.obstacleId ?? `hole at (${hole.center.x}, ${hole.center.y})`
          return `Trace ${trace.pcb_trace_id} segment ${index - 1} on ${wire.layer} has ${clearance.toFixed(6)} mm clearance to ${name}; minTraceToHoleEdgeClearance requires ${required} mm`
        }
      }
    }
  }
  return null
}
