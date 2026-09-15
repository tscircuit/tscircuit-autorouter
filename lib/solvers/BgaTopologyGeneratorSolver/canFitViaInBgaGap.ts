import { pointToBoxDistance } from "@tscircuit/math-utils"
import type { CapacityMeshNode, Obstacle } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type ViaGapGeometry = Pick<CapacityMeshNode, "center" | "width" | "height">

/** A gap can join layers only when it contains a via with real copper clearance. */
export function canFitViaInBgaGap(params: {
  gap: ViaGapGeometry
  obstacles: readonly Obstacle[]
  viaDiameter: number
  clearance: number
  freeLayers: readonly number[]
  layerCount: number
}): boolean {
  const { gap, viaDiameter, clearance, freeLayers, layerCount } = params
  if (
    !Number.isFinite(viaDiameter) ||
    viaDiameter <= 0 ||
    !Number.isFinite(clearance) ||
    clearance < 0
  ) {
    throw new Error("BGA via placement requires valid diameter and clearance")
  }
  if (
    freeLayers.length < 2 ||
    gap.width + 1e-9 < viaDiameter ||
    gap.height + 1e-9 < viaDiameter
  ) {
    return false
  }
  const firstLayer = Math.min(...freeLayers)
  const lastLayer = Math.max(...freeLayers)
  for (const obstacle of params.obstacles) {
    const obstacleLayers =
      obstacle.__zLayers ??
      obstacle.zLayers ??
      obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
    if (!obstacleLayers.some((z) => z >= firstLayer && z <= lastLayer)) continue
    let distanceToCopper: number
    if (obstacle.shape === "circle") {
      if (obstacle.width !== obstacle.height) {
        throw new Error("Circular BGA copper must have equal width and height")
      }
      distanceToCopper =
        Math.hypot(
          gap.center.x - obstacle.center.x,
          gap.center.y - obstacle.center.y,
        ) -
        obstacle.width / 2
    } else {
      distanceToCopper = pointToBoxDistance(gap.center, obstacle)
    }
    if (distanceToCopper + 1e-9 < viaDiameter / 2 + clearance) return false
  }
  return true
}
