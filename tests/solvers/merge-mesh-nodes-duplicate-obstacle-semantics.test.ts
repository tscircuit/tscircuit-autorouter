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
    layers: ["top", "bottom"],
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

test("duplicate component obstacles preserve global target and off-board semantics", (): void => {
  const globalObstacle: CapacityMeshNode = {
    capacityMeshNodeId: "global-obstacle",
    center: { x: 0, y: 0 },
    width: 0.5,
    height: 0.5,
    availableZ: [0],
    layer: "z0",
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "target-a",
    _isVirtualOffboard: true,
    _offboardNetName: "offboard-net-a",
    _offBoardConnectionId: "offboard-connection-a",
    _offBoardConnectedCapacityMeshNodeIds: ["global-obstacle", "peer-a"],
  }
  const componentObstacle: CapacityMeshNode = {
    capacityMeshNodeId: "component-obstacle",
    center: { x: 0, y: 0 },
    width: 0.5,
    height: 0.5,
    availableZ: [0],
    layer: "z0",
    _containsObstacle: true,
    _offBoardConnectedCapacityMeshNodeIds: ["peer-b"],
  }

  const mergedNodes = mergeMeshNodes({
    globalMeshNodes: [globalObstacle],
    components: [createComponent()],
    componentMeshNodes: [[componentObstacle]],
    mergeStrategy: "concat",
  })

  expect(mergedNodes).toHaveLength(1)
  expect(mergedNodes[0]).toMatchObject({
    capacityMeshNodeId: "component-obstacle",
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "target-a",
    _isVirtualOffboard: true,
    _offboardNetName: "offboard-net-a",
    _offBoardConnectionId: "offboard-connection-a",
  })
  expect(mergedNodes[0]?._offBoardConnectedCapacityMeshNodeIds).toEqual([
    "peer-b",
    "component-obstacle",
    "peer-a",
  ])
})
