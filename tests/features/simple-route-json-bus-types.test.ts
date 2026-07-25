import { expect, test } from "bun:test"
import { PreprocessSimpleRouteJsonSolver } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/PreprocessSimpleRouteJsonSolver"
import type { SimpleRouteJson } from "lib"

test("preserves SimpleRouteJson bus metadata during preprocessing", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "data0",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "data1",
        pointsToConnect: [
          { x: -1, y: 1, layer: "top" },
          { x: 1, y: 1, layer: "top" },
        ],
      },
    ],
    buses: [
      {
        busId: "data",
        connectionNames: ["data0", "data1"],
        maxLengthSkew: 0.1,
      },
    ],
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  }
  const solver = new PreprocessSimpleRouteJsonSolver(srj)

  solver.solve()

  expect(solver.getOutputSimpleRouteJson().buses).toEqual(srj.buses)
})
