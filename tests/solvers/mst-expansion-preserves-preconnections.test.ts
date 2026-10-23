import { expect, test } from "bun:test"
import {
  buildMinimumSpanningTree,
  DisjointSet,
} from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

type Terminal = { x: number; y: number; pointId: string }

test("expand neighborhoods with preconnections and coincident terminals", (): void => {
  const points: Terminal[] = [0, 100, 1000].flatMap(
    (offset): Terminal[] =>
      Array.from({ length: 25 }, (_, index): Terminal => ({
        x: offset + index / 10,
        y: 0,
        pointId: `${offset}-${index}`,
      })),
  )
  points.push({ ...points[0]!, pointId: "coincident" })
  const preconnection = { from: points[0]!, to: points[50]!, weight: 0 }
  const edges = buildMinimumSpanningTree(points, {
    extraEdges: [preconnection],
  })
  const connected = new DisjointSet(points)

  expect(edges).toHaveLength(points.length - 2)
  expect(edges[0]).toBe(preconnection)
  for (const edge of edges) {
    expect(connected.union(edge.from, edge.to)).toBe(true)
  }
  expect(connected.componentCount).toBe(1)
})
