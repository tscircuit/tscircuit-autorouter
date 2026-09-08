import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("physical via edges and future traces use their configured gap independently of trace and pad rules", (): void => {
  for (const q of [1, 0.25, 2]) {
    const options = createHdPeerClearanceOptions(q)
    const context = options.physicalClearanceContext
    if (!context) throw new Error("Expected physical peer fixture context")
    for (const viaToTraceClearance of [0, 0.1]) {
      const physicalClearanceContext = {
        ...context,
        traceToTraceClearance: viaToTraceClearance === 0 ? 0.4 : 0,
        viaToTraceClearance,
      }
      const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(
        {
          ...options,
          traceThickness: 0.15,
          viaDiameter: 0.3,
          obstacleMargin: 0.15,
          physicalClearanceContext,
          obstacleRoutes: [
            {
              connectionName: "foreign-net",
              traceThickness: 0.15,
              viaDiameter: 0.3,
              route: [
                { x: 0, y: 0.3 / q, z: 0 },
                { x: 0, y: 0.3 / q, z: 1 },
              ],
              vias: [{ x: 0, y: 0.3 / q }],
            },
          ],
        },
      )
      const edge = createHdPeerNode(
        0.4 / q,
        0,
        0,
        createHdPeerNode(-0.4 / q, 0),
      )
      expect(solver.obstacleSegments).toHaveLength(0)
      expect(solver.getPlanarObstacleQuery(edge)).toBeUndefined()
      expect(solver.isNodeTooCloseToObstacle(edge)).toBeFalse()
      expect(solver.doesPathToParentIntersectObstacle(edge)).toBe(
        viaToTraceClearance === 0.1,
      )
      const futureSolver =
        new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
          ...options,
          traceThickness: 0.15,
          viaDiameter: 0.3,
          obstacleMargin: 0.15,
          physicalClearanceContext,
          futureConnections: [
            {
              connectionName: "foreign-net",
              points: [
                { x: -4 / q, y: 0.3 / q, z: 0 },
                { x: 4 / q, y: 0.3 / q, z: 0 },
              ],
            },
          ],
        })
      const via = createHdPeerNode(0, 0, 1)
      expect(futureSolver.isViaTooCloseToFutureConnectionTrace(via)).toBe(
        viaToTraceClearance === 0.1,
      )
      expect(futureSolver.isNodeTooCloseToObstacle(via, 0, true)).toBe(
        viaToTraceClearance === 0.1,
      )
    }
  }
})
