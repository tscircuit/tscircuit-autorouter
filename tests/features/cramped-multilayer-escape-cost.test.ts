import { expect, test } from "bun:test"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

test("multilayer escape ports retain a bounded cost without the generic cramped penalty", (): void => {
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "multilayer-node",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      layer: "z0,1",
      availableZ: [0, 1],
    },
    {
      capacityMeshNodeId: "single-layer-node",
      center: { x: 2, y: 0 },
      width: 2,
      height: 2,
      layer: "z0",
      availableZ: [0],
    },
  ]
  const segments: SharedEdgeSegment[] = [
    {
      edgeId: "edge-1",
      nodeIds: ["multilayer-node", "single-layer-node"],
      start: { x: 1, y: -1 },
      end: { x: 1, y: 1 },
      availableZ: [0],
      portPoints: [
        {
          segmentPortPointId: "port-1",
          x: 1,
          y: 0,
          availableZ: [0],
          nodeIds: ["multilayer-node", "single-layer-node"],
          edgeId: "edge-1",
          connectionName: null,
          distToCentermostPortOnZ: 0,
          cramped: true,
        },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -2, maxX: 4, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [],
  }
  const solver = new MultiTargetNecessaryCrampedPortPointSolver({
    capacityMeshNodes: nodes,
    sharedEdgeSegments: segments,
    simpleRouteJson: srj,
    relaxMultilayerEscapePenalty: true,
  })

  const outputPort = solver.getOutput()[0]!.portPoints[0]!
  expect(outputPort.cramped).toBe(false)
  expect(outputPort.tinyHypergraphPortPenalty).toBe(1)
})
