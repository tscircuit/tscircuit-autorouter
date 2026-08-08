import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { PostProcessingSolver } from "@tscircuit/length-matching-solver"

test("returns routes without consuming post-processing errors", () => {
  const hdRoutes = [
    {
      connectionName: "P",
      traceThickness: 0.2,
      viaDiameter: 0.2,
      route: [
        { x: 0, y: 2, z: 0 },
        { x: 10, y: 2, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "N",
      traceThickness: 0.2,
      viaDiameter: 0.2,
      route: [
        { x: 0, y: -2, z: 0 },
        { x: 10, y: -2, z: 0 },
      ],
      vias: [],
    },
  ]
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    bounds: { minX: -2, maxX: 12, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [],
    layerCount: 2,
    minTraceWidth: 0.2,
    minViaDiameter: 0.2,
    minViaHoleDiameter: 0.1,
    minViaPadDiameter: 0.2,
  })
  solver.lengthMatchingPostProcessingSolver = {
    getOutput: () => ({
      hdRoutes,
      postProcessingErrors: [
        {
          type: "post_processing_error",
          stage: "lengthMatchingSolver",
          message: "could not improve route",
          reason: "no-meander-candidate",
          returnedRouteSource: "input-hd-routes",
        },
      ],
    }),
  } as PostProcessingSolver

  expect(solver._getOutputHdRoutes()).toBe(hdRoutes)
})
