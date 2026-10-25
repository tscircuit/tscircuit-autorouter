import { expect, test } from "bun:test"
import { OwnerCutHighDensitySolver } from "lib/solvers/HighDensitySolver/OwnerCutHighDensitySolver"
import { ownerCutParams } from "./ownerCutTestUtils"

test("distinct terminals collapsed into one grid cell cannot become a solved route", (): void => {
  const params = ownerCutParams()
  params.nodeWithPortPoints.portPoints = [
    { x: -0.89, y: 0, z: 0, connectionName: "close" },
    { x: -0.86, y: 0, z: 0, connectionName: "close" },
  ]
  const solver = new OwnerCutHighDensitySolver(params)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.error).toContain("Owner-cut UNKNOWN: physical output rejected")
  expect(solver.error).toContain("Exact required terminal pair missing")
})
