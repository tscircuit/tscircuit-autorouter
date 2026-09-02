import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("trace simplification preserves clearance when moving a section between layers", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: -1, y: 0, z: 1 },
      { x: 3, y: 0, z: 1 },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [
      { x: -1, y: 0 },
      { x: 3, y: 0 },
    ],
  }
  const nearbyRoute: HighDensityRoute = {
    connectionName: "other_net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0.2, z: 0 },
      { x: 2, y: 0.2, z: 0 },
    ],
    vias: [],
  }
  const solver = new TraceSimplificationSolver({
    hdRoutes: [route],
    otherHdRoutes: [nearbyRoute],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
    preserveRouteEndpoints: true,
  })
  solver.step()
  const viaRemoval = solver.activeSubSolver
  expect(viaRemoval).toBeInstanceOf(UselessViaRemovalSolver)
  viaRemoval!.solve()
  const output = (
    viaRemoval as UselessViaRemovalSolver
  ).getOptimizedHdRoutes()!
  expect(output[0]!.vias).toEqual(route.vias)
  expect(output[0]!.route.some((point) => point.z === 1)).toBeTrue()
})
