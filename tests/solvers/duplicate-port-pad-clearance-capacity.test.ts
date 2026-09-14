import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { CapacityMeshNode } from "lib/types"
import { limitDuplicatePortsToRoutingCapacity } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/limitDuplicatePortsToRoutingCapacity"
import { getSharedEdgeRoutingIntervals } from "lib/solvers/UniformPortDistributionSolver/getSharedEdgeRoutingIntervals"
import { getSpacedPositionsInIntervals } from "lib/solvers/UniformPortDistributionSolver/getSpacedPositionsInIntervals"
import type {
  BoundaryRoutingGeometry,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"

test("duplicate capacity and terminal placement share pad-clear intervals on each layer", () => {
  const nodes: CapacityMeshNode[] = [-0.5, 0.5].map((x, index) => ({
    capacityMeshNodeId: `node_${index}`,
    center: { x, y: 0.22 },
    width: 1,
    height: 0.44,
    layer: "z0,1",
    availableZ: [0, 1],
  }))
  const sharedEdge: SharedEdge = {
    ownerNodeIds: ["node_0", "node_1"],
    ownerPairKey: "node_0|node_1",
    orientation: "vertical",
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0.44,
    center: { x: 0, y: 0.22 },
    length: 0.44,
    nodeSideByOwnerId: { node_0: "right", node_1: "left" },
  }
  const routingGeometry: BoundaryRoutingGeometry = {
    traceWidth: 0.1,
    traceClearance: 0.1,
    layerCount: 2,
    obstacles: [-0.1, 0.54].map((y) => ({
      type: "rect",
      center: { x: 0, y },
      width: 0.2,
      height: 0.2,
      layers: ["top"],
      connectedTo: [],
    })),
  }
  const ports: SerializedHyperGraph["ports"] = [0, 1].flatMap((z) =>
    [0, 1, 2].map((index) => ({
      portId: `port_${z}_${index}`,
      region1Id: "node_0",
      region2Id: "node_1",
      d: {
        x: 0,
        y: 0.22 + index * 0.01,
        z,
        ...(index > 0 ? { duplicatedFromPortId: `port_${z}_0` } : {}),
      },
    })),
  )
  const graph: SerializedHyperGraph = {
    ports,
    regions: nodes.map((node) => ({
      regionId: node.capacityMeshNodeId,
      d: {},
      pointIds: ports.map((port) => port.portId),
    })),
  }
  const constrained = limitDuplicatePortsToRoutingCapacity({
    graph,
    nodes,
    routingGeometry,
  })
  expect(constrained.ports.map((port) => port.portId)).toEqual([
    "port_0_0",
    "port_1_0",
    "port_1_1",
    "port_1_2",
  ])
  const graphPositions = constrained.ports.filter((port) => port.d?.z === 1)
  graphPositions.forEach((port, index) => {
    expect(port.d?.x).toBe(0)
    expect(port.d?.y).toBeCloseTo(0.02 + index * 0.2, 10)
    expect(port.d?.boundaryTraceSpacing).toBe(0.2)
  })
  const topIntervals = getSharedEdgeRoutingIntervals({
    sharedEdge,
    z: 0,
    routingGeometry,
  })
  expect(topIntervals).toHaveLength(1)
  expect(topIntervals[0]!.min).toBeCloseTo(0.15, 10)
  expect(topIntervals[0]!.max).toBeCloseTo(0.29, 10)
  expect(
    getSpacedPositionsInIntervals({
      intervals: topIntervals,
      preferredPositions: [0.22],
      spacing: 0.2,
      boundaryLabel: sharedEdge.ownerPairKey,
    }),
  ).toEqual([0.22])
  expect(() =>
    getSpacedPositionsInIntervals({
      intervals: topIntervals,
      preferredPositions: [0.2, 0.24],
      spacing: 0.2,
      boundaryLabel: sharedEdge.ownerPairKey,
    }),
  ).toThrow("insufficient copper-clear capacity")
  const bottomIntervals = getSharedEdgeRoutingIntervals({
    sharedEdge,
    z: 1,
    routingGeometry,
  })
  const bottomPositions = getSpacedPositionsInIntervals({
    intervals: bottomIntervals,
    preferredPositions: [0.02, 0.22, 0.42],
    spacing: 0.2,
    boundaryLabel: sharedEdge.ownerPairKey,
  })
  bottomPositions.forEach((position, index) =>
    expect(position).toBeCloseTo(0.02 + index * 0.2, 10),
  )
})
