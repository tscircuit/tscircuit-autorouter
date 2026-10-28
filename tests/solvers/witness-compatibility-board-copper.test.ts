import { expect, test } from "bun:test"
import { validateRouteWitnessBoardCopper } from "lib/solvers/HighDensitySolver/validateRouteWitnessBoardCopper"
import { priorityParams } from "./priorityDagTestUtils"
import { witnessRoute } from "./witnessCompatibilityTestUtils"

test("compatibility assignment acceptance checks unrelated fixed copper without moving it", () => {
  const route = witnessRoute("a", [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }])
  const params = {
    routes: [route], node: priorityParams().nodeWithPortPoints,
    layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, clearance: 0.1,
    viaHoleDiameter: 0.15, minimumHoleGap: 0.1,
  }
  expect(validateRouteWitnessBoardCopper({ ...params, obstacles: [] }).valid).toBe(true)
  const obstacle = { type: "rect" as const, layers: ["top"], center: { x: 0, y: 0 }, width: 0.5, height: 0.5, connectedTo: [] as string[] }
  const before = JSON.stringify(obstacle)
  const blocked = validateRouteWitnessBoardCopper({ ...params, obstacles: [obstacle] })
  expect(blocked.valid).toBe(false)
  expect(blocked.issues).toBeGreaterThan(0)
  expect(JSON.stringify(obstacle)).toBe(before)
  expect(validateRouteWitnessBoardCopper({ ...params, obstacles: [{ ...obstacle, connectedTo: ["a"] }] }).valid).toBe(true)
})
