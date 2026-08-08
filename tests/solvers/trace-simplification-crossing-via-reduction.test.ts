import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { createCrossingViaReductionRoutes } from "tests/fixtures/crossing-via-reduction-routes"

test("Pipeline7 simplification reduces a three-via crossing to one via", () => {
  const solver = new TraceSimplificationSolver({
    hdRoutes: createCrossingViaReductionRoutes(),
    obstacles: [],
    connMap: new ConnectivityMap({
      detour_net: ["detour"],
      transition_net: ["transition"],
    }),
    colorMap: { detour: "#e53935", transition: "#1e88e5" },
    defaultViaDiameter: 0.4,
    layerCount: 2,
    enableCrossingViaReduction: true,
  })
  solver.MAX_SIMPLIFICATION_PIPELINE_LOOPS = 1

  solver.solve()

  const detour = solver.simplifiedHdRoutes.find(
    (route) => route.connectionName === "detour",
  )!
  const transition = solver.simplifiedHdRoutes.find(
    (route) => route.connectionName === "transition",
  )!
  expect(solver.failed).toBe(false)
  expect(detour.vias).toHaveLength(0)
  expect(detour.route.every((point) => point.z === 0)).toBe(true)
  expect(transition.vias).toHaveLength(1)
  expect(transition.vias[0]!.x).toBeLessThan(-2)
  expect(transition.route[0]).toMatchObject({ x: 0, y: 4, z: 1 })
  expect(transition.route.at(-1)).toMatchObject({ x: -3, y: 0, z: 0 })
})
