import { expect, test } from "bun:test"
import { FiniteFrontierDecisionDiagramSolver } from "lib/solvers/HyperHighDensitySolver/FiniteFrontierDecisionDiagramSolver"

test("frontier state and work caps stop unknown without dropping physically distinguishable states", () => {
  const tasks = [{ connectionName: "a", owner: "a", start: 0, end: 1 }, { connectionName: "b", owner: "b", start: 2, end: 3 }]
  const domains = tasks.map((task) => [0, 1].map((choice) => ({ key: `${choice}`, cost: 1, vertices: [task.start, task.end], primitives: [choice] })))
  const params = {
    tasks, domains, compatible: (_a: number, x: number, _b: number, y: number): boolean => x === y,
    maxIterations: 1000, maxStatesPerLayer: 1,
  }
  const capped = new FiniteFrontierDecisionDiagramSolver(params)
  capped.solve()
  expect(capped.failed).toBe(true)
  expect(capped.error).toContain("state cap exhausted")
  expect(capped.counters.frontierInterfaceStateCapExhaustionCount).toBe(1)
  expect(capped.counters.frontierInterfaceFiniteDomainExhaustionCount).toBeUndefined()
  const exact = new FiniteFrontierDecisionDiagramSolver({ ...params, maxStatesPerLayer: 2 })
  exact.solve()
  expect(exact.solved).toBe(true)
  expect(exact.chosenIndices).toEqual([0, 0])
  const workCapped = new FiniteFrontierDecisionDiagramSolver({ ...params, maxStatesPerLayer: 2, maxIterations: 1 })
  workCapped.solve()
  expect(workCapped.failed).toBe(true)
  expect(workCapped.counters.frontierInterfaceBudgetExhaustionCount).toBe(1)
  expect(workCapped.counters.frontierInterfaceFiniteDomainExhaustionCount).toBeUndefined()
})
