type Point = { x: number; y: number }

export class DisjointSet {
  private parent: Map<string, string> = new Map()
  private rank: Map<string, number> = new Map()
  componentCount: number

  constructor(points: Point[]) {
    // Initialize each point as a separate set
    for (const point of points) {
      const key = this.pointToKey(point)
      this.parent.set(key, key)
      this.rank.set(key, 0)
    }
    this.componentCount = this.parent.size
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

    this.componentCount -= 1
    return true
  }
}

interface Edge<T extends Point> {
  from: T
  to: T
  weight: number
}

interface BuildMinimumSpanningTreeOptions<T extends Point> {
  extraEdges?: Edge<T>[]
}

type IndexedEdge<T extends Point> = { toIndex: number; edge: Edge<T> }

// Dense Prim considers every terminal pair, so separated clusters stay connected.
export function buildMinimumSpanningTree<T extends Point>(
  points: T[],
  opts: BuildMinimumSpanningTreeOptions<T> = {},
): Edge<T>[] {
  // Coincident terminals share a vertex; keep the caller's original objects.
  const uniquePoints = [
    ...new Map(points.map((point) => [`${point.x},${point.y}`, point] as const)).values(),
  ]
  if (uniquePoints.length <= 1) return []
  const pointIndices = new Map(
    uniquePoints.map((point, index) => [`${point.x},${point.y}`, index]),
  )
  const extraEdges: IndexedEdge<T>[][] = uniquePoints.map(() => [])
  for (const edge of opts.extraEdges ?? []) {
    const fromIndex = pointIndices.get(`${edge.from.x},${edge.from.y}`)
    const toIndex = pointIndices.get(`${edge.to.x},${edge.to.y}`)
    if (fromIndex === undefined || toIndex === undefined) {
      throw new Error("Extra edge endpoints must be present in points")
    }
    extraEdges[fromIndex]!.push({ toIndex, edge })
    extraEdges[toIndex]!.push({ toIndex: fromIndex, edge })
  }

  const visited = new Uint8Array(uniquePoints.length)
  const distances = new Float64Array(uniquePoints.length).fill(Infinity)
  const nearestEdges: (Edge<T> | undefined)[] = new Array(uniquePoints.length)
  const mstEdges: Edge<T>[] = []
  distances[0] = 0

  for (let count = 0; count < uniquePoints.length; count++) {
    let next = -1
    for (let index = 0; index < uniquePoints.length; index++) {
      if (!visited[index] && (next === -1 || distances[index]! < distances[next]!)) {
        next = index
      }
    }
    visited[next] = 1
    const nearest = nearestEdges[next]
    if (nearest) mstEdges.push(nearest)
    const from = uniquePoints[next]!

    for (let index = 0; index < uniquePoints.length; index++) {
      if (visited[index]) continue
      const to = uniquePoints[index]!
      const weight = Math.sqrt((from.x - to.x) ** 2 + (from.y - to.y) ** 2)
      if (weight < distances[index]!) {
        distances[index] = weight
        nearestEdges[index] = { from, to, weight }
      }
    }
    // Supplied edges win ties, retaining zero-weight preconnections and metadata.
    for (const { toIndex, edge } of extraEdges[next]!) {
      if (!visited[toIndex] && edge.weight <= distances[toIndex]!) {
        distances[toIndex] = edge.weight
        nearestEdges[toIndex] = edge
      }
    }
  }
  return mstEdges.sort((a, b) => a.weight - b.weight)
}
