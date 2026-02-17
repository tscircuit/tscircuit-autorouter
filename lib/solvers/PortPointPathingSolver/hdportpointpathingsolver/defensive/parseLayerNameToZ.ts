import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/** Converts a layer label into a numeric z index using shared mapping plus a defensive alias fallback. */
export function parseLayerNameToZ({
  layerName,
  node,
}: {
  layerName: string
  node: InputNodeWithPortPoints
}): number | undefined {
  // Reuse shared layer mapping logic so this file doesn't drift from repo conventions.
  // We infer layerCount from availableZ because this helper does not receive srj directly.
  const inferredLayerCount = Math.max(...node.availableZ, 0) + 1
  const mappedZ = mapLayerNameToZ(layerName, inferredLayerCount)
  if (Number.isFinite(mappedZ)) return mappedZ

  // Defensive compatibility fallback for "layerN" style aliases used in some flows.
  const numberedLayerMatch = layerName.match(/^layer(\d+)$/)
  if (numberedLayerMatch) {
    return Number.parseInt(numberedLayerMatch[1], 10) - 1
  }
  return undefined
}
