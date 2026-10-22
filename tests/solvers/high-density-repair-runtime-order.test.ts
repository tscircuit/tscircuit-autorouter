import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import {
  Pipeline4HighDensityRepairSampleSolver,
  type Pipeline4HighDensityRepairSampleInput,
  type Pipeline4HighDensityRepairSampleOutput,
} from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import { Pipeline4HighDensityRepairSolver } from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { createHighDensityRepairRuntimeFixture } from "../fixtures/createHighDensityRepairRuntimeFixture"

test("parallel node repairs consume out-of-order results in serial order", async (): Promise<void> => {
  const params = createHighDensityRepairRuntimeFixture()
  const baseline = new Pipeline4HighDensityRepairSolver(structuredClone(params))
  baseline.solve()
  const solver = new Pipeline4HighDensityRepairSolver(structuredClone(params))
  const release: Array<() => void> = []
  const runtime = {
    executeAsync: (
      Solver: typeof Pipeline4HighDensityRepairSampleSolver,
      input: Pipeline4HighDensityRepairSampleInput,
    ): Promise<Pipeline4HighDensityRepairSampleOutput> =>
      new Promise((resolve) => {
        release.push((): void => {
          const sample = new Solver(input)
          sample.solve()
          resolve(sample.getOutput())
        })
      }),
  } as SolverRuntimeExecutor
  const solving = solver.solveAsync(runtime)
  expect(release).toHaveLength(4)
  for (const finish of release.slice(1).reverse()) finish()
  await Promise.resolve()
  expect(solver.activeSampleIndex).toBe(0)
  release[0]()
  await solving
  expect(solver.getOutput()).toEqual(baseline.getOutput())
  expect(solver.stats).toEqual(baseline.stats)
  expect(solver.stats.nodeClearanceCandidateCount).toBeGreaterThan(0)
  expect(solver.iterations).toBe(baseline.iterations)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.sampleEntries).toEqual(baseline.sampleEntries)
})
