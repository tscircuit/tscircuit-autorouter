import { expect, test } from "bun:test"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import type { Obstacle } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("through-obstacle construction keeps same-layer points bare and preserves metadata identity", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "n",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    portPoints: [
      { connectionName: "A", x: -1, y: -1, z: 0 },
      { connectionName: "A", x: 1, y: -1, z: 1 },
      { connectionName: "B", x: -1, y: 1, z: 0 },
      { connectionName: "B", x: 1, y: 1, z: 0 },
    ],
  }
  const obstacle: Obstacle = {
    type: "rect",
    layers: ["top", "bottom"],
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    connectedTo: ["A", "B"],
  }

  for (const metadata of [undefined, { pcb_via_id: "via-1" }]) {
    obstacle.circuitJsonMetadata = metadata
    const solver = new SingleTransitionThroughObstacleIntraNodeSolver({
      nodeWithPortPoints: node,
      obstacles: [obstacle],
      layerCount: 2,
    })
    expect(solver.solved).toBe(true)
    const transition = solver.solvedRoutes.find(
      (route) => route.connectionName === "A",
    )!.route[0]!
    const sameLayer = solver.solvedRoutes.find(
      (route) => route.connectionName === "B",
    )!.route[0]!
    expect(Object.keys(transition)).toEqual([
      "x",
      "y",
      "z",
      "toNextSegmentType",
      ...(metadata ? ["toNextSegmentCircuitJsonMetadata"] : []),
    ])
    expect(transition.toNextSegmentType).toBe("through_obstacle")
    expect(transition.toNextSegmentCircuitJsonMetadata).toBe(metadata)
    expect(Object.hasOwn(transition, "toNextSegmentCircuitJsonMetadata")).toBe(
      metadata !== undefined,
    )
    expect(Object.keys(sameLayer)).toEqual(["x", "y", "z"])
    expect(sameLayer).toEqual({ x: -1, y: 1, z: 0 })
  }
})
