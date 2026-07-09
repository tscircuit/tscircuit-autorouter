import { expect, test } from "bun:test"
import { TopologyMergeSolver } from "lib/solvers/TopologyPlanningSolver/TopologyMergeSolver"
import type { SerializedTopologyComponentInput } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { CapacityMeshNode } from "lib/types"
import { getSolverSvgFrames } from "../../../fixtures/solver-svg-frames"

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function createNode({
  id,
  x,
  y,
  width,
  height,
  availableZ,
}: {
  id: string
  x: number
  y: number
  width: number
  height: number
  availableZ: number[]
}): CapacityMeshNode {
  return {
    capacityMeshNodeId: id,
    center: { x, y },
    width,
    height,
    layer: `z${availableZ.join(",")}`,
    availableZ,
  }
}

function getBounds(node: CapacityMeshNode): Bounds {
  return {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }
}

function doNodesOverlapOnSharedLayer(
  firstNode: CapacityMeshNode,
  secondNode: CapacityMeshNode,
): boolean {
  const secondZ = new Set(secondNode.availableZ)
  const hasSharedZ = firstNode.availableZ.some((z: number) => secondZ.has(z))
  if (!hasSharedZ) return false

  const firstBounds = getBounds(firstNode)
  const secondBounds = getBounds(secondNode)
  const overlapWidth =
    Math.min(firstBounds.maxX, secondBounds.maxX) -
    Math.max(firstBounds.minX, secondBounds.minX)
  const overlapHeight =
    Math.min(firstBounds.maxY, secondBounds.maxY) -
    Math.max(firstBounds.minY, secondBounds.minY)

  return overlapWidth > 1e-9 && overlapHeight > 1e-9
}

function createSolver(): TopologyMergeSolver {
  const component: SerializedTopologyComponentInput = {
    componentId: "u_overlap",
    componentKind: "bga",
    memberObstacleIds: [],
    memberObstacles: [],
    replacementObstacle: {
      obstacleId: "u_overlap_component_bounds",
      componentId: "u_overlap",
      type: "rect",
      layers: ["top", "inner1", "inner2", "bottom"],
      zLayers: [0, 1, 2, 3],
      center: { x: 1, y: 0 },
      width: 4,
      height: 4,
      connectedTo: [],
    },
  }

  return new TopologyMergeSolver({
    globalMeshNodes: [
      createNode({
        id: "global_all_but_bottom",
        x: -2,
        y: 0,
        width: 4,
        height: 4,
        availableZ: [1, 2, 3],
      }),
    ],
    components: [component],
    componentMeshNodes: [
      [
        createNode({
          id: "component_all_but_top",
          x: 1,
          y: 0,
          width: 4,
          height: 4,
          availableZ: [0, 1, 2],
        }),
      ],
    ],
    layerCount: 4,
    viaDiameter: 0.4,
  })
}

test("topology merge planarizes layered overlap into aligned interface ports", async (): Promise<void> => {
  const solver = createSolver()
  solver.solve()
  const output = solver.getOutput()
  const interfaceNode = output.topologyInterfaceMeshNodes[0]!
  const routingNodes = output.mergedMeshNodes.filter(
    (node: CapacityMeshNode) => !node._containsObstacle,
  )

  expect(output.topologyInterfaceMeshNodes).toHaveLength(1)
  expect(interfaceNode.availableZ).toEqual([1, 2])
  expect(interfaceNode.center).toEqual({ x: -0.5, y: 0 })
  expect(interfaceNode.width).toBe(1)
  expect(interfaceNode.height).toBe(4)

  expect(
    output.globalMeshNodes.some(
      (node: CapacityMeshNode) =>
        node.availableZ.join(",") === "3" &&
        node.center.x === interfaceNode.center.x &&
        node.width === interfaceNode.width,
    ),
  ).toBe(true)
  expect(
    output.componentMeshNodes
      .flat()
      .some(
        (node: CapacityMeshNode) =>
          node.availableZ.join(",") === "0" &&
          node.center.x === interfaceNode.center.x &&
          node.width === interfaceNode.width,
      ),
  ).toBe(true)

  for (let i = 0; i < routingNodes.length; i++) {
    for (let j = i + 1; j < routingNodes.length; j++) {
      expect(
        doNodesOverlapOnSharedLayer(routingNodes[i]!, routingNodes[j]!),
      ).toBe(false)
    }
  }

  await expect(
    getSolverSvgFrames({
      solver: createSolver(),
      frames: [{ type: "step", step: 1, layer: "split" }],
      columns: 1,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
