import { expect, test } from "bun:test"
import { getOrderedSharedEdgeSchedule } from "lib/solvers/UniformPortDistributionSolver/getOrderedSharedEdgeSchedule"

test("ordered scheduling retains closed singleton domains and selects the latest disconnected interval", (): void => {
  const rules = { length: 1, traceClearance: 0, tolerance: 0 }
  const first = { owner: "a", connectionName: "a", width: 0.25, allowed: [[0, 0], [0.5, 0.5]] as [number, number][] }
  const second = { owner: "b", connectionName: "b", width: 0.25, allowed: [[0.25, 0.25], [0.75, 0.75]] as [number, number][] }
  expect(getOrderedSharedEdgeSchedule({ ...rules, ports: [first, second] })).toMatchObject({ feasible: true, latest: [0.5, 0.75] })
  expect(getOrderedSharedEdgeSchedule({ ...rules, ports: [{ ...first, allowed: [] }, second] }).feasible).toBe(false)
  expect(getOrderedSharedEdgeSchedule({ ...rules, ports: [{ ...first, allowed: [[0.75, 0.75]] }, { ...second, allowed: [[0.5, 0.5]] }] }).feasible).toBe(false)
  expect(getOrderedSharedEdgeSchedule({ ...rules, ports: [] })).toMatchObject({ feasible: true, latest: [], gaps: [] })
})
