import { PortPointWithOwnerPair, SharedEdge } from "./types"

/**
 * Repositions each owner-pair family uniformly along its shared edge while
 * preserving layer grouping and a stable ordering along the edge axis.
 */
export const redistributePortPointsOnSharedEdge = ({
  sharedEdge,
  portPoints,
  minTraceCenterSpacing,
}: {
  sharedEdge: SharedEdge
  portPoints: PortPointWithOwnerPair[]
  minTraceCenterSpacing?: number
}): PortPointWithOwnerPair[] => {
  if (
    minTraceCenterSpacing !== undefined &&
    (!Number.isFinite(minTraceCenterSpacing) || minTraceCenterSpacing <= 0)
  ) {
    throw new Error("Trace center spacing must be positive and finite")
  }
  if (portPoints.length === 0) return []

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
    const spacing = Math.max(
      sharedEdge.length / count,
      minTraceCenterSpacing ?? 0,
    )
    const occupiedLength = spacing * (count - 1)
    if (occupiedLength > sharedEdge.length + 1e-6) {
      throw new Error(
        `Shared edge "${sharedEdge.ownerPairKey}" cannot fit ${count} ports on layer ${z} at trace center spacing ${minTraceCenterSpacing}`,
      )
    }

    portsOnZ.sort((a, b) =>
      sharedEdge.orientation === "horizontal" ? a.x - b.x : a.y - b.y,
    )

    for (let i = 0; i < count; i++) {
      const offset =
        spacing === sharedEdge.length / count
          ? sharedEdge.length * ((2 * i + 1) / (2 * count))
          : (sharedEdge.length - occupiedLength) / 2 + i * spacing
      const x =
        sharedEdge.orientation === "horizontal"
          ? sharedEdge.x1 + offset
          : sharedEdge.x1
      const y =
        sharedEdge.orientation === "horizontal"
          ? sharedEdge.y1
          : sharedEdge.y1 + offset
      redistributed.push({ ...portsOnZ[i], x, y })
    }
  }

  return redistributed
}
