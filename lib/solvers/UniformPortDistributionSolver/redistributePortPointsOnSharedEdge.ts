import { PortPointWithOwnerPair, SharedEdge } from "./types"

/**
 * Repositions each owner-pair family uniformly along its shared edge while
 * preserving layer grouping and a stable ordering along the edge axis.
 */
export const redistributePortPointsOnSharedEdge = ({
  sharedEdge,
  portPoints,
  minimumPortSpacing,
  minimumEdgeInset,
}: {
  sharedEdge: SharedEdge
  portPoints: PortPointWithOwnerPair[]
  minimumPortSpacing?: number
  minimumEdgeInset?: number
}): PortPointWithOwnerPair[] => {
  if (portPoints.length === 0) return []

  const epsilon = 1e-9

  const portsByZ = new Map<number, PortPointWithOwnerPair[]>()
  for (const portPoint of portPoints) {
    const z = portPoint.z ?? 0
    const existing = portsByZ.get(z) ?? []
    existing.push(portPoint)
    portsByZ.set(z, existing)
  }

  const redistributed: PortPointWithOwnerPair[] = []
  const zLayers = Array.from(portsByZ.keys()).sort((a, b) => a - b)

  for (const z of zLayers) {
    const portsOnZ = portsByZ.get(z)!
    const count = portsOnZ.length

    portsOnZ.sort((a, b) =>
      sharedEdge.orientation === "horizontal" ? a.x - b.x : a.y - b.y,
    )

    const legacySpacing = sharedEdge.length / count
    const legacyEdgeInset = legacySpacing / 2
    const needsPhysicalSpacing =
      count > 1 &&
      minimumPortSpacing !== undefined &&
      minimumEdgeInset !== undefined &&
      (legacySpacing + epsilon < minimumPortSpacing ||
        legacyEdgeInset + epsilon < minimumEdgeInset)
    const physicalSpacing = minimumPortSpacing ?? 0
    const requiredSpan = (count - 1) * physicalSpacing
    const availableCenterSpan =
      sharedEdge.length - 2 * (minimumEdgeInset ?? 0)
    const canFitPhysicalSpacing =
      needsPhysicalSpacing && requiredSpan <= availableCenterSpan + epsilon
    const physicalStart = (sharedEdge.length - requiredSpan) / 2

    for (let i = 0; i < count; i++) {
      const distanceAlongEdge = canFitPhysicalSpacing
        ? physicalStart + i * physicalSpacing
        : sharedEdge.length * ((2 * i + 1) / (2 * count))
      const x =
        sharedEdge.orientation === "horizontal"
          ? sharedEdge.x1 + distanceAlongEdge
          : sharedEdge.x1
      const y =
        sharedEdge.orientation === "horizontal"
          ? sharedEdge.y1
          : sharedEdge.y1 + distanceAlongEdge
      redistributed.push({ ...portsOnZ[i], x, y })
    }
  }

  return redistributed
}
