import { expect, test } from "bun:test"
import { SparsePhysicalSingleRouteSolver } from "lib/solvers/HighDensitySolver/SparsePhysicalSingleRouteSolver"
import { crossingWire, sparseOptions, throughVia } from "./fixtures"

test("through holes occupy intermediate and remote layers while blind spans remain explicit", (): void => {
  for (const blind of [false, true]) {
    const solver = new SparsePhysicalSingleRouteSolver({
      ...sparseOptions,
      allowBlindAndBuriedVias: blind,
      obstacleRoutes: [throughVia],
    })
    expect(
      solver.isSparseEdgeLegal({
        start: { x: 1, y: 5, z: 3 },
        end: { x: 9, y: 5, z: 3 },
      }),
    ).toBe(blind)
    const remote = new SparsePhysicalSingleRouteSolver({
      ...sparseOptions,
      allowBlindAndBuriedVias: blind,
      obstacleRoutes: [
        {
          ...crossingWire,
          route: crossingWire.route.map((p): typeof p => ({ ...p, z: 3 })),
        },
      ],
    })
    expect(
      remote.isSparseEdgeLegal({
        start: { x: 5, y: 5, z: 0 },
        end: { x: 5, y: 5, z: 1 },
      }),
    ).toBe(blind)
  }
})
