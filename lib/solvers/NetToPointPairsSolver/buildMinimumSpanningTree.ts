type Point = { x: number; y: number }

export class KDNode {
  point: Point
  left: KDNode | null = null
  right: KDNode | null = null

  constructor(point: Point) {
    this.point = point
  }
}

class KDTree {
  root: KDNode | null = null

  constructor(points: Point[]) {
    if (points.length > 0) {
      this.root = this.buildTree(points, 0)
    }
  }

  private buildTree(points: Point[], depth: number): KDNode {
    const axis = depth % 2 === 0 ? "x" : "y"

    // Sort points by the current axis
    points.sort((a, b) => a[axis] - b[axis])

    // Choose median as the pivot element
    const medianIndex = Math.floor(points.length / 2)
    const node = new KDNode(points[medianIndex])

    // Recursively build left and right subtrees
    if (medianIndex > 0) {
      node.left = this.buildTree(points.slice(0, medianIndex), depth + 1)
    }

    if (medianIndex < points.length - 1) {
      node.right = this.buildTree(points.slice(medianIndex + 1), depth + 1)
    }

    return node
  }

  // Find the nearest neighbor to a query point
  findNearestNeighbor(queryPoint: Point): Point {
    if (!this.root) {
      throw new Error("Tree is empty")
    }

    const best: Point = this.root.point
    const bestDistance = this.distance(queryPoint, best)

    this.nearestNeighborSearch(this.root, queryPoint, 0, best, bestDistance)

    return best
  }

  private nearestNeighborSearch(
    node: KDNode | null,
    queryPoint: Point,
    depth: number,
    best: Point,
    bestDistance: number,
  ): Point {
    if (!node) {
      return best
    }

    const axis = depth % 2 ? "x" : "y"
    const currentDistance = this.distance(queryPoint, node.point)

    if (currentDistance < bestDistance) {
      best = node.point
      bestDistance = currentDistance
    }

    // Determine which subtree to search first
    const axisDiff = queryPoint[axis] - node.point[axis]
    const firstBranch = axisDiff <= 0 ? node.left : node.right
    const secondBranch = axisDiff <= 0 ? node.right : node.left

    // Recursively search the first branch
    best = this.nearestNeighborSearch(
      firstBranch,
      queryPoint,
      depth + 1,
      best,
      bestDistance,
    )
    bestDistance = this.distance(queryPoint, best)

    // Check if we need to search the second branch
    if (Math.abs(axisDiff) < bestDistance) {
      best = this.nearestNeighborSearch(
        secondBranch,
        queryPoint,
        depth + 1,
        best,
        bestDistance,
      )
    }

    return best
  }

  // Find k nearest neighbors
  findKNearestNeighbors(queryPoint: Point, k: number): Point[] {
    if (!this.root) {
      return []
    }

    const neighbors: Array<{ point: Point; distance: number }> = []

    this.kNearestNeighborSearch(this.root, queryPoint, 0, neighbors, k)

    return neighbors
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k)
      .map((n) => n.point)
  }

  private kNearestNeighborSearch(
    node: KDNode | null,
    queryPoint: Point,
    depth: number,
    neighbors: Array<{ point: Point; distance: number }>,
    k: number,
  ): void {
    if (!node) {
      return
    }

    const axis = depth % 2 ? "x" : "y"
    const currentDistance = this.distance(queryPoint, node.point)

    // Add current node to neighbors
    neighbors.push({ point: node.point, distance: currentDistance })

    // Determine which subtree to search first
    const axisDiff = queryPoint[axis] - node.point[axis]
    const firstBranch = axisDiff <= 0 ? node.left : node.right
    const secondBranch = axisDiff <= 0 ? node.right : node.left

    // Recursively search the first branch
    this.kNearestNeighborSearch(
      firstBranch,
      queryPoint,
      depth + 1,
      neighbors,
      k,
    )

    // Get the kth distance if we have k neighbors
    let kthDistance = Infinity
    if (neighbors.length >= k) {
      neighbors.sort((a, b) => a.distance - b.distance)
      kthDistance = neighbors[k - 1]?.distance || Infinity
    }

    // Search the other branch if necessary
    if (Math.abs(axisDiff) < kthDistance || neighbors.length < k) {
      this.kNearestNeighborSearch(
        secondBranch,
        queryPoint,
        depth + 1,
        neighbors,
        k,
      )
    }
  }

  // Calculate Euclidean distance between two points
  private distance(a: Point, b: Point): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
  }
}

