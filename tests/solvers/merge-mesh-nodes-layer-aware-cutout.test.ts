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

test("layer cutouts preserve multi-layer capacity in common free space", (): void => {
  const globalRoutingNode: CapacityMeshNode = {
    capacityMeshNodeId: "global-routing",
    center: { x: 2.25, y: 0 },
    width: 1.5,
    height: 0.5,
    availableZ: [0],
    layer: "z0",
  }
  const componentRoutingNode: CapacityMeshNode = {
    capacityMeshNodeId: "component-routing",
    center: { x: 1.25, y: 0 },
    width: 1.5,
    height: 0.5,
    availableZ: [0, 1],
    layer: "z0,1",
  }

  const mergedNodes = mergeMeshNodes({
    globalMeshNodes: [globalRoutingNode],
    components: [createComponent()],
    componentMeshNodes: [[componentRoutingNode]],
    mergeStrategy: "concat",
  })
  const commonFreeSpaceNode = mergedNodes.find(
    (node: CapacityMeshNode): boolean =>
      node.capacityMeshNodeId.startsWith("component-routing__merge_") &&
      node.availableZ.length === 2,
  )
  const layerOneOnlyUnderCutout = mergedNodes.find(
    (node: CapacityMeshNode): boolean =>
      node.capacityMeshNodeId.startsWith("component-routing__merge_") &&
      node.availableZ.length === 1 &&
      node.availableZ[0] === 1,
  )

  expect(commonFreeSpaceNode).toMatchObject({
    center: { x: 1, y: 0 },
    width: 1,
    height: 0.5,
    availableZ: [0, 1],
  })
  expect(layerOneOnlyUnderCutout).toMatchObject({
    center: { x: 1.75, y: 0 },
    width: 0.5,
    height: 0.5,
    availableZ: [1],
  })
})
