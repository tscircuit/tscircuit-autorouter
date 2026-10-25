import { expect, test } from "bun:test"
import { validatePolylineContactRoutes } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/validatePolylineContactRoutes"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("final physical validation checks through-via copper on unused intermediate routing layers", (): void => {
  const { context: physicalContext } = createPolylineContactFixture()
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "a", traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }],
      vias: [{ x: 0, y: 0 }] },
    { connectionName: "b", traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: -1, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }], vias: [] },
  ]
  const context = { ...physicalContext, layerCount: 4, allowBlindAndBuriedVias: false }
  expect(validatePolylineContactRoutes(routes, context)).not.toBeNull()
  expect(validatePolylineContactRoutes(routes, { ...context, allowBlindAndBuriedVias: true })).toBeNull()
})
