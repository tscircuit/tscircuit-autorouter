import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const makeViaRoute = (connectionName: string, x: number): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x, y: 0, z: 0 },
    { x, y: 0, z: 1 },
  ],
  vias: [{ x, y: 0 }],
})

test("SameNetViaMergerSolver restores a batch that does not reduce physical vias", () => {
  const inputHdRoutes = [
    makeViaRoute("route-a", 0),
    makeViaRoute("route-b", 0.25),
  ]
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes,
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({
      net0: ["route-a", "route-b"],
    }),
  })
  const [viaA, viaB] = solver.vias

  if (!viaA || !viaB) {
    throw new Error("Expected two input vias")
  }

  // Reproduce the old cyclic failure mode: two representatives swap their
  // destinations while preserving the same number of physical vias.
  Object.defineProperty(solver, "getOffendingViaGroupsBatch", {
    value: () => [
      { keep: viaB, remove: [viaA] },
      { keep: viaA, remove: [viaB] },
    ],
  })

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBe(1)
  expect(solver.stats.stoppedAfterNoPhysicalViaReduction).toBe(true)
  expect(solver.getMergedViaHdRoutes()).toEqual(inputHdRoutes)
})
