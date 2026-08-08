import { expect, test } from "bun:test"
import { ApproximatePortPointLimiterSolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/ApproximatePortPointLimiterSolver"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode } from "lib/types"

test("Pipeline10 retains a penalized bridge when obstacle sampling disconnects an edge", () => {
  const nodes: CapacityMeshNode[] = ["a", "b"].map((id, index) => ({
    capacityMeshNodeId: id,
    center: { x: index, y: 0 },
    width: 1,
    height: 1,
    layer: "z0",
    availableZ: [0],
  }))
  const segment: SharedEdgeSegment = {
    edgeId: "edge",
    nodeIds: ["a", "b"],
    start: { x: 0.5, y: -0.5 },
    end: { x: 0.5, y: 0.5 },
    availableZ: [0],
    portPoints: [
      {
        segmentPortPointId: "blocked",
        x: 0.5,
        y: 0,
        availableZ: [0],
        nodeIds: ["a", "b"],
        edgeId: "edge",
        connectionName: null,
        distToCentermostPortOnZ: 0,
        cramped: false,
      },
    ],
  }
  const solver = new ApproximatePortPointLimiterSolver({
    sharedEdgeSegments: [segment],
    capacityMeshNodes: nodes,
    maxPortsPerLayerPerEdge: 3,
    obstacles: [
      {
        type: "rect",
        center: { x: 0.5, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    layerCount: 1,
    obstacleSamplingMargin: 0,
  })

  solver.solve()

  expect(solver.getOutput()[0]!.portPoints).toEqual([
    expect.objectContaining({
      segmentPortPointId: "blocked",
      tinyHypergraphPortPenalty: 1_000,
    }),
  ])
  expect(solver.stats.bridgedObstacleSegmentCount).toBe(1)
})
