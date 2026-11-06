import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ViaKeepout } from "lib/types/srj-types"
import { mapLayerNameToZ } from "./mapLayerNameToZ"

/** Board-world points in mm (+X right, +Y up); tests the whole copper disk. */
export function isViaInKeepout(
  via: { x: number; y: number },
  diameter: number,
  keepouts: ViaKeepout[],
  layerCount: number,
  minZ = 0,
  maxZ = layerCount - 1,
): boolean {
  return keepouts.some((keepout) => {
    if (
      !keepout.layers.some((layer) => {
        const z = mapLayerNameToZ(layer, layerCount)
        return z >= minZ && z <= maxZ
      })
    )
      return false
    if (keepout.shape === "outline") {
      return keepout.outline
        .slice(1)
        .some(
          (end, index) =>
            pointToSegmentDistance(via, keepout.outline[index], end) <
            (diameter + keepout.strokeWidth) / 2 - 1e-9,
        )
    }
    const dx = Math.abs(via.x - keepout.center.x)
    const dy = Math.abs(via.y - keepout.center.y)
    const clearance =
      keepout.shape === "circle"
        ? Math.hypot(dx, dy) - keepout.radius
        : Math.hypot(
            Math.max(dx - keepout.width / 2, 0),
            Math.max(dy - keepout.height / 2, 0),
          )
    return clearance < diameter / 2 - 1e-9
  })
}
