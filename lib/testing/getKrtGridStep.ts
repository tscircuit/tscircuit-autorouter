import type { SimpleRouteJson } from "lib/types"

// KRT rebuilds a whole-board obstacle map per segment. Bound automatic
// refinement to five subdivisions per axis. Explicit gridStep takes precedence.
const gridSteps = [0.1, 0.05, 0.02] as const

/** Choose the coarsest candidate that preserves the most legal terminal centers. */
export function getKrtGridStep(srj: SimpleRouteJson, clearance: number): number {
  const blockedCounts = gridSteps.map(() => 0)
  for (const connection of srj.connections) {
    if (connection.pointsToConnect.length < 2) continue
    const width =
      connection.width ?? connection.nominalTraceWidth ??
      srj.nominalTraceWidth ?? srj.minTraceWidth
    const margin = width / 2 + clearance
    const ids = new Set([connection.name, connection.source_trace_id])
    for (const point of connection.pointsToConnect) {
      ids.add(point.pointId)
      ids.add(point.pcb_port_id)
    }
    const keepouts = srj.obstacles
      .filter((pad) => !pad.connectedTo.some((id) => ids.has(id)))
      .map((pad) => ({
        layers: pad.layers,
        minX: pad.center.x - (pad.width / 2 + margin),
        maxX: pad.center.x + (pad.width / 2 + margin),
        minY: pad.center.y - (pad.height / 2 + margin),
        maxY: pad.center.y + (pad.height / 2 + margin),
      }))
    for (const point of connection.pointsToConnect) {
      // A multilayer terminal can leave on another layer.
      const layer = point.layer
      if (!layer) continue
      // A snapped terminal moves by at most half a step, and KRT rounds
      // each keepout face outward by at most one more step.
      const tolerance = 1.5 * gridSteps[0]
      const nearby = keepouts.filter((r) =>
        (r.layers.length === 0 || r.layers.includes(layer)) &&
        point.x >= r.minX - tolerance && point.x <= r.maxX + tolerance &&
        point.y >= r.minY - tolerance && point.y <= r.maxY + tolerance,
      )
      if (nearby.length === 0 || nearby.some((r) =>
        point.x >= r.minX && point.x <= r.maxX &&
        point.y >= r.minY && point.y <= r.maxY,
      )) continue
      for (const [i, step] of gridSteps.entries()) {
        // Match Rust f64::round, including half-grid ties below zero.
        const x = Math.sign(point.x) * Math.round(Math.abs(point.x) / step)
        const y = Math.sign(point.y) * Math.round(Math.abs(point.y) / step)
        if (nearby.some((r) =>
          x >= Math.floor(r.minX / step) && x <= Math.ceil(r.maxX / step) &&
          y >= Math.floor(r.minY / step) && y <= Math.ceil(r.maxY / step),
        )) blockedCounts[i]++
      }
    }
  }
  return gridSteps[blockedCounts.indexOf(Math.min(...blockedCounts))]
}
