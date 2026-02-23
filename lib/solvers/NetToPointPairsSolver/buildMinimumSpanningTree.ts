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

// Main function to build a minimum spanning tree using Kruskal's algorithm
export function buildMinimumSpanningTree<T extends Point>(
  points: T[],
): Edge<T>[] {
  if (points.length <= 1) {
    return []
  }

  // Prevent in-place KD-tree sorting from mutating caller-owned arrays.
  const pointsCopy = [...points]

  // Build KD-Tree for efficient nearest neighbor search
  const kdTree = new KDTree(pointsCopy)

  // Generate edges with k-nearest neighbors for each point
  // This is an optimization to avoid generating all possible n(n-1)/2 edges
  const edges: Edge<T>[] = []
  const k = Math.min(10, points.length - 1) // Consider k nearest neighbors

  for (const point of pointsCopy) {
    const neighbors = kdTree.findKNearestNeighbors(point, k + 1) // +1 because it includes the point itself

    for (const neighbor of neighbors) {
      // Skip self
      if (point.x === neighbor.x && point.y === neighbor.y) {
        continue
      }

      const distance = Math.sqrt(
        (point.x - neighbor.x) ** 2 + (point.y - neighbor.y) ** 2,
      )

      edges.push({
        from: point,
        to: neighbor as T,
        weight: distance,
      })
    }
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
