import { expect, spyOn, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Solver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("task score caching preserves coordinate aliases, arrival modes and fresh parent costs", (): void => {
  const opts = {
    connectionName: "signal",
    obstacleRoutes: [],
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    minDistBetweenEnteringPoints: 0.05,
    A: { x: -2, y: -2, z: 0 },
    B: { x: 2, y: 2, z: 0 },
    layerCount: 3,
    cacheNodeCosts: true,
    futureConnections: [{ connectionName: "foreign", points: [
      { x: 0.25, y: 0.5, z: 0 },
      { x: -0.25, y: -0.5, z: 1 },
    ] }],
  }
  const first = new Solver(opts)
  const second = new Solver({
    ...opts,
    hyperParameters: { FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 7 },
  })
  const parent: Node = { x: -0.1, y: 0, z: 0, g: 1, h: 0, f: 0, parent: null }
  const point: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent }
  expect(first.getNodeKey({ ...point, x: 0.004, y: 0.005 })).toBe(first.getNodeKey(point))
  for (const solver of [first, second]) {
    for (const node of [point, { ...point, x: 0.004, y: 0.005 }, point,
      { ...point, parent: { ...parent, z: 1 } },
      { ...point, parent: { ...parent, g: 99 } }]) {
      const expectedG = solver.computeG(node)
      const expectedH = solver.computeH(node)
      solver.setNodeCosts(node)
      expect(node.g).toBe(expectedG)
      expect(node.h).toBe(expectedH)
      expect(node.f).toBe(solver.computeF(expectedG, expectedH))
    }
  }
  first.setNodeCosts(point)
  const penalty = spyOn(first, "getFutureConnectionPenalty")
  try {
    first.setNodeCosts({ ...point, parent: { ...parent, g: 123 } })
    expect(penalty).not.toHaveBeenCalled()
  } finally {
    penalty.mockRestore()
  }
})
