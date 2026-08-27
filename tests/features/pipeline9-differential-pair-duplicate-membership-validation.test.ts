import { expect, test } from "bun:test"
import { Pipeline9DifferentialPairPostProcessingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-differential-pair-post-processing-solver"

test("Pipeline9 validates duplicate pair membership before partitioning", () => {
  const createRoute = (connectionName: string, y: number) => ({
    connectionName,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y, z: 0 },
      { x: 5, y, z: 0 },
    ],
    vias: [],
  })

  expect(
    () =>
      new Pipeline9DifferentialPairPostProcessingSolver({
        hdRoutes: [
          createRoute("P", 0),
          createRoute("N", 1),
          createRoute("OTHER", 2),
        ],
        differentialPairs: [
          { connectionNames: ["P", "N"], lengthTolerance: 0.01 },
          {
            connectionNames: ["N", "OTHER"],
            lengthTolerance: 0.01,
            minimumCenterlineDistance: 0.3,
            maximumCenterlineDistance: 0.5,
          },
        ],
        obstacles: [],
        bounds: { minX: -1, maxX: 6, minY: -1, maxY: 3 },
        layerCount: 2,
        obstacleMargin: 0.1,
      }),
  ).toThrow(/connection "N" belongs to multiple differential pairs/)
})
