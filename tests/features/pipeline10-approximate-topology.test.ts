import { expect, test } from "bun:test"
import { ApproximateHypergraphTopologySolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/ApproximateHypergraphTopologySolver"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline10 creates a bounded obstacle-sampled approximate topology", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 12, maxY: 6 },
    obstacles: [
      {
        type: "rect",
        center: { x: 6, y: 3 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "source_trace_1",
        pointsToConnect: [
          { x: 1, y: 1, layer: "top" },
          { x: 11, y: 5, layer: "bottom" },
        ],
      },
    ],
  }
  const solver = new ApproximateHypergraphTopologySolver({
    simpleRouteJson: srj,
    targetCellSize: 6,
    maxPortsPerLayerPerEdge: 5,
    obstacleSamplingMargin: 0,
    localRefinementDepth: 0,
  })

  solver.solve()
  const output = solver.getOutput()

  expect(output.stats).toMatchObject({
    columnCount: 2,
    rowCount: 1,
    regionCount: 2,
    edgeCount: 1,
    maxPortsPerLayerPerEdge: 5,
    localRefinementDepth: 0,
  })
  expect(output.stats.portCount).toBeLessThan(10)
  expect(output.stats.rejectedPortCount).toBeGreaterThan(0)
  expect(
    output.capacityMeshNodes.every(
      (node) => node._skipEndpointNetReservation,
    ),
  ).toBe(true)
})
