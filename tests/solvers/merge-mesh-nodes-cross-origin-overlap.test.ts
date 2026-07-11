import { expect, test } from "bun:test"
import { mergeMeshNodes } from "lib/solvers/TopologyPlanningSolver/merge-mesh-nodes"
import type { SerializedTopologyComponentInput } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { CapacityMeshNode, Obstacle } from "lib/types"

function createNode({
  id,
  x,
  width,
  containsObstacle = false,
}: {
  id: string
  x: number
  width: number
  containsObstacle?: boolean
}): CapacityMeshNode {
  return {
    capacityMeshNodeId: id,
    center: { x, y: 0 },
    width,
    height: 0.5,
    availableZ: [0],
    layer: "z0",
    ...(containsObstacle
      ? { _containsObstacle: true, _containsTarget: true }
      : {}),
  }
}

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

test("merged topology prefers component obstacles and trims component routing overlap", (): void => {
  const mergedNodes: CapacityMeshNode[] = mergeMeshNodes({
    globalMeshNodes: [
      createNode({
        id: "global-duplicate-obstacle",
        x: 0,
        width: 0.5,
        containsObstacle: true,
      }),
      createNode({ id: "global-routing", x: 2.25, width: 1.5 }),
    ],
    components: [createComponent()],
    componentMeshNodes: [
      [
        createNode({
          id: "component-obstacle",
          x: 0,
          width: 0.5,
          containsObstacle: true,
        }),
        createNode({ id: "component-gapfill", x: 1.25, width: 1.5 }),
      ],
    ],
    mergeStrategy: "concat",
  })

  expect(
    mergedNodes.some(
      (node: CapacityMeshNode): boolean =>
        node.capacityMeshNodeId === "global-duplicate-obstacle",
    ),
  ).toBe(false)
  expect(
    mergedNodes.some(
      (node: CapacityMeshNode): boolean =>
        node.capacityMeshNodeId === "component-obstacle",
    ),
  ).toBe(true)

  const trimmedGapfill: CapacityMeshNode | undefined = mergedNodes.find(
    (node: CapacityMeshNode): boolean =>
      node.capacityMeshNodeId.startsWith("component-gapfill__merge_"),
  )
  expect(trimmedGapfill?.center.x).toBeCloseTo(1)
  expect(trimmedGapfill?.width).toBeCloseTo(1)
})
