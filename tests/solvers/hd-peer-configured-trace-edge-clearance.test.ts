import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("physical trace edges use their configured copper gap independently of via and pad rules", (): void => {
  for (const q of [1, 0.25, 2]) {
    const options = createHdPeerClearanceOptions(q)
    const context = options.physicalClearanceContext
    if (!context) throw new Error("Expected physical peer fixture context")
    for (const traceToTraceClearance of [0, 0.1]) {
      const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
        ...options,
        traceThickness: 0.15,
        viaDiameter: 0.3,
        obstacleMargin: 0.15,
        physicalClearanceContext: {
          ...context,
          traceToTraceClearance,
          viaToTraceClearance: traceToTraceClearance === 0 ? 0.4 : 0,
        },
        obstacleRoutes: [
          {
            connectionName: "foreign-net",
            traceThickness: 0.15,
            viaDiameter: 0.3,
            route: [
              { x: -0.1 / q, y: 0.24 / q, z: 0 },
              { x: 0.1 / q, y: 0.24 / q, z: 0 },
            ],
            vias: [],
          },
        ],
      })
      const edge = createHdPeerNode(
        0.4 / q,
        0,
        0,
        createHdPeerNode(-0.4 / q, 0),
      )
      expect(solver.isNodeTooCloseToObstacle(edge)).toBeFalse()
      expect(solver.doesPathToParentIntersectObstacle(edge)).toBe(
        traceToTraceClearance === 0.1,
      )
      expect(
        solver.doesPathToParentIntersectObstacle(
          edge,
          solver.getPlanarObstacleQuery(edge),
        ),
      ).toBe(traceToTraceClearance === 0.1)
    }
  }
})
