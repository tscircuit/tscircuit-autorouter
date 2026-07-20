import { expect, test } from "bun:test"
import { getGlobalMeshNodesForTopologyMerging } from "lib/solvers/TopologyPlanningSolver/get-global-mesh-nodes-for-topology-merging"
import type { SerializedTopologyComponentInput } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { CapacityMeshNode } from "lib/types"

test("clears synthetic replacement connectivity before topology merging", (): void => {
  const replacementNode: CapacityMeshNode = {
    capacityMeshNodeId: "synthetic-soic-replacement",
    center: { x: 0, y: 0 },
    width: 4,
    height: 2,
    layer: "z0,1",
    availableZ: [0, 1],
    _containsObstacle: true,
    _completelyInsideObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "synthetic-component",
    _connectedTo: ["net-1", "net-2", "net-3"],
  }
  const physicalObstacleNode: CapacityMeshNode = {
    capacityMeshNodeId: "physical-obstacle",
    center: { x: 8, y: 0 },
    width: 1,
    height: 1,
    layer: "z0",
    availableZ: [0],
    _containsObstacle: true,
    _connectedTo: ["physical-net"],
  }
  const component: SerializedTopologyComponentInput = {
    componentId: "soic-1",
    componentKind: "soic",
    memberObstacleIds: [],
    memberObstacles: [],
    replacementObstacle: {
      obstacleId: "synthetic-component",
      type: "rect",
      center: { x: 0, y: 0 },
      width: 4,
      height: 2,
      layers: ["top", "bottom"],
      connectedTo: ["net-1", "net-2", "net-3"],
    },
  }

  const output = getGlobalMeshNodesForTopologyMerging({
    meshNodes: [replacementNode, physicalObstacleNode],
    components: [component],
  })

  expect(output[0]).toEqual({
    ...replacementNode,
    _containsObstacle: undefined,
    _completelyInsideObstacle: undefined,
    _containsTarget: undefined,
    _targetConnectionName: undefined,
    _connectedTo: undefined,
  })
  expect(output[1]).toBe(physicalObstacleNode)
})
