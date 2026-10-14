type Point = { x: number; y: number }

interface Edge<T extends Point> {
  from: T
  to: T
  weight: number
}

interface BuildMinimumSpanningTreeOptions<T extends Point> {
  extraEdges?: Edge<T>[]
}

type IndexedEdge = { to: number; weight: number }

// Dense Prim considers the complete geometric graph without materializing its
// quadratic edge list. A fixed-neighbor graph can omit required MST edges.
export function buildMinimumSpanningTree<T extends Point>(
  points: T[],
  opts: BuildMinimumSpanningTreeOptions<T> = {},
): Edge<T>[] {
  const pointIndices = new Map<T, number>()
  const extraEdges: IndexedEdge[][] = points.map(() => [])

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(`MST point ${index} has non-finite coordinates`)
    }
    if (pointIndices.has(point)) {
      throw new Error(`MST point ${index} repeats an input point reference`)
    }
    pointIndices.set(point, index)
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

  const visited = points.map(() => false)
  const bestWeights = points.map(() => Infinity)
  const bestFrom = points.map(() => -1)
  const mstEdges: Edge<T>[] = []
  bestWeights[0] = 0

  for (let iteration = 0; iteration < points.length; iteration += 1) {
    let next = -1
    for (let index = 0; index < points.length; index += 1) {
      if (
        !visited[index] &&
        (next === -1 || bestWeights[index] < bestWeights[next])
      ) {
        next = index
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
        from: points[from],
        to: points[next],
        weight: bestWeights[next],
      })
    }
    visited[next] = true

    for (let index = 0; index < points.length; index += 1) {
      if (visited[index]) continue
      const weight = Math.hypot(
        points[next].x - points[index].x,
        points[next].y - points[index].y,
      )
      if (!Number.isFinite(weight)) {
        throw new Error(
          `MST distance between points ${next} and ${index} is non-finite`,
        )
      }
      if (weight < bestWeights[index]) {
        bestWeights[index] = weight
        bestFrom[index] = next
      }
    }

    for (const edge of extraEdges[next]) {
      if (!visited[edge.to] && edge.weight < bestWeights[edge.to]) {
        bestWeights[edge.to] = edge.weight
        bestFrom[edge.to] = next
      }
    }
  }

  return mstEdges
}
