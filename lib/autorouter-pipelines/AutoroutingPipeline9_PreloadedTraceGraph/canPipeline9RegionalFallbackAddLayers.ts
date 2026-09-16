import type { NodeWithPortPoints } from "lib/types/high-density-types"

/** Ordinary routing has no fixed copper to move; its retry must add layers. */
export const canPipeline9RegionalFallbackAddLayers = ({
  nodeWithPortPoints,
  layerCount,
}: {
  nodeWithPortPoints: NodeWithPortPoints
  layerCount: number
}): boolean => {
  const availableZ = new Set(
    nodeWithPortPoints.availableZ ??
      nodeWithPortPoints.portPoints.map((portPoint) => portPoint.z),
  )
  for (let z = 0; z < layerCount; z++) {
    if (!availableZ.has(z)) return true
  }
  return false
}
