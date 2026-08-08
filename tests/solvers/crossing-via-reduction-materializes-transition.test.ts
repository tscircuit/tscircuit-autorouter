import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver"

test("crossing via reduction materializes diagonal layer transitions", () => {
  const solver = new CrossingViaReductionSolver({
    inputHdRoutes: [
      {
        connectionName: "route",
        traceThickness: 0.15,
        viaDiameter: 0.6,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 1 },
        ],
        vias: [],
      },
    ],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    layerCount: 2,
  })

  solver.solve()

  expect(solver.getReducedHdRoutes()[0]).toMatchObject({
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
    ],
    vias: [{ x: 1, y: 0 }],
  })
  expect(solver.stats.materializedTransitionCount).toBe(1)
})
