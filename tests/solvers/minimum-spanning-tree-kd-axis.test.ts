import { expect, test } from "bun:test"
import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("MST neighbour search uses the same split axes as tree construction", () => {
  // Synthetic coordinates, independent of any private board or routing input.
  let seed = 2862
  const points = Array.from({ length: 100 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const x = (seed / 2 ** 32) * 100
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return { x, y: (seed / 2 ** 32) * 100 }
  })

  // Independent complete-graph Prim reference. For this fixture, the correct
  // ten-neighbour candidate graph contains the exact MST; reversed-axis
  // pruning misses nearby candidates and produces a longer tree.
  const visited = new Uint8Array(points.length)
  const nearestDistances = new Float64Array(points.length).fill(Infinity)
  nearestDistances[0] = 0
  let referenceLength = 0

  for (let iteration = 0; iteration < points.length; iteration++) {
    let nearestPointIndex = -1
    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      if (
        !visited[pointIndex] &&
        (nearestPointIndex === -1 ||
          nearestDistances[pointIndex] < nearestDistances[nearestPointIndex])
      ) {
        nearestPointIndex = pointIndex
      }
    }
    visited[nearestPointIndex] = 1
    referenceLength += nearestDistances[nearestPointIndex]
    const nearestPoint = points[nearestPointIndex]

    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      if (visited[pointIndex]) continue
      const point = points[pointIndex]
      nearestDistances[pointIndex] = Math.min(
        nearestDistances[pointIndex],
        Math.hypot(point.x - nearestPoint.x, point.y - nearestPoint.y),
      )
    }
  }

  const edges = buildMinimumSpanningTree(points)
  expect(edges).toHaveLength(points.length - 1)
  expect(edges.reduce((length, edge) => length + edge.weight, 0)).toBeCloseTo(
    referenceLength,
    8,
  )
})