// Disjoint Set (Union-Find) data structure for Kruskal's algorithm
export class DisjointSet {
  private parent: Map<string, string> = new Map()
  private rank: Map<string, number> = new Map()

  constructor(points: Point[]) {
    // Initialize each point as a separate set
    for (const point of points) {
      const key = this.pointToKey(point)
      this.parent.set(key, key)
      this.rank.set(key, 0)
    }
  }

  private pointToKey(point: Point): string {
    return `${point.x},${point.y}`
  }

  find(point: Point): string {
    const key = this.pointToKey(point)
    if (!this.parent.has(key)) {
      throw new Error(`Point ${key} not found in DisjointSet`)
    }

    let root = key
    while (root !== this.parent.get(root)) {
      root = this.parent.get(root)!
    }

    // Path compression
    let current = key
    while (current !== root) {
      const next = this.parent.get(current)!
      this.parent.set(current, root)
      current = next
    }

    return root
  }

  union(pointA: Point, pointB: Point): boolean {
    const rootA = this.find(pointA)
    const rootB = this.find(pointB)

    if (rootA === rootB) {
      return false // Already in the same set
    }

    // Union by rank
    const rankA = this.rank.get(rootA) || 0
    const rankB = this.rank.get(rootB) || 0

    if (rankA < rankB) {
      this.parent.set(rootA, rootB)
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA)
    } else {
      this.parent.set(rootB, rootA)
      this.rank.set(rootA, rankA + 1)
    }

    return true
  }
}

// Edge representation for Kruskal's algorithm
interface Edge<T extends Point> {
  from: T
  to: T
  weight: number
}

interface BuildMinimumSpanningTreeOptions<T extends Point> {
  extraEdges?: Edge<T>[]
}

// Main function to build a minimum spanning tree using Kruskal's algorithm
export function buildMinimumSpanningTree<T extends Point>(
  points: T[],
  opts: BuildMinimumSpanningTreeOptions<T> = {},
): Edge<T>[] {
  if (points.length <= 1) {
    return []
  }

  const pointsCopy = [...points].sort((a, b) => a.x - b.x)

  // A fixed nearest-neighbor graph can be disconnected. Dense Prim represents
  // the complete Euclidean graph exactly using O(n) memory, without storing
  // all n(n-1)/2 edges. Its MST remains sufficient when extra edges are added;
  // Kruskal below incorporates the initially connected zero-weight edges.
  const edges: Edge<T>[] = []
  const included = new Uint8Array(pointsCopy.length)
  const bestDistance = new Float64Array(pointsCopy.length).fill(Infinity)
  const parentIndex = new Int32Array(pointsCopy.length).fill(-1)
  bestDistance[0] = 0

  for (let count = 0; count < pointsCopy.length; count++) {
    let nextIndex = -1
    for (let index = 0; index < pointsCopy.length; index++) {
      if (
        !included[index] &&
        (nextIndex === -1 || bestDistance[index] < bestDistance[nextIndex])
      ) {
        nextIndex = index
      }
    }
    included[nextIndex] = 1
    const point = pointsCopy[nextIndex]!
    if (parentIndex[nextIndex] !== -1) {
      edges.push({
        from: pointsCopy[parentIndex[nextIndex]!]!,
        to: point,
        weight: bestDistance[nextIndex]!,
      })
    }

    for (let index = 0; index < pointsCopy.length; index++) {
      if (included[index]) continue
      const candidate = pointsCopy[index]!
      const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y)
      if (distance < bestDistance[index]) {
        bestDistance[index] = distance
        parentIndex[index] = nextIndex
      }
    }
  }

  if (opts.extraEdges) {
    edges.push(...opts.extraEdges)
  }

  // Sort edges by weight (distance)
  edges.sort((a, b) => a.weight - b.weight)

  // Apply Kruskal's algorithm
  const disjointSet = new DisjointSet(pointsCopy)
  const mstEdges: Edge<T>[] = []

  for (const edge of edges) {
    if (disjointSet.union(edge.from, edge.to)) {
      mstEdges.push(edge)

      // MST has n-1 edges for n points
      if (mstEdges.length === pointsCopy.length - 1) {
        break
      }
    }
  }

  return mstEdges
}
