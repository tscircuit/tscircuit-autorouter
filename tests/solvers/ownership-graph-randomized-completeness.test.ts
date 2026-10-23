import { expect, test } from "bun:test"
import { SharedOwnershipGraphSolver, type OwnershipGraph, type OwnershipGraphTask } from "lib/solvers/HyperHighDensitySolver/SharedOwnershipGraphSolver"

test("conditional cut backtracking matches exhaustive six-vertex three-task assignments", () => {
  const graph: OwnershipGraph = {
    vertices: Array.from({ length: 6 }, (_, x) => ({ x, y: 0, z: 0 })),
    adjacency: Array.from({ length: 6 }, () => []),
  }
  const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 3], [1, 4]]
  for (const [primitive, [a, b]] of edges.entries()) {
    graph.adjacency[a!]!.push({ to: b!, primitive, cost: 1 + primitive / 20 })
    graph.adjacency[b!]!.push({ to: a!, primitive, cost: 1 + primitive / 20 })
  }
  const tasks: OwnershipGraphTask[] = [
    { connectionName: "a", owner: "a", start: 0, end: 2 },
    { connectionName: "b", owner: "b", start: 1, end: 4 },
    { connectionName: "c", owner: "c", start: 3, end: 5 },
  ]
  const paths = tasks.map((task): number[][] => {
    const result: number[][] = []
    const visit = (vertex: number, seen: Set<number>, path: number[]): void => {
      if (vertex === task.end) { result.push(path); return }
      for (const edge of graph.adjacency[vertex]!) {
        if (seen.has(edge.to)) continue
        visit(edge.to, new Set([...seen, edge.to]), [...path, edge.primitive])
      }
    }
    visit(task.start, new Set([task.start]), [])
    return result
  })
  let conditional = 0, unit = 0, reused = 0, feasibleCases = 0, impossibleCases = 0
  for (let seed = 1; seed <= 256; seed++) {
    let state = seed * 1171
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const fraction = state / 0x100000000
      return fraction
    }
    const matrix = edges.map((_, a) => edges.map((_, b) => a === b))
    for (let a = 0; a < edges.length; a++) for (let b = a + 1; b < edges.length; b++) {
      matrix[a]![b] = matrix[b]![a] = random() < 0.08
    }
    const fixed = tasks.map(() => edges.map(() => random() < 0.04))
    const valid: number[][][] = []
    for (const a of paths[0]!) for (const b of paths[1]!) for (const c of paths[2]!) {
      const assignment = [a, b, c]
      if (assignment.some((path, task) => path.some((p) => fixed[task]![p]))) continue
      if (a.some((x) => b.some((y) => matrix[x]![y])) || a.some((x) => c.some((y) => matrix[x]![y])) || b.some((x) => c.some((y) => matrix[x]![y]))) continue
      valid.push(assignment)
    }
    const solver = new SharedOwnershipGraphSolver({
      graph, tasks, primitivesConflict: (a, b): boolean => matrix[a]![b]!,
      permanentlyBlocked: (task, primitive): boolean => fixed[task]![primitive]!, maxIterations: 100_000,
    })
    solver.solve()
    expect(solver.counters.ownershipGraphBudgetExhaustionCount, `seed ${seed}`).toBeUndefined()
    expect(solver.solved, `seed ${seed}`).toBe(valid.length > 0)
    expect(solver.exhaustedFiniteModel, `seed ${seed}`).toBe(valid.length === 0)
    if (valid.length) feasibleCases++
    else impossibleCases++
    for (const clause of solver.learnedClauses) for (const assignment of valid) {
      if (!clause.exclusions.every((literal) => !assignment[literal.task]!.includes(literal.primitive))) continue
      expect(clause.owners.some((literal) => !assignment[literal.task]!.includes(literal.primitive)), `seed ${seed}`).toBe(true)
    }
    conditional += solver.counters.ownershipGraphConditionalCutCount ?? 0
    unit += solver.counters.ownershipGraphUnitPropagationCount ?? 0
    reused += solver.counters.ownershipGraphReusedCutPruneCount ?? 0
  }
  expect(conditional).toBeGreaterThan(0)
  expect(unit).toBeGreaterThan(0)
  expect(reused).toBeGreaterThan(0)
  expect(feasibleCases).toBeGreaterThan(0)
  expect(impossibleCases).toBeGreaterThan(0)
})
