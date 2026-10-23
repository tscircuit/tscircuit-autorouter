import { expect, test } from "bun:test"
import { SharedOwnershipGraphSolver, type OwnershipGraph, type OwnershipGraphTask } from "lib/solvers/HyperHighDensitySolver/SharedOwnershipGraphSolver"

test("exhausted ownership cuts preserve every exhaustively enumerated finite assignment", () => {
  const graph: OwnershipGraph = {
    vertices: Array.from({ length: 4 }, (_, x) => ({ x, y: 0, z: 0 })),
    adjacency: Array.from({ length: 4 }, () => []),
  }
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]]
  for (const [primitive, [a, b]] of edges.entries()) {
    graph.adjacency[a!]!.push({ to: b!, primitive, cost: primitive + 1 })
    graph.adjacency[b!]!.push({ to: a!, primitive, cost: primitive + 1 })
  }
  const tasks: OwnershipGraphTask[] = [
    { connectionName: "a", owner: "root-a", start: 0, end: 2 },
    { connectionName: "b", owner: "root-b", start: 1, end: 3 },
    { connectionName: "c", owner: "root-c", start: 0, end: 1 },
  ]
  const paths = tasks.map((task): number[][] => {
    const found: number[][] = []
    const visit = (vertex: number, visited: Set<number>, primitives: number[]): void => {
      if (vertex === task.end) { found.push(primitives); return }
      for (const edge of graph.adjacency[vertex]!) {
        if (visited.has(edge.to)) continue
        visit(edge.to, new Set([...visited, edge.to]), [...primitives, edge.primitive])
      }
    }
    visit(task.start, new Set([task.start]), [])
    return found
  })
  let cutCount = 0
  let conditionalCount = 0
  let feasibleCount = 0
  let impossibleCount = 0
  for (let seed = 0; seed < 64; seed++) {
    const conflicts = (left: number, right: number): boolean => {
      const a = Math.min(left, right), b = Math.max(left, right)
      return a === b || ((seed * 73 + a * 19 + b * 37) >>> ((a + b) % 5) & 3) === 0
    }
    const fixed = (task: number, primitive: number): boolean => seed % 7 === 0 && task === 2 && primitive === 0
    const feasible: number[][][] = []
    for (const a of paths[0]!) for (const b of paths[1]!) for (const c of paths[2]!) {
      const assignment = [a, b, c]
      if (assignment.some((path, task) => path.some((primitive) => fixed(task, primitive)))) continue
      if (a.some((x) => b.some((y) => conflicts(x, y))) || a.some((x) => c.some((y) => conflicts(x, y))) || b.some((x) => c.some((y) => conflicts(x, y)))) continue
      feasible.push(assignment)
    }
    const solver = new SharedOwnershipGraphSolver({ graph, tasks, primitivesConflict: conflicts, permanentlyBlocked: fixed, maxIterations: 100_000 })
    solver.solve()
    expect(solver.solved, `seed ${seed}`).toBe(feasible.length > 0)
    expect(solver.exhaustedFiniteModel).toBe(feasible.length === 0)
    if (feasible.length) feasibleCount++
    else impossibleCount++
    for (const clause of solver.learnedClauses) {
      cutCount++
      if (clause.exclusions.length) conditionalCount++
      for (const assignment of feasible) {
        if (!clause.exclusions.every((literal) => !assignment[literal.task]!.includes(literal.primitive))) continue
        expect(clause.owners.some((literal) => !assignment[literal.task]!.includes(literal.primitive))).toBe(true)
      }
    }
  }
  expect(cutCount).toBeGreaterThan(30)
  expect(conditionalCount).toBeGreaterThan(0)
  expect(feasibleCount).toBeGreaterThan(0)
  expect(impossibleCount).toBeGreaterThan(0)
})
