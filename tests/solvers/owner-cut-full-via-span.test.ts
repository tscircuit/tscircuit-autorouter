import { expect, test } from "bun:test"
import { validateOwnerCutRoutes } from "lib/solvers/HighDensitySolver/validateOwnerCutRoutes"
import { isOwnerCutNodeEligible } from "lib/solvers/HighDensitySolver/isOwnerCutNodeEligible"
import { ownerCutParams } from "./ownerCutTestUtils"

test("physical acceptance spans full through vias and eligibility rejects incomplete layer stacks", (): void => {
  const params = ownerCutParams()
  const left = { connectionName: "via", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
    vias: [{ x: 0, y: 0 }] }
  const right = { connectionName: "inner", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -0.5, y: 0, z: 2 }, { x: 0.5, y: 0, z: 2 }], vias: [] }
  expect(validateOwnerCutRoutes([left, right], { ...params, layerCount: 4,
    nodeWithPortPoints: { ...params.nodeWithPortPoints, portPoints: [] },
    traceThickness: 0.1, traceMargin: 0.1 })).toContain("Continuous route copper")
  expect(isOwnerCutNodeEligible(params)).toBe(true)
  expect(isOwnerCutNodeEligible({ ...params, layerCount: 4 })).toBe(false)
  expect(isOwnerCutNodeEligible({ ...params, allowBlindAndBuriedVias: true })).toBe(false)
  expect(isOwnerCutNodeEligible({ ...params, priorityCoordinateScale: 1.1 })).toBe(false)
})
