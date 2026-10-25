import { expect, test } from "bun:test"
import { validateOwnerCutRoutes } from "lib/solvers/HighDensitySolver/validateOwnerCutRoutes"
import { ownerCutParams } from "./ownerCutTestUtils"

test("same-owner permissions never waive distinct physical drill clearance", (): void => {
  const params = ownerCutParams()
  const route = { connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 },
      { x: 0.1, y: 0, z: 1 }, { x: 0.1, y: 0, z: 0 }],
    vias: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }] }
  expect(validateOwnerCutRoutes([route], { ...params,
    nodeWithPortPoints: { ...params.nodeWithPortPoints, portPoints: [] },
    traceThickness: 0.1, traceMargin: 0.1 })).toContain("Distinct physical via drills")
})
