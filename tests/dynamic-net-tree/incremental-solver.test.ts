import { expect, test } from "bun:test"
import { DynamicNetTreeSolver } from "lib/solvers/DynamicNetTreeSolver/DynamicNetTreeSolver"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import { options, teeProblem } from "./fixtures"

test("incremental solver records actual branch insertions and matches standalone search", () => {
  const problem = teeProblem(),
    original = structuredClone(problem)
  const solver = new DynamicNetTreeSolver(problem, options)
  const counts: number[] = []
  while (!solver.solved && !solver.failed) {
    solver.step()
    counts.push(Number(solver.stats.branches ?? 0))
  }
  expect(solver.solved).toBe(true)
  expect(counts).toEqual([1, 2, 2])
  expect(solver.getOutput().traces).toEqual(
    routeDynamicNetTree(problem, options).traces,
  )
  expect(problem).toEqual(original)
  const graphics = solver.getRecordedGraphics()
  expect(new Set(graphics.lines!.map((line) => line.step))).toEqual(
    new Set([0, 1, 2, 3]),
  )
  expect(graphics.texts![1]!.text).toContain("tree branch 1")
  expect(solver.computeProgress()).toBe(1)
})
