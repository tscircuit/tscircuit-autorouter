import { expect, test } from "bun:test"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("single-transition routes require a feasible via interval and preserve terminal anchors", () => {
  for (const center of [
    { x: 0, y: 0 },
    { x: 12.5, y: -6.5 },
  ]) {
    const dimensions: [number, number][] = [[0.4, 1], [1, 0.4], [0.5, 1]]
    for (const [width, height] of dimensions) {
      const node: NodeWithPortPoints = {
        capacityMeshNodeId: "via-region",
        center,
        width,
        height,
        availableZ: [0, 1],
        portPoints: [
          {
            x: center.x - width / 2,
            y: center.y - 0.1,
            z: 0,
            connectionName: "signal",
          },
          {
            x: center.x - width / 2,
            y: center.y + 0.1,
            z: 1,
            connectionName: "signal",
          },
        ],
      }
      const solver = new SingleTransitionIntraNodeSolver({
        nodeWithPortPoints: node,
        viaDiameter: 0.3,
        obstacleMargin: 0.1,
      })
      if (width < 0.5 || height < 0.5) {
        expect(solver.failed).toBe(true)
        expect(solver.solved).toBe(false)
        expect(solver.error).toContain("no feasible via interval")
        expect(solver.solvedRoutes).toEqual([])
        continue
      }
      expect(solver.failed).toBe(false)
      expect(solver.solved).toBe(true)
      const output = solver.solvedRoutes[0]!
      expect(output.route[0]).toEqual({
        x: node.portPoints[0]!.x,
        y: node.portPoints[0]!.y,
        z: 0,
      })
      expect(output.route.at(-1)).toEqual({
        x: node.portPoints[1]!.x,
        y: node.portPoints[1]!.y,
        z: 1,
      })
      expect(output.vias).toEqual([{ x: center.x, y: center.y }])
      expect(output.route[1]).toEqual({ x: center.x, y: center.y, z: 0 })
      expect(output.route[2]).toEqual({ x: center.x, y: center.y, z: 1 })
    }
  }
})
