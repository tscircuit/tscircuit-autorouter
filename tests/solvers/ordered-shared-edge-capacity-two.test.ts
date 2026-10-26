import { expect, test } from "bun:test"
import { getOrderedSharedEdgeSchedule } from "lib/solvers/UniformPortDistributionSolver/getOrderedSharedEdgeSchedule"

test("a capacity-two legal domain rejects three foreign ports while each ordered pair fits", (): void => {
  const ports = ["a", "b", "c"].map((owner) => ({
    owner,
    connectionName: owner,
    width: 0.1,
    allowed: [[0.145, 0.44]] as [number, number][],
  }))
  const rules = { length: 0.6, traceClearance: 0.1, tolerance: 0.005 }
  expect(getOrderedSharedEdgeSchedule({ ...rules, ports }).feasible).toBe(false)
  for (const omitted of [0, 1, 2])
    expect(
      getOrderedSharedEdgeSchedule({
        ...rules,
        ports: ports.filter((_, i) => i !== omitted),
      }).feasible,
    ).toBe(true)
})
