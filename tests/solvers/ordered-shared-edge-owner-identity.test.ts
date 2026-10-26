import { expect, test } from "bun:test"
import { getOrderedSharedEdgeSchedule } from "lib/solvers/UniformPortDistributionSolver/getOrderedSharedEdgeSchedule"

test("only declared same-owner or same-connection ports may share an ordered coordinate", (): void => {
  const first = { owner: "declared", connectionName: "a", width: 0.5, allowed: [[0.25, 0.25]] as [number, number][] }
  const rules = { length: 0.5, traceClearance: 0.1, tolerance: 0.005 }
  expect(getOrderedSharedEdgeSchedule({ ...rules, ports: [first, { ...first, connectionName: "alias" }] }).feasible).toBe(true)
  expect(getOrderedSharedEdgeSchedule({ ...rules, ports: [first, { ...first, owner: undefined, connectionName: "other" }] }).feasible).toBe(false)
  expect(getOrderedSharedEdgeSchedule({ ...rules, ports: [{ ...first, owner: undefined }, { ...first, owner: undefined }] }).feasible).toBe(true)
  expect(getOrderedSharedEdgeSchedule({ ...rules, ports: [{ ...first, owner: undefined }, { ...first, owner: undefined, connectionName: "other" }] }).feasible).toBe(false)
})
