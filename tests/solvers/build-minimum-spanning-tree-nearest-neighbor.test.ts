import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

type Point = { x: number; y: number }

test("buildMinimumSpanningTree joins every point to its nearest neighbor", () => {
  // Scattered points of one net across a board (pads and their escape vias),
  // from a fixed-seed generator so the case is deterministic.
  const points: Point[] = []
  let seed = 1
  for (let i = 0; i < 200; i++) {
    seed = (seed * 16807) % 2147483647
    const x = (seed / 2147483647) * 50
    seed = (seed * 16807) % 2147483647
    const y = (seed / 2147483647) * 30
    points.push({ x, y })
  }

  const mstEdges = buildMinimumSpanningTree(points)

  // A minimum spanning tree always contains each point's nearest-neighbor edge
  const pointsWithoutNearestNeighborEdge = points.filter((point) => {
    let nearest: Point | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const other of points) {
      if (other === point) continue
      const distance = Math.hypot(other.x - point.x, other.y - point.y)
      if (distance < nearestDistance) {
        nearest = other
        nearestDistance = distance
      }
    }
    return !mstEdges.some(
      (edge) =>
        (edge.from === point && edge.to === nearest) ||
        (edge.from === nearest && edge.to === point),
    )
  })

  expect(mstEdges).toHaveLength(points.length - 1)
  expect(pointsWithoutNearestNeighborEdge).toHaveLength(0)
})
