import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("connected and other-layer traces do not block targets", () => {
  for (const Solver of [
    SingleHighDensityRouteSolver,
    SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  ]) {
    for (const connected of [false, true]) {
      const z = connected ? 0 : 1
      const solver = new Solver({
        connectionName: "target",
        A: { x: 1, y: 1, z: 0 },
        B: { x: 8, y: 8, z: 0 },
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        minDistBetweenEnteringPoints: 0.1,
        captureSearchDebug: false,
        obstacleRoutes: [
          {
            connectionName: "obstacle",
            traceThickness: 0.15,
            viaDiameter: 0.3,
            route: [
              { x: 7, y: 8, z },
              { x: 9, y: 8, z },
            ],
            vias: [],
          },
        ],
        connMap: new ConnectivityMap(
          connected
            ? { sameNet: ["target", "obstacle"] }
            : { targetNet: ["target"], obstacleNet: ["obstacle"] },
        ),
      })
      solver.solve()
      expect(solver.failed).toBe(false)
      expect(solver.solved).toBe(true)
    }
  }
})
