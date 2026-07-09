import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { TopologyMergeSolver } from "lib/solvers/TopologyPlanningSolver/TopologyMergeSolver"
import type { SerializedTopologyComponentInput } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { CapacityMeshNode } from "lib/types"
import { getSolverSvgFrames } from "../../../fixtures/solver-svg-frames"

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

function createSolver(): TopologyMergeSolver {
  const component: SerializedTopologyComponentInput = {
    componentId: "u_bga",
    componentKind: "bga",
    memberObstacleIds: [],
    memberObstacles: [],
    replacementObstacle: {
      obstacleId: "u_bga_component_bounds",
      componentId: "u_bga",
      type: "rect",
      layers: ["top", "bottom"],
      zLayers: [0, 1],
      center: { x: 2.1, y: 0 },
      width: 3.8,
      height: 4,
      connectedTo: [],
    },
  }

  return new TopologyMergeSolver({
    globalMeshNodes: [
      createNode({
        id: "global_top",
        x: 0,
        y: 0,
        width: 4,
        height: 4,
        availableZ: [0],
      }),
    ],
    components: [component],
    componentMeshNodes: [
      [
        createNode({
          id: "component_bottom",
          x: 2,
          y: 0,
          width: 4,
          height: 4,
          availableZ: [1],
        }),
      ],
    ],
    layerCount: 2,
    viaDiameter: 0.4,
  })
}

test("topology merge creates explicit via-capable interface seams", async (): Promise<void> => {
  const solver = createSolver()
  solver.solve()
  const output = solver.getOutput()
  const seamNode = output.topologyInterfaceMeshNodes[0]!

  expect(output.topologyInterfaceMeshNodes).toHaveLength(1)
  expect(seamNode.availableZ).toEqual([0, 1])
  expect(seamNode.center).toEqual({ x: 1, y: 0 })
  expect(seamNode.width).toBe(2)
  expect(seamNode.height).toBe(4)

  const edgeSolver = new CapacityMeshEdgeSolver2_NodeTreeOptimization(
    output.mergedMeshNodes,
  )
  edgeSolver.solve()
  const seamEdges = edgeSolver.edges.filter((edge) =>
    edge.nodeIds.includes(seamNode.capacityMeshNodeId),
  )

  expect(
    seamEdges.some((edge) =>
      edge.nodeIds.some((nodeId) => nodeId.startsWith("global_top__merge")),
    ),
  ).toBe(true)
  expect(
    seamEdges.some((edge) =>
      edge.nodeIds.some((nodeId) =>
        nodeId.startsWith("component_bottom__merge"),
      ),
    ),
  ).toBe(true)

  await expect(
    getSolverSvgFrames({
      solver: createSolver(),
      frames: [{ type: "step", step: 1, layer: "split" }],
      columns: 1,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
