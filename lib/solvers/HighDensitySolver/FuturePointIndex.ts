import { distance } from "@tscircuit/math-utils"

export type FuturePoint = { x: number; y: number; z: number }
type IndexedPoint = { point: FuturePoint; index: number }
type SearchNode = {
  entry: IndexedPoint
  axis: "x" | "y"
  minX: number
  minY: number
  maxX: number
  maxY: number
  commonLayer: number | undefined
  minimumIndex: number
  left: SearchNode | undefined
  right: SearchNode | undefined
}
type ClosestPoint = { index: number; distance: number }

/** Exact nearest-point selection for geometry fixed during a route search. */
export class FuturePointIndex {
  private readonly root: SearchNode | undefined

  constructor(points: readonly FuturePoint[]) {
    const entries: IndexedPoint[] = []
    let index = 0
    for (const point of points) {
      entries.push({ point, index })
      index++
    }
    this.root = this.build(entries, 0)
  }

  findClosestIndex(query: FuturePoint, viaPenaltyDistance: number): number {
    if (!this.root) return -1
    const closest: ClosestPoint = { index: -1, distance: Infinity }
    this.search(this.root, query, viaPenaltyDistance, closest)
    // The original scan rejects Infinity and NaN rather than choosing a point.
    // Keep -1 when no point improved its initial Infinity distance.
    return closest.index
  }

  private build(
    entries: IndexedPoint[],
    depth: number,
  ): SearchNode | undefined {
    if (entries.length === 0) return undefined
    const axis = depth % 2 === 0 ? "x" : "y"
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let commonLayer: number | undefined = entries[0].point.z
    let minimumIndex = Infinity
    for (const { point, index } of entries) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
      if (point.z !== commonLayer) commonLayer = undefined
      minimumIndex = Math.min(minimumIndex, index)
    }
    entries.sort(
      (left, right): number =>
        left.point[axis] - right.point[axis] || left.index - right.index,
    )
    const middle = Math.floor(entries.length / 2)
    return {
      entry: entries[middle],
      axis,
      minX,
      minY,
      maxX,
      maxY,
      commonLayer,
      minimumIndex,
      left: this.build(entries.slice(0, middle), depth + 1),
      right: this.build(entries.slice(middle + 1), depth + 1),
    }
  }

  private search(
    node: SearchNode | undefined,
    query: FuturePoint,
    viaPenaltyDistance: number,
    closest: ClosestPoint,
  ): void {
    if (!node) return
    if (node.left || node.right) {
      const dx =
        query.x < node.minX
          ? query.x - node.minX
          : query.x > node.maxX
            ? query.x - node.maxX
            : 0
      const dy =
        query.y < node.minY
          ? query.y - node.minY
          : query.y > node.maxY
            ? query.y - node.maxY
            : 0
      const minimumPenalty =
        node.commonLayer === undefined
          ? Math.min(0, viaPenaltyDistance)
          : query.z === node.commonLayer
            ? 0
            : viaPenaltyDistance
      // Use the same square root and addition as the distance scan. Strict >
      // keeps ties live unless no earlier original index exists in the subtree.
      // NaN bounds also leave the subtree live.
      const lowerBound = Math.sqrt(dx * dx + dy * dy) + minimumPenalty
      if (
        closest.distance < lowerBound ||
        (closest.index !== -1 &&
          closest.distance === lowerBound &&
          closest.index <= node.minimumIndex)
      ) {
        return
      }
    }
    // A leaf needs only the original distance, not a second bound calculation.
    const candidateDistance =
      distance(query, node.entry.point) +
      (query.z !== node.entry.point.z ? viaPenaltyDistance : 0)
    if (
      candidateDistance < closest.distance ||
      (closest.index !== -1 &&
        candidateDistance === closest.distance &&
        node.entry.index < closest.index)
    ) {
      closest.distance = candidateDistance
      closest.index = node.entry.index
    }
    if (!node.left && !node.right) return
    if (query[node.axis] < node.entry.point[node.axis]) {
      this.search(node.left, query, viaPenaltyDistance, closest)
      this.search(node.right, query, viaPenaltyDistance, closest)
    } else {
      this.search(node.right, query, viaPenaltyDistance, closest)
      this.search(node.left, query, viaPenaltyDistance, closest)
    }
  }
}
