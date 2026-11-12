import { expect, spyOn, test } from "bun:test"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("a same-layer candidate reads board obstacle layers only when its obstacles are requested", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    portPoints: [
      { x: -0.2, y: 0, z: 0, connectionName: "A" },
      { x: 0.2, y: 0, z: 0, connectionName: "A" },
    ],
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      layers: ["top", "bottom"],
      connectedTo: ["A"],
    },
  ]
  const projection = spyOn(obstacles, "map")
  try {
    const sameLayer = new SingleTransitionThroughObstacleIntraNodeSolver({
      nodeWithPortPoints: node,
      obstacles,
      deferObstacleLayers: true,
    })
    expect(sameLayer.failed).toBe(true)
    expect(projection).not.toHaveBeenCalled()
    expect(sameLayer.obstacles[0]!.__zLayers).toEqual([0, 1])
    expect(sameLayer.obstacles).toBe(sameLayer.obstacles)
    expect(projection).toHaveBeenCalledTimes(1)
    const transition = new SingleTransitionThroughObstacleIntraNodeSolver({
      nodeWithPortPoints: {
        ...node,
        portPoints: [node.portPoints[0]!, { ...node.portPoints[1]!, z: 1 }],
      },
      obstacles,
      deferObstacleLayers: true,
    })
    expect(transition.solved).toBe(true)
    expect(transition.solvedRoutes[0]?.route[0]?.toNextSegmentType).toBe(
      "through_obstacle",
    )
  } finally {
    projection.mockRestore()
  }
})
