import { expect, test } from "bun:test"
import { ApproximateHypergraphTopologySolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/ApproximateHypergraphTopologySolver"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline10 measures obstacle occupancy across region layers", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [
      {
        type: "rect",
        center: { x: 2.5, y: 5 },
        width: 5,
        height: 10,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    connections: [],
  }
  const solver = new ApproximateHypergraphTopologySolver({
    simpleRouteJson: srj,
    targetCellSize: 10,
    obstacleSamplingMargin: 0,
    generatePortsAndEdges: false,
    localRefinementDepth: 0,
  })

  solver.solve()
  const output = solver.getOutput()

  expect(output.capacityMeshNodes).toHaveLength(1)
  expect(
    output.capacityMeshNodes[0]!._obstacleOccupancyFraction,
  ).toBeCloseTo(0.25, 8)
  expect(output.stats).toMatchObject({
    obstacleOccupiedRegionCount: 1,
    meanObstacleOccupancyFraction: 0.25,
    maxObstacleOccupancyFraction: 0.25,
  })
})
