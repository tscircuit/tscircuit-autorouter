import type { NodeWithPortPoints } from "../../types/high-density-types"

/** Keeps boundary layer transitions in the existing board force stage. */
export function isPipeline9NodeForceImprovementEligible({
  nodeWithPortPoints: node,
  viaDiameter,
}: {
  nodeWithPortPoints: NodeWithPortPoints
  viaDiameter: number
}): boolean {
  // The force dependency merges co-located layer-transition points and clamps
  // them, including fixed terminals, by the via radius plus its 0.001 mm inset.
  // Defer these groups so remote HDR validation can still require terminals
  // at their ports without changing the existing board force geometry.
  const padding = viaDiameter / 2 + 0.001
  const minX = node.center.x - node.width / 2 + padding
  const maxX = node.center.x + node.width / 2 - padding
  const minY = node.center.y - node.height / 2 + padding
  const maxY = node.center.y + node.height / 2 - padding
  const portPoints = [
    ...node.portPoints,
    ...(node.portPointsInPairs ?? []).flat(),
  ]
  for (const [index, portPoint] of portPoints.entries()) {
    if (
      portPoint.x >= minX &&
      portPoint.x <= maxX &&
      portPoint.y >= minY &&
      portPoint.y <= maxY
    )
      continue
    for (const candidate of portPoints.slice(index + 1)) {
      if (
        candidate.connectionName === portPoint.connectionName &&
        candidate.x === portPoint.x &&
        candidate.y === portPoint.y &&
        candidate.z !== portPoint.z
      )
        return false
    }
  }
  return true
}
