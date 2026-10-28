import { redistributePortPointsOnSharedEdge } from "./redistributePortPointsOnSharedEdge"
import type { PortPointWithOwnerPair, SharedEdge } from "./types"

/** Retain fixed ports as anchors when spacing the full same-layer family. */
export const redistributePortPointsBetweenFixedAnchors = ({
  sharedEdge,
  portPoints,
  movablePortPointIds,
}: {
  sharedEdge: SharedEdge
  portPoints: PortPointWithOwnerPair[]
  movablePortPointIds: ReadonlySet<string>
}): PortPointWithOwnerPair[] => {
  const movable = (point: PortPointWithOwnerPair): boolean =>
    point.portPointId !== undefined && movablePortPointIds.has(point.portPointId)
  // Preserve the exact existing arithmetic and ordering for ordinary families.
  if (portPoints.every(movable)) {
    return redistributePortPointsOnSharedEdge({ sharedEdge, portPoints })
  }
  if (!portPoints.some(movable)) return portPoints

  const horizontal = sharedEdge.orientation === "horizontal"
  const start = horizontal ? sharedEdge.x1 : sharedEdge.y1
  const end = horizontal ? sharedEdge.x2 : sharedEdge.y2
  if (![start, end].every(Number.isFinite) || end <= start) {
    throw new Error("Fixed-anchor redistribution requires a positive shared edge")
  }
  const axis = (point: PortPointWithOwnerPair): number => horizontal ? point.x : point.y
  const byLayer = new Map<number, PortPointWithOwnerPair[]>()
  for (const point of portPoints) {
    if (![point.x, point.y, point.z].every(Number.isFinite)) {
      throw new Error("Fixed-anchor redistribution requires finite port coordinates")
    }
    const layer = byLayer.get(point.z) ?? []
    layer.push(point)
    byLayer.set(point.z, layer)
  }
  const output: PortPointWithOwnerPair[] = []
  for (const z of [...byLayer.keys()].sort((a, b) => a - b)) {
    const portsOnZ = byLayer.get(z)!
    if (portsOnZ.every(movable)) {
      output.push(...redistributePortPointsOnSharedEdge({ sharedEdge, portPoints: portsOnZ }))
      continue
    }
    if (!portsOnZ.some(movable)) {
      output.push(...portsOnZ)
      continue
    }
    // Stable sorting may separate coincident ports, but never reverses a
    // strict original order, which is what a proper crossing requires.
    const family = [...portsOnZ].sort((a, b) => axis(a) - axis(b))
    let left = start
    let pending: PortPointWithOwnerPair[] = []
    const emitInterval = (right: number): void => {
      const lower = Math.max(start, left), upper = Math.min(end, right)
      for (const [index, point] of pending.entries()) {
        if (upper <= lower) {
          // Coincident anchors cannot supply positive spacing. Keeping the
          // existing coordinate preserves their original non-strict order.
          if (upper !== lower || axis(point) !== lower) {
            throw new Error("Coincident fixed anchors cannot contain a strict interior port")
          }
          output.push(point)
          continue
        }
        const coordinate = lower + (upper - lower) * (2 * index + 1) / (2 * pending.length)
        output.push({ ...point,
          x: horizontal ? coordinate : sharedEdge.x1,
          y: horizontal ? sharedEdge.y1 : coordinate,
        })
      }
      pending = []
    }
    for (const point of family) {
      // Unproven legacy coordinates outside the segment remain fixed; they
      // never serve as evidence for the caller's positive boundary contract.
      if (movable(point) && axis(point) >= start && axis(point) <= end) {
        pending.push(point)
      } else {
        emitInterval(axis(point))
        output.push(point)
        left = axis(point)
      }
    }
    emitInterval(end)
  }
  return output
}
