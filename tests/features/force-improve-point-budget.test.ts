import { expect, test } from "bun:test"
import { BoundedHighDensityForceImproveSolver } from "lib/solvers/HighDensitySolver/BoundedHighDensityForceImproveSolver"

test("force improvement preserves a routed region above its point budget", (): void => {
  const route = {
    connectionName: "dense-grid",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: Array.from({ length: 4_097 }, (_, index) => ({
      x: index % 2,
      y: index / 1_000,
      z: 0,
    })),
    vias: [],
    regionId: "dense-node",
  }
  const solver = new BoundedHighDensityForceImproveSolver({
    nodeWithPortPoints: [
      {
        capacityMeshNodeId: "dense-node",
        center: { x: 0.5, y: 2.048 },
        width: 2,
        height: 5,
        portPoints: [],
      },
    ],
    hdRoutes: [route],
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.getOutput()[0]).toBe(route)
  expect(solver.stats.protectedOverBudgetRouteCount).toBe(1)
})
