import { expect, test } from "bun:test"
import { SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("path sampling preserves a via after a segment shorter than its minimum step", (): void => {
  // Reduced from SRJ18 sample 2: the segment before the second via is 0.1mm,
  // shorter than the sampler's 0.25mm minimum step.
  const inputRoute: HighDensityRoute = {
    connectionName: "route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -7.6369, y: 2.6892, z: 0 },
      { x: -8.513206615027647, y: 2.4598931410337457, z: 0 },
      { x: -8.563206615027646, y: 2.0098931410337464, z: 0 },
      { x: -8.613206615027647, y: 0.9598931410337457, z: 0 },
      { x: -8.613206615027647, y: 0.9598931410337457, z: 1 },
      { x: -4.513206615027647, y: -1.590106858966255, z: 1 },
      { x: -4.413206615027647, y: -1.590106858966255, z: 1 },
      { x: -4.413206615027647, y: -1.590106858966255, z: 0 },
      { x: -2.9132066150276454, y: -3.340106858966254, z: 0 },
      { x: -2.8632066150276465, y: -4.2401068589662545, z: 0 },
      { x: -2.8632066150276465, y: -5.340106858966254, z: 0 },
      { x: -2.9744, y: -5.9733, z: 0 },
    ],
    vias: [
      { x: -8.613206615027647, y: 0.9598931410337457 },
      { x: -4.413206615027647, y: -1.590106858966255 },
    ],
  }
  const otherHdRoutes: HighDensityRoute[] = [
    { x: -4.8632066150276465, y: -0.7901068589662543 },
    { x: -4.713206615027646, y: -1.890106858966254 },
    { x: -6.6132066150276465, y: -0.6901068589662547 },
    { x: -6.1132066150276465, y: -0.2401068589662536 },
  ].map(
    (via, index): HighDensityRoute => ({
      connectionName: `blocking_via_${index}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [],
      vias: [via],
    }),
  )
  const solver = new SingleSimplifiedPathSolver5({
    inputRoute,
    otherHdRoutes,
    obstacles: [],
    connMap: new ConnectivityMap({ net: ["route"] }),
    colorMap: {},
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.simplifiedRoute.vias).toEqual(inputRoute.vias)
  expect(() =>
    canonicalizePipeline9HdRoutes([solver.simplifiedRoute]),
  ).not.toThrow()
  expect(solver.simplifiedRoute.route[0]).toEqual(inputRoute.route[0])
  expect(solver.simplifiedRoute.route.at(-1)).toEqual(inputRoute.route.at(-1))
})
