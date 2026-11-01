import { expect, spyOn, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("rejects edge-invalid vias before obstacle queries while retaining valid and blocked interior checks", (): void => {
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "current",
    minDistBetweenEnteringPoints: 0.1,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    A: { x: -1, y: -1, z: 0 },
    B: { x: 1, y: 1, z: 3 },
    layerCount: 4,
    obstacleRoutes: [
      {
        connectionName: "obstacle",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: -0.8, y: -0.8, z: 1 },
          { x: -0.8, y: 0.8, z: 1 },
        ],
        vias: [],
      },
    ],
  })
  const checks = spyOn(solver, "isNodeTooCloseToObstacle")
  const margin = solver.viaDiameter / 2 + solver.obstacleMargin / 2
  try {
    for (const z of solver.availableZ) {
      for (const [x, y, expectedChecks, expectedVias] of [
        [0.9, 0, 0, 0],
        [-0.9, 0, 0, 0],
        [0, 0.9, 0, 0],
        [0, -0.9, 0, 0],
        [1 - margin + 1e-8, 0, 0, 0],
        [1 - margin, 0, 3, 3],
        [0, 0, 3, 3],
        [-0.7, 0, 3, 0],
      ]) {
        checks.mockClear()
        solver.exploredNodes.clear()
        const node: Node = { x, y, z, g: 0, h: 0, f: 0, parent: null }
        const neighbors = solver.getNeighbors(node)
        expect(
          checks.mock.calls.filter((args) => args[2] === true).length,
        ).toBe(expectedChecks)
        expect(neighbors.filter((neighbor) => neighbor.z !== z).length).toBe(
          expectedVias,
        )
      }
    }
  } finally {
    checks.mockRestore()
  }
})
