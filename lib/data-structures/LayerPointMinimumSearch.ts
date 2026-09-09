type LayerPoint = { x: number; y: number; z: number }
type Entry = { point: LayerPoint; order: number }

/** Exact nearest-point search over finite, fixed connection geometry. */
export class LayerPointMinimumSearch {
  private layers: Array<{ z: number; entries: Entry[] }>

  constructor(points: LayerPoint[]) {
    const groups = new Map<number, Entry[]>()
    for (const [order, point] of points.entries()) {
      const entries = groups.get(point.z) ?? []
      entries.push({ point, order })
      groups.set(point.z, entries)
    }
    this.layers = [...groups].map(([z, entries]) => ({ z, entries }))
  }

  findNearestPoint(
    node: LayerPoint,
    viaPenaltyDistance: number,
  ): LayerPoint | null {
    let bestDistance = Infinity
    let bestOrder = Infinity
    let closest: LayerPoint | null = null

    for (const { z, entries } of this.layers) {
      const penalty = node.z === z ? 0 : viaPenaltyDistance
      let minimumSquared = Infinity
      for (const { point, order } of entries) {
        const dx = node.x - point.x
        const dy = node.y - point.y
        const squared = dx * dx + dy * dy
        // Entries retain original order within a layer. Sqrt and adding the
        // same penalty are monotone, so a later non-minimum cannot beat an
        // earlier point, including ties introduced by either rounding step.
        if (squared >= minimumSquared) continue
        minimumSquared = squared
        const distance = Math.sqrt(squared) + penalty
        if (
          distance < bestDistance ||
          (closest !== null && distance === bestDistance && order < bestOrder)
        ) {
          bestDistance = distance
          bestOrder = order
          closest = point
        }
      }
    }
    return closest
  }
}
