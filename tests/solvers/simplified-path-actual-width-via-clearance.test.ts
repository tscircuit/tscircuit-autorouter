import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("via filtering and clearance include the actual candidate copper radius", (): void => {
  const inputRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.4,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0.5, z: 0 },
      { x: -1, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 1, y: 0.5, z: 0 },
    ],
    vias: [],
  }
  const peer: HighDensityRoute = {
    connectionName: "foreign",
    traceThickness: 0.15,
    viaDiameter: 0.6,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const originalPeer = structuredClone(peer)
  for (const compatibilityOption of [undefined, false, true]) {
    for (const padClearance of [0.05, 0.3]) {
      const solver = new SingleSimplifiedPathSolver5({
        inputRoute,
        otherHdRoutes: [peer],
        obstacles: [],
        connMap: new ConnectivityMap({}),
        colorMap: {},
        minTraceToPadEdgeClearance: padClearance,
        useTraceWidthAwareClearance: compatibilityOption,
      })
      expect(solver.filteredVias).toHaveLength(1)
      expect(
        solver.isValidPathSegment(
          { x: -1, y: 0.5, z: 0 },
          { x: 1, y: 0.5, z: 0 },
        ),
      ).toBeFalse()
      expect(
        solver.isValidPathSegment(
          { x: -1, y: 0.65, z: 0 },
          { x: 1, y: 0.65, z: 0 },
        ),
      ).toBeTrue()
    }
  }
  expect(peer).toEqual(originalPeer)
})
