import { expect, test } from "bun:test"
import { ApproximatePortPointLimiterSolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/ApproximatePortPointLimiterSolver"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode } from "lib/types"

test("Pipeline10 evenly caps approximate ports per layer", () => {
  const nodes: CapacityMeshNode[] = ["a", "b"].map((id, index) => ({
    capacityMeshNodeId: id,
    center: { x: index, y: 0 },
    width: 1,
    height: 1,
    layer: "z0,1",
    availableZ: [0, 1],
    _skipEndpointNetReservation: true,
  }))
  const segment: SharedEdgeSegment = {
    edgeId: "edge",
    nodeIds: ["a", "b"],
    start: { x: 0.5, y: -0.5 },
    end: { x: 0.5, y: 0.5 },
    availableZ: [0, 1],
    portPoints: [0, 1].flatMap((z) =>
      Array.from({ length: 8 }, (_, index) => ({
        segmentPortPointId: `z${z}-p${index}`,
        x: 0.5,
        y: -0.5 + index / 7,
        availableZ: [z],
        nodeIds: ["a", "b"] as [string, string],
        edgeId: "edge",
        connectionName: null,
        distToCentermostPortOnZ: Math.abs(index - 3.5),
        cramped: false,
      })),
    ),
  }
  const solver = new ApproximatePortPointLimiterSolver({
    sharedEdgeSegments: [segment],
    capacityMeshNodes: nodes,
    maxPortsPerLayerPerEdge: 3,
    obstacles: [],
    layerCount: 2,
    obstacleSamplingMargin: 0,
  })

  solver.solve()
  const output = solver.getOutput()[0]!

  expect(output.portPoints).toHaveLength(6)
  expect(
    output.portPoints.filter((port) => port.availableZ[0] === 0),
  ).toHaveLength(3)
  expect(
    output.portPoints.filter((port) => port.availableZ[0] === 1),
  ).toHaveLength(3)
  expect(solver.stats.removedPortCount).toBe(10)
})
