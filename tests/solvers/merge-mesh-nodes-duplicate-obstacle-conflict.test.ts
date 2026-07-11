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

test("duplicate obstacles with incompatible target names fail loudly", (): void => {
  const globalObstacle: CapacityMeshNode = {
    capacityMeshNodeId: "global-obstacle",
    center: { x: 0, y: 0 },
    width: 0.5,
    height: 0.5,
    availableZ: [0],
    layer: "z0",
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "global-target",
  }
  const componentObstacle: CapacityMeshNode = {
    capacityMeshNodeId: "component-obstacle",
    center: { x: 0, y: 0 },
    width: 0.5,
    height: 0.5,
    availableZ: [0],
    layer: "z0",
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "component-target",
  }

  expect(() =>
    mergeMeshNodes({
      globalMeshNodes: [globalObstacle],
      components: [createComponent()],
      componentMeshNodes: [[componentObstacle]],
      mergeStrategy: "concat",
    }),
  ).toThrow("incompatible target connection names")
})
