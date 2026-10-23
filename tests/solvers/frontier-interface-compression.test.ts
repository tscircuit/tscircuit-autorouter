import { expect, test } from "bun:test"
import { FiniteFrontierDecisionDiagramSolver } from "lib/solvers/HyperHighDensitySolver/FiniteFrontierDecisionDiagramSolver"

test("future-interface quotienting merges 8^8 independent route histories with exact cheapest witnesses", () => {
  const tasks = Array.from({ length: 8 }, (_, task) => ({ connectionName: `pair-${task}`, owner: `root-${task % 2}`, start: task * 2, end: task * 2 + 1 }))
  const domains = tasks.map((task, taskIndex) => Array.from({ length: 8 }, (_, choice) => ({
    key: `ordered-route-${choice}`, cost: 8 - choice + taskIndex / 10,
    vertices: [task.start, 1000 + choice, task.end], primitives: [taskIndex * 8 + choice],
  })))
  const solver = new FiniteFrontierDecisionDiagramSolver({
    tasks, domains, compatible: (): boolean => true, maxIterations: 1000, maxStatesPerLayer: 2,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.chosenIndices).toEqual(new Array<number>(8).fill(7))
  expect(solver.cost).toBeCloseTo(tasks.reduce((sum, _, task) => sum + 1 + task / 10, 0), 9)
  expect(solver.counters.frontierInterfaceMaxStateWidth).toBe(1)
  expect(solver.counters.frontierInterfaceTransitionAttemptCount).toBe(64)
  expect(solver.counters.frontierInterfaceMergedHistoryCount).toBe(56)
  expect(solver.counters.frontierInterfaceLowerCostReplacementCount).toBe(56)
  expect(solver.chosenIndices).toHaveLength(8)
  expect(Object.isFrozen(solver.domains)).toBe(true)
  expect(solver.domains.every((domain) => Object.isFrozen(domain))).toBe(true)
  expect(solver.domains.flat().every((choice) => Object.isFrozen(choice.vertices) && Object.isFrozen(choice.primitives))).toBe(true)
})
