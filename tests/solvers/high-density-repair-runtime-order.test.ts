import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import {
  Pipeline4HighDensityRepairSampleSolver,
  type Pipeline4HighDensityRepairSampleInput,
  type Pipeline4HighDensityRepairSampleOutput,
} from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import { Pipeline4HighDensityRepairSolver } from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { createHighDensityRepairRuntimeFixture } from "../fixtures/createHighDensityRepairRuntimeFixture"

test("costly node repairs start first but publish out-of-order results in serial order", async (): Promise<void> => {
  const params = createHighDensityRepairRuntimeFixture()
  const denseRoute = params.hdRoutes.at(-1)!
  const [start, , end] = denseRoute.route
  denseRoute.route = Array.from({ length: 9 }, (_, index) => ({
    x: start!.x + ((end!.x - start!.x) * index) / 8,
    y: start!.y,
    z: start!.z,
  }))
  const baseline = new Pipeline4HighDensityRepairSolver(structuredClone(params))
  baseline.solve()
  const solver = new Pipeline4HighDensityRepairSolver(structuredClone(params))
  const release: Array<{ nodeId: string; finish: () => void }> = []
  const runtime = {
    executeAsync: (
      Solver: typeof Pipeline4HighDensityRepairSampleSolver,
      input: Pipeline4HighDensityRepairSampleInput,
    ): Promise<Pipeline4HighDensityRepairSampleOutput> =>
      new Promise((resolve) => {
        release.push({
          nodeId: input.sample.nodeWithPortPoints!.capacityMeshNodeId!,
          finish: (): void => {
            const sample = new Solver(input)
            sample.solve()
            resolve(sample.getOutput())
          },
        })
      }),
  } as SolverRuntimeExecutor
  const solving = solver.solveAsync(runtime)
  expect(release).toHaveLength(4)
  expect(release[0]!.nodeId).toBe("repair-node-3")
  for (const entry of release.toReversed()) {
    if (entry.nodeId !== "repair-node-0") entry.finish()
  }
  await Promise.resolve()
  expect(solver.activeSampleIndex).toBe(0)
  release.find((entry) => entry.nodeId === "repair-node-0")!.finish()
  await solving
  expect(solver.getOutput()).toEqual(baseline.getOutput())
  expect(solver.stats).toEqual(baseline.stats)
  expect(solver.stats.nodeClearanceCandidateCount).toBeGreaterThan(0)
  expect(solver.iterations).toBe(baseline.iterations)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.sampleEntries).toEqual(baseline.sampleEntries)
})
