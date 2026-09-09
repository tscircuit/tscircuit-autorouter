import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("physical planar points use the independent via gap without changing explicit or via-candidate margins", (): void => {
  for (const scale of [undefined, 1, 0.25, 2]) {
    const q = scale ?? 1
    for (const viaToTraceClearance of [0.1, 0.2]) {
      const options = createHdPeerClearanceOptions(scale)
      const context = options.physicalClearanceContext
      const solver = new SingleHighDensityRouteSolver({
        ...options,
        traceThickness: 0.15,
        viaDiameter: 0.3,
        obstacleMargin: 0.15,
        physicalClearanceContext: context
          ? {
              ...context,
              traceToTraceClearance: viaToTraceClearance === 0.1 ? 0.4 : 0,
              viaToTraceClearance,
            }
          : undefined,
        obstacleRoutes: [
          {
            connectionName: "foreign-net",
            traceThickness: 0.15,
            viaDiameter: 0.3,
            route: [
              { x: 0, y: 0, z: 0 },
              { x: 0, y: 0, z: 1 },
            ],
            vias: [{ x: 0, y: 0 }],
          },
        ],
      })
      const point = createHdPeerNode(0.35 / q, 0)
      const viaCandidate = createHdPeerNode(0.35 / q, 0, 1, point)
      expect(solver.obstacleSegmentIndex).toBeNull()
      expect(solver.obstacleViaIndex).not.toBeNull()
      // Physical center thresholds are .325 or .425; the old search threshold
      // is .375. Changing trace-to-trace clearance must not select either one.
      expect(solver.isNodeTooCloseToObstacle(point)).toBe(
        scale === undefined || viaToTraceClearance === 0.2,
      )
      expect(solver.isNodeTooCloseToObstacle(point, 0.1)).toBeFalse()
      expect(solver.isNodeTooCloseToObstacle(point, 0.15)).toBeTrue()
      expect(
        solver.isNodeTooCloseToObstacle(viaCandidate, undefined, true),
      ).toBeTrue()
      expect(
        solver.isNodeTooCloseToObstacle(viaCandidate, 0.1, true),
      ).toBeFalse()
      expect(
        solver.isNodeTooCloseToObstacle(viaCandidate, 0.15, true),
      ).toBeTrue()
      expect(solver.traceThickness).toBe(0.15)
      expect(solver.viaDiameter).toBe(0.3)
      expect(solver.obstacleMargin).toBe(0.15)
    }
  }
})
