import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4_TinyHypergraph } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"

const createTopOnlyCrossingInput = (): SimpleRouteJson => ({
  layerCount: 2,
  routingLayers: ["top"],
  minTraceWidth: 0.1,
  minViaPadDiameter: 0.3,
  bounds: { minX: -1.05, maxX: 1.05, minY: -1.05, maxY: 1.05 },
  obstacles: [],
  connections: [
    {
      name: "horizontal",
      pointsToConnect: [
        { x: -1, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
    {
      name: "vertical",
      pointsToConnect: [
        { x: 0, y: -1, layer: "top" },
        { x: 0, y: 1, layer: "top" },
      ],
    },
  ],
})

test("Pipeline4 fails closed when an impossible crossing has one allowed layer", () => {
  const solver = new AutoroutingPipelineSolver4_TinyHypergraph(
    createTopOnlyCrossingInput(),
    { cacheProvider: null, effort: 0.1, maxNodeDimension: 10 },
  )
  solver.solve()

  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(
    solver.highDensityNodePortPoints?.every((node) =>
      node.availableZ?.every((z) => z === 0),
    ),
  ).toBeTrue()
})
