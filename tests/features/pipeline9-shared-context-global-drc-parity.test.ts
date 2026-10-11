import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { executeParallelGlobalDrcTrial } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeParallelGlobalDrcTrial"
import type { ParallelGlobalDrcTrialJob, ParallelGlobalDrcTrialResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGlobalDrcTrialTypes"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createParallelGlobalDrcFixture } from "../fixtures/parallel-global-drc-fixture"

class SharedContextJoint extends Pipeline9JointDrcRepairSolver {
  makeJobs(contextId: number, preserveBoundaryAlias: boolean): ParallelGlobalDrcTrialJob[] {
    const context = this.getPreparedIndexedDrcContext()
    if (!context) throw new Error("Shared global DRC fixture has no evaluation context")
    const hdRoutes = structuredClone(this.exactRepairSolver!.params.hdRoutes)
    const evaluation = this.exactRepairSolver!.params.drcEvaluator!({ routes: hdRoutes, traces: [] })
    const errors = Array.isArray(evaluation) ? evaluation : evaluation.errorsWithCenters ?? evaluation.errors
    if (!errors[0]) throw new Error("Shared global DRC fixture has no routing violation")
    const snapshot = { srj: preserveBoundaryAlias ? context.engineSrj : structuredClone(context.engineSrj), hdRoutes }
    return Array.from({ length: 8 }, (_, trialIndex): ParallelGlobalDrcTrialJob => ({
      kind: "globalDrcForceTrial", evaluationMode: "joint", contextId, context,
      snapshotId: contextId, snapshot,
      trial: { kind: "safe-trace-layer", trialIndex, error: structuredClone(errors[0]!),
        changedRouteIndex: 0, targetZ: 1, spanExpansion: "full", directionVariant: trialIndex % 4 },
    }))
  }
}

test("shared global DRC contexts preserve native evaluations and first-message snapshot aliases", async (): Promise<void> => {
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, contextTransport: "bun-shared" })
  try {
    await pool.initializeContextTransport()
    const fixture = new SharedContextJoint(createParallelGlobalDrcFixture(false))
    for (const boundaryAliases of [true, false]) {
      const jobs = fixture.makeJobs(boundaryAliases ? 901 : 902, boundaryAliases)
      const expected = jobs.map((job) => executeParallelGlobalDrcTrial(job))
      const actual = await Promise.all(jobs.map((job) => pool.run<ParallelGlobalDrcTrialResult>(job)))
      expect(actual).toEqual(expected)
      expect(pool.stats.contextAliasNativeMessages).toBe(4)
      expect(pool.stats.contextSerializationCalls).toBe(boundaryAliases ? 0 : 1)
    }
    expect(pool.stats.sharedContextMessages).toBe(4)
    expect(pool.stats.tasksStarted).toBe(16)
    expect(pool.stats.tasksCompleted).toBe(16)
    expect(pool.stats.maxActiveWorkers).toBe(4)
  } finally { pool.dispose() }
})
