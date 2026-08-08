import { expect, test } from "bun:test"
import { ApproximateHypergraphTopologySolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/ApproximateHypergraphTopologySolver"

test("Pipeline10 refines coarse cells crossed by many connection hints", () => {
  const solver = new ApproximateHypergraphTopologySolver({
    simpleRouteJson: {
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: 0, maxX: 12, minY: 0, maxY: 6 },
      obstacles: [],
      connections: Array.from({ length: 6 }, (_, index) => ({
        name: `connection-${index}`,
        pointsToConnect: [
          { x: 0, y: 0.5 + index, layer: "top" as const },
          { x: 12, y: 0.5 + index, layer: "top" as const },
        ],
      })),
    },
    targetCellSize: 6,
    localRefinementDepth: 1,
    generatePortsAndEdges: false,
  })

  solver.solve()

  expect(solver.getOutput().stats).toMatchObject({
    columnCount: 2,
    rowCount: 1,
    regionCount: 8,
  })
})
