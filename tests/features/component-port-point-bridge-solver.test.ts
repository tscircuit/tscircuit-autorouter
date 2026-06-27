import { expect, test } from "bun:test"
import { ComponentPortPointBridgeSolver } from "lib/solvers/ComponentPortPointBridgeSolver/ComponentPortPointBridgeSolver"
import type { CapacityMeshNode } from "lib/types"
import { createSideCenteredComponentPortPoints } from "lib/utils/createSideCenteredComponentPortPoints"

test("ComponentPortPointBridgeSolver creates side-centered bridge port points", () => {
  const componentBaseNode: CapacityMeshNode = {
    capacityMeshNodeId: "free-U1-gap_all",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    layer: "",
    availableZ: [0, 1],
  }
  const componentSubNode: CapacityMeshNode = {
    ...componentBaseNode,
    capacityMeshNodeId: "free-U1-gap_all__sub_0_1",
    center: { x: 0.5, y: 0 },
    width: 1,
  }
  componentSubNode._componentPortPoints =
    createSideCenteredComponentPortPoints(componentSubNode)
  const globalNode: CapacityMeshNode = {
    capacityMeshNodeId: "global-east",
    center: { x: 1.5, y: 0 },
    width: 1,
    height: 2,
    layer: "",
    availableZ: [1],
  }

  const solver = new ComponentPortPointBridgeSolver({
    capacityMeshNodes: [componentSubNode, globalNode],
    componentBaseCapacityMeshNodeIds: [componentBaseNode.capacityMeshNodeId],
    sharedEdgeSegments: [],
  })

  solver.solve()

  const bridgeSegments = solver
    .getOutput()
    .filter((segment) => segment.edgeId.startsWith("component_bridge_"))

  expect(bridgeSegments).toHaveLength(1)
  expect(bridgeSegments[0]!.nodeIds).toEqual([
    componentSubNode.capacityMeshNodeId,
    globalNode.capacityMeshNodeId,
  ])
  expect(bridgeSegments[0]!.start).toEqual({ x: 1, y: -1 })
  expect(bridgeSegments[0]!.end).toEqual({ x: 1, y: 1 })
  expect(bridgeSegments[0]!.portPoints).toEqual([
    {
      segmentPortPointId: "component_bridge_0_pp0_z1",
      x: 1,
      y: 0,
      availableZ: [1],
      nodeIds: [
        componentSubNode.capacityMeshNodeId,
        globalNode.capacityMeshNodeId,
      ],
      edgeId: "component_bridge_0",
      connectionName: null,
      distToCentermostPortOnZ: 0,
      cramped: false,
    },
  ])
})
