import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import { routeUsesOnlyRoutingLayers } from "../helpers/route-uses-only-routing-layers"

test("a top-to-bottom four-layer route uses only allowed routing layers", () => {
  const input = {
    layerCount: 4,
    routingLayers: ["top", "bottom"],
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "outer-layers",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "bottom" },
        ],
      },
    ],
  } satisfies SimpleRouteJson

  const solver = new AutoroutingPipelineSolver7_MultiGraph(input)
  solver.solve()
  const output = solver.getOutputSimpleRouteJson()
  const route = output.traces?.[0]?.route ?? []
  const allowedLayers = new Set(["top", "bottom"])

  expect(solver.failed).toBe(false)
  expect(route.length).toBeGreaterThan(0)
  expect(
    routeUsesOnlyRoutingLayers(output.traces![0]!, allowedLayers),
  ).toBe(true)
  expect(route.some((segment) => segment.route_type === "via")).toBe(true)
  expect(
    solver.exactGeometryDrcForceImproveSolver?.params
      .enableSafeTraceLayerMoves,
  ).toBe(false)
  expect(
    solver.exactGeometryDrcForceImproveSolver?.params
      .enableViaInPadLayerMoves,
  ).toBe(false)
  const traceSimplificationStep = solver.pipelineDef.find(
    (step) => step.solverName === "traceSimplificationSolver",
  )
  const [traceSimplificationParams] =
    traceSimplificationStep!.getConstructorParams(solver)
  expect(traceSimplificationParams).toMatchObject({
    enableCrossingViaReduction: true,
  })
})
