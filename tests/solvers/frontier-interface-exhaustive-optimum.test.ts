import { expect, test } from "bun:test"
import { FiniteFrontierDecisionDiagramSolver, type FrontierChoice } from "lib/solvers/HyperHighDensitySolver/FiniteFrontierDecisionDiagramSolver"

test("fixed-domain frontier equivalence preserves every finite-family optimum and pair obligation", () => {
  let merged = 0, replacements = 0, feasible = 0, impossible = 0
  for (let seed = 1; seed <= 128; seed++) {
    let randomState = seed * 7919
    const random = (): number => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
      const value = randomState / 0x100000000
      return value
    }
    const taskCount = 3 + seed % 4
    const tasks = Array.from({ length: taskCount }, (_, task) => ({
      connectionName: `pair-${task}`, owner: `root-${task % 3}`, start: task * 2, end: task * 2 + 1,
    }))
    const domains: FrontierChoice[][] = tasks.map((task) => Array.from({ length: 2 + seed % 3 }, (_, choice) => ({
      key: `same-key-across-distinct-tasks-${choice}`, cost: 1 + Math.floor(random() * 20) + choice / 10,
      vertices: [task.start, 100 + choice, task.end], primitives: [choice],
    })))
    const matrices = new Map<string, boolean>()
    for (let a = 0; a < taskCount; a++) for (let b = a + 1; b < taskCount; b++) {
      for (let x = 0; x < domains[a]!.length; x++) for (let y = 0; y < domains[b]!.length; y++) matrices.set(`${a}:${x}:${b}:${y}`, random() > 0.23)
    }
    const compatible = (a: number, x: number, b: number, y: number): boolean => {
      const key = `${a}:${x}:${b}:${y}`
      const answer = matrices.get(key)
      if (answer === undefined) throw new Error("Missing exact finite compatibility entry")
      return answer
    }
    let optimum = Infinity
    const visit = (choices: number[], cost: number): void => {
      const task = choices.length
      if (task === taskCount) { optimum = Math.min(optimum, cost); return }
      for (let choice = 0; choice < domains[task]!.length; choice++) {
        if (!choices.every((previous, previousTask) => compatible(previousTask, previous, task, choice))) continue
        visit([...choices, choice], cost + domains[task]![choice]!.cost)
      }
    }
    visit([], 0)
    const solver = new FiniteFrontierDecisionDiagramSolver({ tasks, domains, compatible, maxIterations: 100_000, maxStatesPerLayer: 100_000 })
    solver.solve()
    expect(solver.solved, `seed ${seed}`).toBe(Number.isFinite(optimum))
    if (solver.solved) {
      feasible++
      expect(solver.cost).toBeCloseTo(optimum, 9)
      expect(solver.chosenIndices).toHaveLength(taskCount)
      for (let a = 0; a < taskCount; a++) for (let b = a + 1; b < taskCount; b++) expect(compatible(a, solver.chosenIndices[a]!, b, solver.chosenIndices[b]!)).toBe(true)
    } else {
      impossible++
      expect(solver.error).toContain("board feasibility remains unknown")
    }
    merged += solver.counters.frontierInterfaceMergedHistoryCount ?? 0
    replacements += solver.counters.frontierInterfaceLowerCostReplacementCount ?? 0
  }
  expect(merged).toBeGreaterThan(0)
  expect(replacements).toBeGreaterThan(0)
  expect(feasible).toBeGreaterThan(0)
  expect(impossible).toBeGreaterThan(0)
})
