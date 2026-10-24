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
  for (const route of params.hdRoutes.slice(-2)) {
    const first = route.route[0]!
    const last = route.route.at(-1)!
    route.route = Array.from({ length: 17 }, (_, index) => ({
      x: first.x + ((last.x - first.x) * index) / 16,
      y: first.y,
      z: first.z,
    }))
  }
  const dispatched: string[] = []
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
        dispatched.push(input.sample.nodeWithPortPoints!.capacityMeshNodeId!)
        release.push((): void => {
          const sample = new Solver(input)
          sample.solve()
          resolve(sample.getOutput())
        })
      }),
  } as SolverRuntimeExecutor
  const solving = solver.solveAsync(runtime)
  expect(release).toHaveLength(4)
  expect(dispatched[0]).toBe(
    params.nodeWithPortPoints.at(-1)!.capacityMeshNodeId,
  )
  // The expensive last node is dispatched first, but the first serial node
  // still controls publication even if every other task has completed.
  for (const index of [0, 3, 2]) release[index]!()
  await Promise.resolve()
  expect(solver.activeSampleIndex).toBe(0)
  release[1]!()
  await solving
  expect(solver.getOutput()).toEqual(baseline.getOutput())
  expect(solver.stats).toEqual(baseline.stats)
  expect(solver.stats.nodeClearanceCandidateCount).toBeGreaterThan(0)
  expect(solver.iterations).toBe(baseline.iterations)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.sampleEntries).toEqual(baseline.sampleEntries)
})
