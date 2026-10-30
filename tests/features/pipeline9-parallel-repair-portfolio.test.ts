import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../../lib"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("four repair workers retain the full strategy and publish reference-valid copper", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 13)
  const input = structuredClone(scenario)
  const before = JSON.stringify(input)
  const solver = new Pipeline9(input, { effort: 1, cacheProvider: null })
  const runtime = new SolverRuntime({
    workerCount: 4,
    workerUrl: new URL("../../lib/runtime/node.worker.ts", import.meta.url),
    requireWorker: true,
  })
  const warmups: number[] = []
  let pendingRepairs = 0
  const executor: SolverRuntimeExecutor = {
    executeAsync: ((...args: Parameters<typeof runtime.executeAsync>) => {
      const [Solver, task] = args
      const repair = typeof Solver !== "string" && Solver.solverName === "Pipeline9JointRepairCandidateSolver"
      if (repair) {
        warmups.push((task as { forceWarmup: number }).forceWarmup)
        pendingRepairs++
      }
      return runtime.executeAsync(Solver, task).finally((): void => {
        if (repair) pendingRepairs--
      })
    }) as SolverRuntimeExecutor["executeAsync"],
  }
  try {
    await solver.solveAsync(executor)
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(warmups).toEqual([2, 4, 8, 16])
    expect(pendingRepairs).toBe(0)
    expect(solver.pipeline9JointDrcRepairSolver!.stats.parallelRepairCandidate).toBeGreaterThanOrEqual(0)
    expect(solver.pipeline9JointDrcRepairSolver!.stats.parallelRepairCandidate).toBeLessThan(4)
    expect(evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
      includeBoardClearance: true,
    }).errors).toEqual([])
    expect(JSON.stringify(input)).toBe(before)
  } finally {
    await runtime.dispose()
  }
})
