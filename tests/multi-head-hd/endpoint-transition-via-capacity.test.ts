import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("each route can use one middle-point via for a mandatory endpoint layer transition", (): void => {
  for (const endX of [1, 0]) {
    const nodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: "endpoint-transition-capacity",
      center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
      portPoints: [
        { connectionName: "transition", x: 0, y: 0, z: 0 },
        { connectionName: "transition", x: endX, y: 0, z: 1 },
      ],
    }
    const solver = new MultiHeadPolyLineIntraNodeSolver({
      nodeWithPortPoints, hyperParameters: { SEGMENTS_PER_POLYLINE: 1 },
    })
    expect(solver.minViaCount).toBe(1)
    expect(solver.failed).toBe(false)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.solvedRoutes).toHaveLength(1)
    expect(solver.solvedRoutes[0]!.vias).toHaveLength(1)
    expect(solver.solvedRoutes[0]!.route[0]!.z).toBe(0)
    expect(solver.solvedRoutes[0]!.route.at(-1)!.z).toBe(1)
  }
})
