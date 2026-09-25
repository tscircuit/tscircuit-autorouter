type Point = { x: number; y: number }

interface Edge<T extends Point> {
  from: T
  to: T
  weight: number
}

interface BuildMinimumSpanningTreeOptions<T extends Point> {
  // Endpoints must be references from the input points array.
  extraEdges?: Edge<T>[]
}

type IndexedEdge = { to: number; weight: number }

// Dense Prim considers the complete geometric graph without materializing its
// quadratic edge list. Fixed-k neighbor graphs can omit required MST edges.
export function buildMinimumSpanningTree<T extends Point>(
  points: T[],
  opts: BuildMinimumSpanningTreeOptions<T> = {},
): Edge<T>[] {
  const pointIndices = new Map<T, number>()
  const extraEdges: IndexedEdge[][] = points.map(() => [])
  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(`MST point ${i} has non-finite coordinates`)
    }
    if (pointIndices.has(point)) {
      throw new Error(`MST point ${i} repeats an input point reference`)
    }
    pointIndices.set(point, i)
  }

  for (const edge of opts.extraEdges ?? []) {
    const from = pointIndices.get(edge.from)
    const to = pointIndices.get(edge.to)
    if (from === undefined || to === undefined) {
      throw new Error("MST extra edge endpoint is not an input point reference")
    }
    if (!Number.isFinite(edge.weight)) {
      throw new Error("MST extra edge has a non-finite weight")
    }
    extraEdges[from].push({ to, weight: edge.weight })
    extraEdges[to].push({ to: from, weight: edge.weight })
  }

  if (points.length <= 1) return []

  // Keep the previous Kruskal output convention: orient edges by stable x
  // order, then emit them by weight. Downstream routing uses this sequence.
  const orderedIndices = points
    .map((_, i) => i)
    .sort((a, b) => points[a].x - points[b].x)
  const ranks = points.map(() => 0)
  orderedIndices.forEach((pointIndex, rank) => {
    ranks[pointIndex] = rank
  })
  const compareEndpoints = (
    fromA: number,
    toA: number,
    fromB: number,
    toB: number,
  ): number => {
    const lowerA = Math.min(ranks[fromA], ranks[toA])
    const lowerB = Math.min(ranks[fromB], ranks[toB])
    const upperA = Math.max(ranks[fromA], ranks[toA])
    const upperB = Math.max(ranks[fromB], ranks[toB])
    return lowerA - lowerB || upperA - upperB
  }

  const visited = points.map(() => false)
  const bestWeights = points.map(() => Infinity)
  const bestFrom = points.map(() => -1)
  const mstEdges: Edge<T>[] = []
  bestWeights[0] = 0

  for (let iteration = 0; iteration < points.length; iteration++) {
    let next = -1
    for (let i = 0; i < points.length; i++) {
      if (
        !visited[i] &&
        (next === -1 ||
          bestWeights[i] < bestWeights[next] ||
          (bestWeights[i] === bestWeights[next] &&
            compareEndpoints(bestFrom[i], i, bestFrom[next], next) < 0))
      ) {
        next = i
      }
    }
    if (next === -1 || !Number.isFinite(bestWeights[next])) {
      throw new Error("MST could not reach every input point")
    }
    if (iteration > 0) {
      const from = bestFrom[next]
      if (from === -1 || !visited[from]) {
        throw new Error(`MST point ${next} has no predecessor in the tree`)
      }
      mstEdges.push({
        from: points[ranks[from] < ranks[next] ? from : next],
        to: points[ranks[from] < ranks[next] ? next : from],
        weight: bestWeights[next],
      })
    }
    visited[next] = true

    for (let i = 0; i < points.length; i++) {
      if (visited[i]) continue
      const weight = Math.hypot(
        points[next].x - points[i].x,
        points[next].y - points[i].y,
      )
      if (!Number.isFinite(weight)) {
        throw new Error(
          `MST distance between points ${next} and ${i} is non-finite`,
        )
      }
      if (
        weight < bestWeights[i] ||
        (weight === bestWeights[i] &&
          compareEndpoints(next, i, bestFrom[i], i) < 0)
      ) {
        bestWeights[i] = weight
        bestFrom[i] = next
      }
    }
    for (const edge of extraEdges[next]) {
      if (
        !visited[edge.to] &&
        (edge.weight < bestWeights[edge.to] ||
          (edge.weight === bestWeights[edge.to] &&
            compareEndpoints(next, edge.to, bestFrom[edge.to], edge.to) < 0))
      ) {
        bestWeights[edge.to] = edge.weight
        bestFrom[edge.to] = next
      }
    }
  }

  return mstEdges.sort(
    (a, b) =>
      a.weight - b.weight ||
      compareEndpoints(
        pointIndices.get(a.from)!,
        pointIndices.get(a.to)!,
        pointIndices.get(b.from)!,
        pointIndices.get(b.to)!,
      ),
  )
}
