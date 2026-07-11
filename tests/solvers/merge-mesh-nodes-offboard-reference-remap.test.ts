import { expect, test } from "bun:test"
import { mergeMeshNodes } from "lib/solvers/TopologyPlanningSolver/merge-mesh-nodes"
import type { SerializedTopologyComponentInput } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { CapacityMeshNode, Obstacle } from "lib/types"

function createComponent(): SerializedTopologyComponentInput {
  const replacementObstacle: Obstacle & { obstacleId: string } = {
    obstacleId: "component-area",
    componentId: "component-1",
    type: "rect",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    layers: ["top"],
    connectedTo: [],
  }

  return {
    componentId: "component-1",
    componentKind: "bga",
    memberObstacleIds: [],
    memberObstacles: [],
    replacementObstacle,
  }
}

test("off-board node references follow a deduplicated obstacle's retained id", (): void => {
  const globalObstacle: CapacityMeshNode = {
    capacityMeshNodeId: "global-obstacle",
    center: { x: 0, y: 0 },
    width: 0.5,
    height: 0.5,
    availableZ: [0],
    layer: "z0",
    _containsObstacle: true,
    _offBoardConnectionId: "offboard-a",
    _offBoardConnectedCapacityMeshNodeIds: ["global-obstacle", "offboard-peer"],
  }
  const offBoardPeer: CapacityMeshNode = {
    capacityMeshNodeId: "offboard-peer",
    center: { x: 3, y: 0 },
    width: 0.5,
    height: 0.5,
    availableZ: [0],
    layer: "z0",
    _containsObstacle: true,
    _offBoardConnectionId: "offboard-a",
    _offBoardConnectedCapacityMeshNodeIds: ["global-obstacle", "offboard-peer"],
  }
  const componentObstacle: CapacityMeshNode = {
    capacityMeshNodeId: "component-obstacle",
    center: { x: 0, y: 0 },
    width: 0.5,
    height: 0.5,
    availableZ: [0],
    layer: "z0",
    _containsObstacle: true,
  }

  const mergedNodes = mergeMeshNodes({
    globalMeshNodes: [globalObstacle, offBoardPeer],
    components: [createComponent()],
    componentMeshNodes: [[componentObstacle]],
    mergeStrategy: "concat",
  })
  const retainedComponentObstacle = mergedNodes.find(
    (node: CapacityMeshNode): boolean =>
      node.capacityMeshNodeId === "component-obstacle",
  )
  const retainedPeer = mergedNodes.find(
    (node: CapacityMeshNode): boolean =>
      node.capacityMeshNodeId === "offboard-peer",
  )

  expect(
    retainedComponentObstacle?._offBoardConnectedCapacityMeshNodeIds,
  ).toEqual(["component-obstacle", "offboard-peer"])
  expect(retainedPeer?._offBoardConnectedCapacityMeshNodeIds).toEqual([
    "component-obstacle",
    "offboard-peer",
  ])
})
