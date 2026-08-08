import { expect, test } from "bun:test"
import { DifferentialPairPostProcessingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/differential-pair-post-processing-solver"

test("post-processing still rejects malformed external route geometry", () => {
  expect(
    () =>
      new DifferentialPairPostProcessingSolver({
        hdRoutes: [
          {
            connectionName: "P",
            traceThickness: 0.2,
            viaDiameter: 0.5,
            route: [
              { x: 0, y: 0, z: 0 },
              { x: 1, y: 1, z: 1 },
            ],
            vias: [{ x: 0, y: 0 }],
          },
        ],
        obstacles: [],
        differentialPairs: [],
        bounds: { minX: -1, maxX: 2, minY: -1, maxY: 2 },
        layerCount: 2,
      }),
  ).toThrow("moves in-plane while changing layers")
})
