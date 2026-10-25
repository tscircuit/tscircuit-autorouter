import { expect, test } from "bun:test"
import { OwnerCutHighDensitySolver } from "lib/solvers/HighDensitySolver/OwnerCutHighDensitySolver"
import { validateOwnerCutRoutes } from "lib/solvers/HighDensitySolver/validateOwnerCutRoutes"
import { ownerCutParams } from "./ownerCutTestUtils"

test("frozen graph routes around immutable board copper without buying permission", (): void => {
  const params = ownerCutParams()
  params.nodeWithPortPoints.portPoints = params.nodeWithPortPoints.portPoints.slice(0, 2)
  params.obstacles = [{ type: "rect", center: { x: 0, y: 0 }, width: 0.3,
    height: 0.3, layers: ["top", "bottom"], connectedTo: [] }]
  const solver = new OwnerCutHighDensitySolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.error).toBeNull()
  expect(validateOwnerCutRoutes(solver.getOutput(), { ...params,
    traceThickness: 0.1, traceMargin: 0.1 })).toBeUndefined()
  expect(solver.getOutput()[0]!.route.some((point) => Math.abs(point.y) > 0.3)).toBe(true)
  expect(params.ownerCutDiagnostics!.ownerCutActivatedOwners).toBe(0)
})
