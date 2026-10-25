import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { ReverseCostToGoCache } from "lib/solvers/HighDensitySolver/ReverseCostToGoCache"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("native reverse values are consistent with actual clamped transitions, future selection and accepted goal disk", () => {
  const diagnostics: Record<string, number> = {}
  const cache = new ReverseCostToGoCache(diagnostics)
  const options: ConstructorParameters<typeof Native>[0] = {
    connectionName: "actual-context", regionId: "native-bound-test", obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -0.013, minY: -0.021, maxX: 1.214, maxY: 0.432 },
    A: { x: -0.013, y: 0.2, z: 0 }, B: { x: 1.214, y: 0.2, z: 1 },
    availableZ: [0, 1], viaDiameter: 0.08, traceThickness: 0.02, obstacleMargin: 0.01,
    futureConnections: [
      { connectionName: "near-future", points: [{ x: 0.12, y: 0.13, z: 0 }] },
      { connectionName: "other-layer", points: [{ x: 0.47, y: 0.31, z: 1 }] },
    ],
    captureSearchDebug: false, reversePotentialCache: cache,
  }
  let positive = 0
  let checked = 0
  for (const target of [options.B, { x: 1.193, y: 0.197, z: 0 }]) {
    const solver = new Native({ ...options, B: target })
    for (const z of [0, 1]) {
      for (let row = 0; row <= 10; row++) {
        for (let column = 0; column <= 25; column++) {
          const node: Node = {
            x: Math.min(options.bounds.maxX, options.bounds.minX + column * solver.cellStep),
            y: Math.min(options.bounds.maxY, options.bounds.minY + row * solver.cellStep),
            z, g: 0, h: 0, f: 0, parent: null,
          }
          const h = solver.getReverseCostToGo(node)
          if (h > 0) positive++
          if (z === target.z && Math.hypot(node.x - target.x, node.y - target.y) <= solver.cellStep * Math.SQRT2)
            expect(h).toBe(0)
          solver.exploredNodes.clear()
          for (const neighbor of solver.getNeighbors(node)) {
            const nextH = solver.getReverseCostToGo(neighbor)
            // computeG is the production future-force + preferred-direction objective.
            expect(h).toBeLessThanOrEqual(solver.computeG(neighbor) + nextH + 1e-8)
            checked++
          }
        }
      }
    }
  }
  const repeated = new Native(options)
  repeated.getReverseCostToGo({ ...options.A, g: 0, h: 0, f: 0, parent: null })
  expect(positive).toBeGreaterThan(100)
  expect(checked).toBeGreaterThan(1000)
  expect(diagnostics.reversePotentialCacheHits).toBeGreaterThan(0)
  expect(diagnostics.reversePotentialBuilds).toBe(2)
})
