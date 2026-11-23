import type { BgaRoutingBoard } from "@tscircuit/high-density-phase-solver"
import type { ViaKeepout } from "lib/types/srj-types"
import { getUniqueValidZLayersFromLayerNames } from "lib/utils/mapLayerNameToZ"

export function getBgaViaKeepoutObstacles(
  keepouts: readonly ViaKeepout[],
  layerCount: number,
): BgaRoutingBoard["obstacles"] {
  const obstacles: BgaRoutingBoard["obstacles"] = []
  // BGA vias span the whole stack. An obstacle with no copper layers still
  // excludes via sites with the solver's pad clearance and leaves wires free.
  const viaOnly = { type: "rect" as const, layers: [], connectedTo: [] }
  for (const keepout of keepouts) {
    if (!getUniqueValidZLayersFromLayerNames(keepout.layers, layerCount).length)
      continue

    if (keepout.shape === "rect") {
      obstacles.push({
        ...viaOnly,
        center: keepout.center,
        width: keepout.width,
        height: keepout.height,
      })
    } else if (keepout.shape === "circle") {
      obstacles.push({
        ...viaOnly,
        shape: "circle",
        center: keepout.center,
        width: 2 * keepout.radius,
        height: 2 * keepout.radius,
      })
    } else if (keepout.outline.length >= 2) {
      // A stroke is a strip along each segment and a disk at each vertex.
      for (const [index, start] of keepout.outline.entries()) {
        obstacles.push({
          ...viaOnly,
          shape: "circle",
          center: start,
          width: keepout.strokeWidth,
          height: keepout.strokeWidth,
        })
        const end = keepout.outline[index + 1]
        if (!end) continue
        const dx = end.x - start.x
        const dy = end.y - start.y
        obstacles.push({
          ...viaOnly,
          center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
          width: Math.hypot(dx, dy),
          height: keepout.strokeWidth,
          ccwRotationDegrees: (Math.atan2(dy, dx) * 180) / Math.PI,
        })
      }
    }
  }
  return obstacles
}
