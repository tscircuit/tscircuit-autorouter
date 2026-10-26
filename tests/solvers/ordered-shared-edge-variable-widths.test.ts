import { expect, test } from "bun:test"
import { getOrderedSharedEdgeSchedule, type OrderedSharedEdgePort } from "lib/solvers/UniformPortDistributionSolver/getOrderedSharedEdgeSchedule"

test("ordered scheduling enforces wide foreign pitch across an intervening narrow owner alias", (): void => {
  const ports: OrderedSharedEdgePort[] = [
    { owner: "a", connectionName: "wide", width: 0.5, allowed: [[0, 0]] },
    { owner: "a", connectionName: "narrow", width: 0.1, allowed: [[0, 0]] },
    { owner: "b", connectionName: "foreign", width: 0.1, allowed: [[0.195, 0.3]] },
  ]
  const rules = { length: 0.5, traceClearance: 0.1, tolerance: 0.005 }
  const blocked = getOrderedSharedEdgeSchedule({ ...rules, ports })
  expect(blocked.feasible).toBe(false)
  expect(blocked.gaps[0]![2]).toBeCloseTo(0.395, 12)
  expect(blocked.gaps[1]![2]).toBeCloseTo(0.195, 12)
  expect(getOrderedSharedEdgeSchedule({ ...rules, ports: [...ports.slice(0, 2), { ...ports[2]!, allowed: [[0.4, 0.4]] }] }).feasible).toBe(true)
})
