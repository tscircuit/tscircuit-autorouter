import type { CapacityMeshNode } from "lib/types"

type FreeRectangle = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  z: number
  firstIndex: number
  sourceCount: number
}

const EPSILON = 1e-10
const GEOMETRY_KEYS = new Set([
  "capacityMeshNodeId", "center", "width", "height", "layer", "availableZ",
])
const EMPTY_ROLE_KEYS = new Set([
  "_containsObstacle", "_containsTarget", "_completelyInsideObstacle",
  "_isComponentTopologyNode", "_isNarrowQfpPadGap",
])

function isEligible(node: CapacityMeshNode, maximumDimension: number): boolean {
  if (node.availableZ.length !== 1 || !Number.isInteger(node.availableZ[0]) || node.availableZ[0]! < 0) return false
  if (![node.center.x, node.center.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0) return false
  if (node.width > maximumDimension + EPSILON || node.height > maximumDimension + EPSILON) return false
  // Unknown metadata may describe ownership, component gaps or offboard links.
  // Only plain global free cells can lose their internal partition boundaries.
  return Object.entries(node).every(([key, value]) =>
    GEOMETRY_KEYS.has(key) || value === undefined || (EMPTY_ROLE_KEYS.has(key) && value === false),
  )
}

function mergeSweep(rectangles: FreeRectangle[], horizontal: boolean, maximumDimension: number): FreeRectangle[] {
  const groups = new Map<string, FreeRectangle[]>()
  for (const rectangle of rectangles) {
    const orthogonalMin = horizontal ? rectangle.minY : rectangle.minX
    const orthogonalMax = horizontal ? rectangle.maxY : rectangle.maxX
    const key = `${rectangle.z}:${Math.round(orthogonalMin / EPSILON)}:${Math.round(orthogonalMax / EPSILON)}`
    const group = groups.get(key)
    if (group) group.push(rectangle)
    else groups.set(key, [rectangle])
  }
  const output: FreeRectangle[] = []
  for (const group of groups.values()) {
    group.sort((a, b) => (horizontal ? a.minX - b.minX || a.maxX - b.maxX : a.minY - b.minY || a.maxY - b.maxY) || a.firstIndex - b.firstIndex)
    let previous: FreeRectangle | undefined
    for (const rectangle of group) {
      const sameSpan = previous && (horizontal
        ? Math.abs(previous.minY - rectangle.minY) <= EPSILON && Math.abs(previous.maxY - rectangle.maxY) <= EPSILON
        : Math.abs(previous.minX - rectangle.minX) <= EPSILON && Math.abs(previous.maxX - rectangle.maxX) <= EPSILON)
      const gap = previous ? (horizontal ? rectangle.minX - previous.maxX : rectangle.minY - previous.maxY) : Infinity
      const mergedDimension = previous ? (horizontal ? rectangle.maxX - previous.minX : rectangle.maxY - previous.minY) : Infinity
      if (previous && sameSpan && Math.abs(gap) <= EPSILON && mergedDimension <= maximumDimension + EPSILON) {
        if (horizontal) previous.maxX = rectangle.maxX
        else previous.maxY = rectangle.maxY
        previous.firstIndex = Math.min(previous.firstIndex, rectangle.firstIndex)
        previous.sourceCount += rectangle.sourceCount
      } else {
        previous = { ...rectangle }
        output.push(previous)
      }
    }
  }
  return output
}

/** Remove artificial free-cell cuts without changing their per-layer union. */
export function compactGlobalSingleLayerFreeNodes(input: CapacityMeshNode[], maximumDimension: number = 3): CapacityMeshNode[] {
  const dimensionLimit = Number.isFinite(maximumDimension) && maximumDimension > 0 ? maximumDimension : Infinity
  const entries: Array<{ firstIndex: number; node: CapacityMeshNode }> = []
  let rectangles: FreeRectangle[] = []
  for (let index = 0; index < input.length; index++) {
    const node = input[index]!
    if (!isEligible(node, dimensionLimit)) {
      entries.push({ firstIndex: index, node })
      continue
    }
    rectangles.push({ minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2, minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2, z: node.availableZ[0]!, firstIndex: index, sourceCount: 1 })
  }
  // Foreign-layer pad boundaries can slice a wide open route into micron-high
  // cells. Two fixed sweeps remove such cuts in O(N log N), while preserving
  // the subdivision dimension limit and all protected component/copper cells.
  for (const horizontal of [false, true]) {
    rectangles = mergeSweep(rectangles, horizontal, dimensionLimit)
  }
  for (const rectangle of rectangles) {
    const original = input[rectangle.firstIndex]!
    const node = rectangle.sourceCount === 1 ? original : {
      ...original,
      center: { x: (rectangle.minX + rectangle.maxX) / 2, y: (rectangle.minY + rectangle.maxY) / 2 },
      width: rectangle.maxX - rectangle.minX,
      height: rectangle.maxY - rectangle.minY,
    }
    entries.push({ firstIndex: rectangle.firstIndex, node })
  }
  entries.sort((a, b) => a.firstIndex - b.firstIndex)
  return entries.map(({ node }) => node)
}
