import { expect, spyOn, test } from "bun:test"
import { GlobalDrcBranchPortfolioSolver, type SimpleRouteJson as RepairSimpleRouteJson } from "high-density-repair03/lib"
import { AutoroutingPipelineSolver9_Parallel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { ParallelGlobalDrcBranchPortfolioSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/force-trial-fork/ParallelGlobalDrcBranchPortfolioSolver"
import { ParallelPipeline9GlobalDrcForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9GlobalDrcForceImproveSolver"
import { ParallelPipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9JointDrcRepairSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { Pipeline9MemoizedGlobalDrcForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9MemoizedGlobalDrcForceImproveSolver"
import type { Pipeline9LocalWorkerRequest } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"
import { createParallelGlobalDrcFixture } from "../fixtures/parallel-global-drc-fixture"

class IdleWorker {
  onmessage: Worker["onmessage"] = null
  onerror: Worker["onerror"] = null
  terminated = false
  readonly requests: Pipeline9LocalWorkerRequest[] = []

  postMessage(request: Pipeline9LocalWorkerRequest): void {
    this.requests.push(request)
    expect(this.terminated).toBe(false)
    const kind = request.job.kind
    const message = `Disabled DRC fixture unexpectedly submitted ${kind}`
    throw new Error(message)
  }

  terminate(): void {
    this.terminated = true
    this.onmessage = null
    this.onerror = null
    expect(this.requests).toHaveLength(0)
    expect(this.terminated).toBe(true)
  }
}

function logicalStats(stats: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(stats)) {
    if (key.includes("Time") || key.includes("time") || key.endsWith("Ms")) continue
    result[key] = value
  }
  return result
}

function portfolioPrefix(solver: GlobalDrcBranchPortfolioSolver): unknown {
  return structuredClone({
    iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
    solved: solver.solved, failed: solver.failed, error: solver.error,
    progress: solver.progress, stats: logicalStats(solver.stats), routes: solver.getOutput(),
  })
}

test("disabling parallel DRC keeps native stage classes and portfolio prefixes through every root async driver", async (): Promise<void> => {
  const workers: IdleWorker[] = []
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, workerFactory: (): Worker => {
    const worker = new IdleWorker()
    workers.push(worker)
    return worker as unknown as Worker
  } })
  try {
    for (const driver of ["step", "solve", "until"] as const) {
      for (const withPreload of [false, true]) {
        const fixture = createBoundedRegionalRepairFixture(3)
        fixture.originalSrj.obstacles = fixture.originalSrj.obstacles.map((obstacle, index) => ({
          ...obstacle, connectedTo: [...obstacle.connectedTo, `pcb_smtpad_disabled_${index}`],
        }))
        const forceParams = { srj: fixture.originalSrj as RepairSimpleRouteJson, hdRoutes: fixture.routes,
          connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj), effort: 1, maxIterations: 4,
          enableLargeBoardBroadFallback: false, enablePostSolveClearanceRelaxation: false }
        const nativeForce = new Pipeline9MemoizedGlobalDrcForceImproveSolver(forceParams)
        nativeForce.solve()
        const jointParams = createParallelGlobalDrcFixture(withPreload)
        const nativeJoint = new Pipeline9JointDrcRepairSolver(jointParams)
        const root = new AutoroutingPipelineSolver9_Parallel(fixture.originalSrj, {
          workerPool: pool, cacheProvider: null, enableParallelDrcTrials: false,
        })
        const forceStage = root.pipelineDef.find((stage) => stage.solverName === "globalDrcForceImproveSolver")
        const jointStage = root.pipelineDef.find((stage) => stage.solverName === "pipeline9JointDrcRepairSolver")
        if (!forceStage || !jointStage) throw new Error("Disabled DRC fixture is missing an original root stage")
        expect(forceStage.solverClass).toBe(Pipeline9MemoizedGlobalDrcForceImproveSolver)
        expect(jointStage.solverClass).toBe(ParallelPipeline9JointDrcRepairSolver)
        const parameterHost = Object.assign(Object.create(root), {
          getPreloadedTraceUpdatesAfterHighDensity: () => ({ updatedPreloadedTraces: jointParams.updatedPreloadedTraces, mutatedPreloadedTraces: [] }),
          getSrjWithMaterializedPreloadedTraces: () => jointParams.srj,
          originalSrj: jointParams.originalSrj, srj: jointParams.srj,
          netToPointPairsSolver: { newConnections: jointParams.newConnections },
          globalDrcForceImproveSolver: { getOutput: () => jointParams.newHdRoutes },
          connMap: jointParams.connMap, viaDiameter: jointParams.defaultViaDiameter,
          viaHoleDiameter: jointParams.defaultViaHoleDiameter, effort: jointParams.effort, colorMap: jointParams.colorMap,
        }) as AutoroutingPipelineSolver9_Parallel
        const [disabledParams] = jointStage.getConstructorParams(parameterHost) as [ConstructorParameters<typeof ParallelPipeline9JointDrcRepairSolver>[0]]
        expect(disabledParams.enableParallelDrcTrials).toBe(false)
        expect(disabledParams.workerPool).toBe(pool)
        root.pipelineDef = [
          { ...forceStage, solverClass: forceStage.solverClass as any, getConstructorParams: (): [typeof forceParams] => [forceParams] },
          { ...jointStage, solverClass: jointStage.solverClass as any, getConstructorParams: (): [typeof disabledParams] => [disabledParams] },
        ]
        const nativeHistory: unknown[] = []
        const disabledHistory: unknown[] = []
        const nativeStep = GlobalDrcBranchPortfolioSolver.prototype.step
        const stepSpy = spyOn(GlobalDrcBranchPortfolioSolver.prototype, "step").mockImplementation(function (this: GlobalDrcBranchPortfolioSolver): void {
          const iterations = this.iterations
          nativeStep.call(this)
          if (iterations === this.iterations) return
          if (this === nativeJoint.exactRepairSolver) nativeHistory.push(portfolioPrefix(this))
          if (this === root.pipeline9JointDrcRepairSolver?.exactRepairSolver) disabledHistory.push(portfolioPrefix(this))
        })
        try {
          nativeJoint.solve()
          if (driver === "step") {
            while (!root.solved && !root.failed) await root.stepAsync()
          } else if (driver === "until") {
            await root.solveUntilPhaseAsync("none")
            await root.stepAsync()
          } else {
            await root.solveAsync()
          }
        } finally {
          stepSpy.mockRestore()
        }
        expect(root.solved).toBe(true)
        expect(root.failed).toBe(false)
        const force = root.globalDrcForceImproveSolver!
        expect(force).toBeInstanceOf(Pipeline9MemoizedGlobalDrcForceImproveSolver)
        expect(force).not.toBeInstanceOf(ParallelPipeline9GlobalDrcForceImproveSolver)
        expect(force.getOutput()).toEqual(nativeForce.getOutput())
        expect(force.stats).toEqual(nativeForce.stats)
        expect(force.iterations).toBe(nativeForce.iterations)
        expect(force.MAX_ITERATIONS).toBe(nativeForce.MAX_ITERATIONS)
        expect(force.autoroutingDrcEngine!.lastRunStats).toEqual(nativeForce.autoroutingDrcEngine!.lastRunStats)
        const joint = root.pipeline9JointDrcRepairSolver as ParallelPipeline9JointDrcRepairSolver
        expect(joint).toBeInstanceOf(ParallelPipeline9JointDrcRepairSolver)
        expect(joint.exactRepairSolver!.constructor).toBe(GlobalDrcBranchPortfolioSolver)
        expect(joint.exactRepairSolver).not.toBeInstanceOf(ParallelGlobalDrcBranchPortfolioSolver)
        expect(nativeHistory.length).toBeGreaterThan(0)
        expect(disabledHistory).toEqual(nativeHistory)
        expect(joint.getOutput()).toEqual(nativeJoint.getOutput())
        expect(joint.getUpdatedPreloadedTraces()).toEqual(nativeJoint.getUpdatedPreloadedTraces())
        expect(logicalStats(joint.stats)).toEqual(logicalStats(nativeJoint.stats))
        expect(joint.pendingEffects).toHaveLength(0)
        expect(pool.stats.tasksStarted).toBe(0)
        root.dispose()
      }
    }
    expect(pool.stats.tasksCompleted).toBe(0)
    expect(workers.every((worker) => worker.requests.length === 0)).toBe(true)
  } finally {
    pool.dispose()
  }
})
