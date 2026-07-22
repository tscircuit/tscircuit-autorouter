import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline 7 keeps provenance on virtual pairs and original output connections", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 3, minY: -1, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "original_connection",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "A" },
          { x: 2, y: 0, layer: "top", pointId: "B" },
        ],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()

  expect(
    solver.srjWithPointPairs?.connections.map(
      (connection) => connection.__originalSrjConnectionName,
    ),
  ).toEqual(["original_connection"])
  expect(solver.getOutputSimpleRouteJson().connections).toEqual(
    srj.connections,
  )
})
