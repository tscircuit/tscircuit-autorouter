import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

type Point = { x: number; y: number; pointId: number }
type Edge = { from: Point; to: Point; weight: number }

test("match complete-graph Kruskal with weighted extra edges", (): void => {
  const point = { x: 0, y: 0, pointId: 0 }
  const trivial: Point[][] = [[], [point], [point, { ...point, pointId: 1 }]]
  for (const points of trivial) expect(buildMinimumSpanningTree(points)).toEqual([])
  const other = { x: 2, y: 0, pointId: 1 }
  const tied = { from: other, to: point, weight: 2 }
  expect(buildMinimumSpanningTree([point, other], { extraEdges: [tied] })[0]).toBe(tied)

  for (const count of [4, 19, 47]) {
    const points = Array.from({ length: count }, (_, index): Point => ({
      x: (index * 17) % 53,
      y: (index * index + index * 11) % 29,
      pointId: index,
    }))
    const extraEdges: Edge[] = [
      { from: points.at(-1)!, to: points[0]!, weight: -2 },
      { from: points[1]!, to: points.at(-2)!, weight: 0 },
      { from: points[0]!, to: points[1]!, weight: 1000 },
      { from: points[2]!, to: points.at(-1)!, weight: 0.25 },
    ]
    const candidates = [...extraEdges]
    for (let from = 0; from < count; from++) {
      for (let to = from + 1; to < count; to++) {
        candidates.push({
          from: points[from]!,
          to: points[to]!,
          weight: Math.hypot(
            points[from]!.x - points[to]!.x,
            points[from]!.y - points[to]!.y,
          ),
        })
      }
    }
    const parents = points.map((_, index): number => index)
    const find = (index: number): number => {
      let root = index
      while (parents[root] !== root) {
        root = parents[root]!
      }
      return root
    }
    let minimumWeight = 0
    for (const edge of candidates.sort((a, b): number => a.weight - b.weight)) {
      const from = find(edge.from.pointId)
      const to = find(edge.to.pointId)
      if (from === to) continue
      parents[from] = to
      minimumWeight += edge.weight
    }

    const edges = buildMinimumSpanningTree(points, { extraEdges })
    expect(edges).toHaveLength(count - 1)
    expect(edges).toContain(extraEdges[0])
    expect(edges).not.toContain(extraEdges[2])
    expect(edges.reduce((sum, edge): number => sum + edge.weight, 0)).toBeCloseTo(
      minimumWeight,
    )
    for (let index = 0; index < count; index++) parents[index] = index
    for (const edge of edges) {
      const from = find(edge.from.pointId)
      const to = find(edge.to.pointId)
      expect(from).not.toBe(to)
      parents[from] = to
    }
    expect(new Set(points.map((point): number => find(point.pointId))).size).toBe(1)
  }
})
