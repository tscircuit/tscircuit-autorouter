import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "high-density-repair03/lib"
import { AutoroutingPipelineSolver9_Parallel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { ParallelPipeline9GlobalDrcForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9GlobalDrcForceImproveSolver"
import { ParallelPipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9JointDrcRepairSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { Pipeline9MemoizedGlobalDrcForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9MemoizedGlobalDrcForceImproveSolver"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"
import { createParallelGlobalDrcFixture } from "../fixtures/parallel-global-drc-fixture"

test("standalone native force uses the shared pool through all root async drivers and refreshes Joint/native contexts", async (): Promise<void> => {
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    for (const driver of ["step", "until", "solve"] as const) {
      for (const safe of [false, true]) {
        const fixture = createBoundedRegionalRepairFixture(3)
        const params = { srj: fixture.originalSrj as SimpleRouteJson, hdRoutes: fixture.routes,
          connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj), effort: 1,
          maxIterations: 4, enableSafeTraceLayerMoves: safe,
          enableLargeBoardBroadFallback: false, enablePostSolveClearanceRelaxation: false }
        const native = new Pipeline9MemoizedGlobalDrcForceImproveSolver(params)
        native.solve()
        const root = new AutoroutingPipelineSolver9_Parallel(fixture.originalSrj, { workerPool: pool, cacheProvider: null })
        const originalStage = root.pipelineDef.find((stage) => stage.solverName === "globalDrcForceImproveSolver")
        if (!originalStage) throw new Error("Standalone root fixture is missing its original stage")
        const wrappedParams = { ...params, workerPool: pool }
        root.pipelineDef = [{ ...originalStage, solverClass: ParallelPipeline9GlobalDrcForceImproveSolver as any,
          getConstructorParams: (): [ConstructorParameters<typeof ParallelPipeline9GlobalDrcForceImproveSolver>[0]] => [wrappedParams] }]
        if (driver === "step") {
          while (!root.solved && !root.failed) await root.stepAsync()
        } else if (driver === "until") {
          await root.solveUntilPhaseAsync("none")
          await root.stepAsync()
        } else {
          await root.solveAsync()
        }
        expect(root.solved).toBe(true)
        expect(root.failed).toBe(false)
        const parallel = root.globalDrcForceImproveSolver as unknown as ParallelPipeline9GlobalDrcForceImproveSolver
        expect(parallel).toBeInstanceOf(ParallelPipeline9GlobalDrcForceImproveSolver)
        expect(parallel.getOutput()).toEqual(native.getOutput())
        expect(parallel.stats).toEqual(native.stats)
        expect(parallel.iterations).toBe(native.iterations)
        expect(parallel.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
        expect(parallel.drcEvaluator).toBeUndefined()
        expect(parallel.autoroutingDrcEngine!.lastRunStats).toEqual(native.autoroutingDrcEngine!.lastRunStats)
        expect(parallel.pendingEffects).toHaveLength(0)
        root.dispose()
        // An external pool remains live after the root releases its stage.
        const jointParams = createParallelGlobalDrcFixture(driver === "until")
        const originalJoint = new Pipeline9JointDrcRepairSolver(jointParams)
        const parallelJoint = new ParallelPipeline9JointDrcRepairSolver({ ...jointParams, workerPool: pool })
        originalJoint.solve()
        await parallelJoint.solveAsync()
        expect(parallelJoint.getOutput()).toEqual(originalJoint.getOutput())
        expect(parallelJoint.getUpdatedPreloadedTraces()).toEqual(originalJoint.getUpdatedPreloadedTraces())
        expect(parallelJoint.exactRepairSolver!.stats).toEqual(originalJoint.exactRepairSolver!.stats)
      }
    }
    expect(pool.stats.tasksStarted).toBeGreaterThan(4)
    expect(pool.stats.tasksCompleted).toBe(pool.stats.tasksStarted)
    expect(pool.stats.maxActiveWorkers).toBeGreaterThan(1)
    expect(pool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
  } finally {
    pool.dispose()
  }
})
