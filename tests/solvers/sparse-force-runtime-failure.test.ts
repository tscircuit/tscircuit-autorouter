import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { Pipeline9HighDensityForceImproveSampleSolver, type Pipeline9HighDensityForceImproveSampleInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"
import { createHighDensityForceImproveRuntimeFixture } from "tests/fixtures/createHighDensityForceImproveRuntimeFixture"
import { createControlledForceImproveRuntime } from "tests/fixtures/createControlledForceImproveRuntime"

test("sparse force surfaces worker failures and rejects missing or forged activation counters", async () => {
  for (const corruption of ["missing", "negative", "truthy", "extra", "zero-kernel"]) {
    const runtime = {
      executeAsync: async (Solver: typeof Pipeline9HighDensityForceImproveSampleSolver, input: Pipeline9HighDensityForceImproveSampleInput) => {
        const sample = new Solver(structuredClone(input))
        sample.solve()
        const output = structuredClone(sample.getOutput())
        if (corruption === "missing") delete output.sparseForceStats
        else if (corruption === "negative") output.sparseForceStats!.noWritePairsSkipped = -1
        else if (corruption === "truthy") Object.assign(output.sparseForceStats!, { activated: "yes" })
        else if (corruption === "extra") Object.assign(output.sparseForceStats!, { unboundCounter: 1 })
        else output.sparseForceStats!.kernelCalls = 0
        return output
      },
    } as SolverRuntimeExecutor
    const solver = new Pipeline9HighDensityForceImproveSolver({ ...createHighDensityForceImproveRuntimeFixture(), experimentSparseForce: true })
    await expect(solver.solveAsync(runtime, 1)).rejects.toThrow("Sparse force sample")
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.improvedRoutesByIndex.size).toBe(0)
    expect(solver.sparseForceStats?.activated).toBe(false)
  }
  const controlled = createControlledForceImproveRuntime()
  const solver = new Pipeline9HighDensityForceImproveSolver({ ...createHighDensityForceImproveRuntimeFixture(), experimentSparseForce: true })
  const solving = solver.solveAsync(controlled.runtime)
  controlled.tasks[0]!.finish()
  controlled.tasks[1]!.reject(new Error("synthetic sparse worker failure"))
  for (const task of controlled.tasks.slice(2)) task.finish()
  await expect(solving).rejects.toThrow("synthetic sparse worker failure")
  expect(solver.failed).toBe(true)
  expect(solver.activeSampleIndex).toBe(1)
  expect(solver.sparseForceStats?.sampleNodes).toBe(1)
})
