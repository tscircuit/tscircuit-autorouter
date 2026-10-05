import { PortPointWithOwnerPair, SharedEdge } from "./types"

/**
 * Repositions each owner-pair family uniformly along its shared edge while
 * preserving layer grouping and a stable ordering along the edge axis.
 */
export const redistributePortPointsOnSharedEdge = ({
  sharedEdge,
  portPoints,
}: {
  sharedEdge: SharedEdge
  portPoints: PortPointWithOwnerPair[]
}): PortPointWithOwnerPair[] => {
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

    portsOnZ.sort((a, b) =>
      sharedEdge.orientation === "horizontal" ? a.x - b.x : a.y - b.y,
    )

    for (let i = 0; i < count; i++) {
      const fraction = (2 * i + 1) / (2 * count)
      const x =
        sharedEdge.orientation === "horizontal"
          ? sharedEdge.x1 + sharedEdge.length * fraction
          : sharedEdge.x1
      const y =
        sharedEdge.orientation === "horizontal"
          ? sharedEdge.y1
          : sharedEdge.y1 + sharedEdge.length * fraction
      redistributed.push({ ...portsOnZ[i], x, y })
    }
  }

  return redistributed
}
