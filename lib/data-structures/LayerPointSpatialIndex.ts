type LayerPoint = { x: number; y: number; z: number }
type Entry = { point: LayerPoint; order: number }
type TreeBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  firstOrder: number
}
type PointTree = TreeBounds &
  (
    | { kind: "leaf"; entries: Entry[] }
    | { kind: "branch"; left: PointTree; right: PointTree }
  )

function buildTree(entries: Entry[]): PointTree {
  const xs = entries.map(({ point }) => point.x)
  const ys = entries.map(({ point }) => point.y)
  const bounds: TreeBounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    firstOrder: Math.min(...entries.map(({ order }) => order)),
  }
  if (entries.length <= 4) return { ...bounds, kind: "leaf", entries }
  const axis =
    bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY ? "x" : "y"
  entries.sort((a, b) => a.point[axis] - b.point[axis] || a.order - b.order)
  const middle = entries.length >> 1
  return {
    ...bounds,
    kind: "branch",
    left: buildTree(entries.slice(0, middle)),
    right: buildTree(entries.slice(middle)),
  }
}

/** Exact nearest-point search over finite, fixed connection geometry. */
export class LayerPointSpatialIndex {
  private roots: Array<{ z: number; tree: PointTree }>

  constructor(points: LayerPoint[]) {
    const byLayer = new Map<number, Entry[]>()
    for (const [order, point] of points.entries()) {
      const entries = byLayer.get(point.z) ?? []
      entries.push({ point, order })
      byLayer.set(point.z, entries)
    }
    this.roots = [...byLayer].map(([z, entries]) => ({
      z,
      tree: buildTree(entries),
    }))
  }

  findNearestPoint(
    node: LayerPoint,
    viaPenaltyDistance: number,
  ): LayerPoint | null {
    let bestDistance = Infinity
    let bestOrder = Infinity
    let closest: LayerPoint | null = null

    const lowerBound = (tree: PointTree, penalty: number): number => {
      const dx =
        node.x < tree.minX
          ? tree.minX - node.x
          : node.x > tree.maxX
            ? node.x - tree.maxX
            : 0
      const dy =
        node.y < tree.minY
          ? tree.minY - node.y
          : node.y > tree.maxY
            ? node.y - tree.maxY
            : 0
      const axisDistance = Math.max(dx, dy)
      // L-infinity distance bounds Euclidean distance from below. Round the
      // bound outward to preserve the original sqrt(dx*dx + dy*dy) comparison.
      // Below 1e-150, use zero so subnormal squares cannot invalidate the bound.
      const lower =
        axisDistance < 1e-150 ? 0 : axisDistance * (1 - 8 * Number.EPSILON)
      return lower + penalty
    }

    const visit = (tree: PointTree, penalty: number, lower: number): void => {
      if (
        lower > bestDistance ||
        (lower === bestDistance && tree.firstOrder >= bestOrder)
      )
        return

      if (tree.kind === "leaf") {
        for (const { point, order } of tree.entries) {
          const dx = node.x - point.x
          const dy = node.y - point.y
          const distance = Math.sqrt(dx * dx + dy * dy) + penalty
          // Equal weighted distances retain the first point in the original
          // array, including ties introduced by floating-point addition.
          if (
            distance < bestDistance ||
            (closest !== null && distance === bestDistance && order < bestOrder)
          ) {
            bestDistance = distance
            bestOrder = order
            closest = point
          }
        }
        return
      }

      const leftBound = lowerBound(tree.left, penalty)
      const rightBound = lowerBound(tree.right, penalty)
      if (
        leftBound < rightBound ||
        (leftBound === rightBound &&
          tree.left.firstOrder < tree.right.firstOrder)
      ) {
        visit(tree.left, penalty, leftBound)
        visit(tree.right, penalty, rightBound)
      } else {
        visit(tree.right, penalty, rightBound)
        visit(tree.left, penalty, leftBound)
      }
    }

    for (const { z, tree } of this.roots) {
      const penalty = z === node.z ? 0 : viaPenaltyDistance
      visit(tree, penalty, lowerBound(tree, penalty))
    }
    return closest
  }
}
