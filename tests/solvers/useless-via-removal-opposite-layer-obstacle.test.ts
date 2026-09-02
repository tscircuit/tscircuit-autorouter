import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("via removal ignores opposite-layer pads when validating a same-layer shortcut", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 3, y: 1, z: 1 },
      { x: 3, y: 0, z: 1 },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [
      { x: 1, y: 0 },
      { x: 3, y: 0 },
    ],
  }
  const solver = new UselessViaRemovalSolver({
    unsimplifiedHdRoutes: [route],
    obstacles: [
      {
        type: "rect",
        center: { x: 2, y: 1 },
        width: 1,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["top_pad"],
      },
      {
        type: "rect",
        center: { x: 2, y: 0 },
        width: 1,
        height: 0.4,
        layers: ["bottom"],
        connectedTo: ["bottom_pad"],
      },
    ],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    layerCount: 2,
    preserveRouteEndpoints: true,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const optimizedRoute = solver.getOptimizedHdRoutes()?.[0]
  expect(optimizedRoute?.vias).toEqual([])
  expect(optimizedRoute?.route.every((point) => point.z === 0)).toBeTrue()
  expect(optimizedRoute?.route[0]).toEqual(route.route[0])
  expect(optimizedRoute?.route.at(-1)).toEqual(route.route.at(-1))
})
