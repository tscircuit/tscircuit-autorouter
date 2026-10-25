import { expect, test } from "bun:test"
import { OwnerCutHighDensitySolver } from "lib/solvers/HighDensitySolver/OwnerCutHighDensitySolver"
import { validateOwnerCutRoutes } from "lib/solvers/HighDensitySolver/validateOwnerCutRoutes"
import { ownerCutParams } from "./ownerCutTestUtils"

test("owned native candidate runs charged owner cuts and accepts only physical output", (): void => {
  const params = ownerCutParams(), solver = new OwnerCutHighDensitySolver(params)
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const routes = solver.getOutput()
  expect(routes).toHaveLength(2)
  expect(params.ownerCutDiagnostics!.ownerCutQueries).toBeGreaterThan(0)
  expect(params.ownerCutDiagnostics!.ownerCutPhysicalChecks).toBe(1)
  expect(solver.iterations).toBeGreaterThanOrEqual(params.ownerCutDiagnostics!.ownerCutWork!)
  expect(validateOwnerCutRoutes(routes, { ...params,
    traceThickness: 0.1, traceMargin: 0.1 })).toBeUndefined()
})
