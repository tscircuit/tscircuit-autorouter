import { RbushIndex } from "lib/data-structures/RbushIndex"
import type { CoupledPortPlacementConstraint } from "./CoupledPortPlacementSolver"
import type { Bounds } from "./types"

export type NearbyPortPlacementEvent = {
  bounds: Bounds
  z: number
  owner: string | undefined
  connectionName: string
  width: number
}

/** Include every pair that can collide anywhere in its complete physical domains. */
export function getNearbyPortPlacementConstraints(
  events: readonly NearbyPortPlacementEvent[],
  traceClearance: number,
  tolerance: number,
): CoupledPortPlacementConstraint[] {
  const layers = new Map<number, { indices: number[]; maximumWidth: number }>()
  for (const [index, event] of events.entries()) {
    let layer = layers.get(event.z)
    if (!layer) layers.set(event.z, layer = { indices: [], maximumWidth: 0 })
    layer.indices.push(index)
    layer.maximumWidth = Math.max(layer.maximumWidth, event.width)
  }
  const constraints: CoupledPortPlacementConstraint[] = []
  for (const { indices, maximumWidth } of layers.values()) {
    const tree = new RbushIndex<number>()
    tree.bulkLoad(indices.map((index) => ({ item: index, ...events[index]!.bounds })))
    for (const first of indices) {
      const a = events[first]!, bounds = a.bounds
      const reach = Math.max(0, (a.width + maximumWidth) / 2 + traceClearance - tolerance)
      // Expand the broad-phase query outward; only the exact domain-distance
      // test below decides whether a pair needs the existing constraint.
      const roundoff = 8 * Number.EPSILON * Math.max(1, reach,
        Math.abs(bounds.minX), Math.abs(bounds.maxX), Math.abs(bounds.minY), Math.abs(bounds.maxY))
      const nearby = tree.search(bounds.minX - reach - roundoff, bounds.minY - reach - roundoff,
        bounds.maxX + reach + roundoff, bounds.maxY + reach + roundoff).sort((a, b) => a - b)
      for (const second of nearby) {
        if (second <= first) continue
        const b = events[second]!
        if ((a.owner !== undefined && a.owner === b.owner) || a.connectionName === b.connectionName) continue
        const gap = Math.max(0, (a.width + b.width) / 2 + traceClearance - tolerance)
        const distance = Math.hypot(
          Math.max(bounds.minX - b.bounds.maxX, b.bounds.minX - bounds.maxX, 0),
          Math.max(bounds.minY - b.bounds.maxY, b.bounds.minY - bounds.maxY, 0),
        )
        if (distance < gap) constraints.push({ first, second, gap })
      }
    }
  }
  return constraints
}
