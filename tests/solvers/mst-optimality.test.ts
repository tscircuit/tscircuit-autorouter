import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

type Point = { x: number; y: number; pointId: string }
type IndexedEdge = { from: number; to: number; weight: number }

// Independent complete-graph Kruskal oracle, with integer component labels.
function kruskalWeight(points: Point[]): number {
  const edges: IndexedEdge[] = []
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      edges.push({
        from: i,
        to: j,
        weight: Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y),
      })
    }
  }
  edges.sort((a, b) => a.weight - b.weight)
  const components = points.map((_, i) => i)
  let weight = 0
  for (const edge of edges) {
    const from = components[edge.from]
    const to = components[edge.to]
    if (from === to) continue
    weight += edge.weight
    for (let i = 0; i < components.length; i++) {
      if (components[i] === to) components[i] = from
    }
  }
  return weight
}

test("MST matches a complete-graph oracle on the seeded KD-tree counterexample", () => {
  let seed = 1
  const points: Point[] = []
  for (let i = 0; i < 64; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const x = seed % 1000
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const y = seed % 1000
    points.push({ x, y, pointId: `p${i}` })
  }
  const before = [...points]
  const edges = buildMinimumSpanningTree(points)
  expect(edges).toHaveLength(points.length - 1)
  expect(edges.reduce((sum, edge) => sum + edge.weight, 0)).toBeCloseTo(
    kruskalWeight(points), 8,
  )
  expect(points).toEqual(before)
  for (const edge of edges) {
    expect(points.some((point) => point === edge.from)).toBe(true)
    expect(points.some((point) => point === edge.to)).toBe(true)
  }
})
