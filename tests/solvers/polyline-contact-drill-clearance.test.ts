import { expect, test } from "bun:test"
import { validatePolylineContactRoutes } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/validatePolylineContactRoutes"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("owner-independent drill spacing is checked separately from annulus spacing", (): void => {
  const { solver } = createPolylineContactFixture()
  const routes: HighDensityIntraNodeRoute[] = [0, 0.5].map((x, index) => ({
    connectionName: `route${index}`, rootConnectionName: "shared-net",
    traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x, y: 0, z: 0 }, { x, y: 0, z: 1 }], vias: [{ x, y: 0 }],
  }))
  expect(validatePolylineContactRoutes(routes, {
    ...solver.physicalContext, viaHoleDiameter: 0.3, minViaHoleEdgeToViaHoleEdgeClearance: 0.3,
  })).toBe("via drill edge clearance")
})
