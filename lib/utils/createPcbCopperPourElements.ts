import type { PcbCopperPour } from "circuit-json"
import type { SimpleRouteJson } from "lib/types"
import { mapZToLayerName } from "./mapZToLayerName"

const SEMICIRCLE_BULGE = 1

export const createPcbCopperPourElements = (
  srj: SimpleRouteJson,
): PcbCopperPour[] => {
  const copperPours: PcbCopperPour[] = []
  const layerNames = new Set(
    Array.from({ length: srj.layerCount }, (_, z) =>
      mapZToLayerName(z, srj.layerCount),
    ),
  )
  for (const [obstacleIndex, obstacle] of srj.obstacles.entries()) {
    if (!obstacle.isCopperPour) continue
    for (const layer of layerNames) {
      if (!obstacle.layers.includes(layer)) continue
      if (obstacle.shape === "circle") {
        const radius = obstacle.width / 2
        copperPours.push({
          type: "pcb_copper_pour",
          pcb_copper_pour_id: `pcb_copper_pour_${obstacleIndex}_${layer}`,
          shape: "brep",
          layer,
          covered_with_solder_mask: true,
          brep_shape: {
            outer_ring: {
              vertices: [
                {
                  x: obstacle.center.x - radius,
                  y: obstacle.center.y,
                  bulge: SEMICIRCLE_BULGE,
                },
                {
                  x: obstacle.center.x + radius,
                  y: obstacle.center.y,
                  bulge: SEMICIRCLE_BULGE,
                },
              ],
            },
            inner_rings: [],
          },
        })
        continue
      }
      copperPours.push({
        type: "pcb_copper_pour",
        pcb_copper_pour_id: `pcb_copper_pour_${obstacleIndex}_${layer}`,
        shape: "rect",
        layer,
        center: { ...obstacle.center },
        width: obstacle.width,
        height: obstacle.height,
        rotation: obstacle.ccwRotationDegrees,
        covered_with_solder_mask: true,
      })
    }
  }
  return copperPours
}
