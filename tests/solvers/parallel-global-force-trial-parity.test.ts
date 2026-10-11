import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver, type SimpleRouteJson } from "high-density-repair03/lib"
import type { Pipeline9PreparedJointDrcContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createPreparedJointDrcEvaluation"
import { executeParallelGlobalDrcTrial } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeParallelGlobalDrcTrial"
import { ParallelGlobalDrcForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/force-trial-fork/ParallelGlobalDrcForceImproveSolver"
import type { ParallelGlobalDrcTrial, ParallelGlobalDrcTrialCoordinator, ParallelGlobalDrcTrialPlacement, ParallelGlobalDrcTrialResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGlobalDrcTrialTypes"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

type NativeParams = ConstructorParameters<typeof GlobalDrcForceImproveSolver>[0]
type Fixture = ReturnType<typeof createBoundedRegionalRepairFixture>

class FixtureCoordinator implements ParallelGlobalDrcTrialCoordinator {
  readonly batches: ParallelGlobalDrcTrial[][] = []
  adopted = 0
  discarded = 0

  constructor(private readonly contextId: number, private readonly context: Pipeline9PreparedJointDrcContext) {
    this.batches = []
    this.adopted = 0
    this.discarded = 0
  }

  async dispatch(trials: ParallelGlobalDrcTrial[]): Promise<ParallelGlobalDrcTrialResult[]> {
    this.batches.push(trials)
    const snapshotId = this.contextId * 1000 + this.batches.length
    const results = trials.map((trial) => {
      const { srj, hdRoutes, connectivity, ...descriptor } = structuredClone(trial)
      return executeParallelGlobalDrcTrial({
        kind: "globalDrcForceTrial", contextId: this.contextId,
        context: this.context, snapshotId, snapshot: { srj, hdRoutes, connectivity },
        trial: descriptor,
      })
    })
    return results.reverse()
  }

  adopt(placement: Extract<ParallelGlobalDrcTrialPlacement, { status: "evaluated" }>): void {
    expect(placement.preparedEvaluation.candidateKey).toBe(JSON.stringify(placement.routes))
    expect(placement.preparedEvaluation.evaluatedDrc.errors).toBeArray()
    this.adopted += 1
  }

  adoptException(placement: Extract<ParallelGlobalDrcTrialPlacement, { status: "exception"; countedBeforeException: true }>, error: Error): void {
    expect(placement.candidateKey).toBe(JSON.stringify(placement.routes))
    expect(error.name).toBe(placement.exception.name)
    expect(error.message).toBe(placement.exception.message)
    this.adopted += 1
    throw error
  }

  discardPreparedEvaluation(): void {
    this.discarded += 1
    expect(this.discarded).toBe(this.adopted)
    expect(this.adopted).toBeGreaterThan(0)
  }
}

function createContext(fixture: Fixture): Pipeline9PreparedJointDrcContext {
  const connMap = getConnectivityMapFromSimpleRouteJson(fixture.originalSrj)
  return {
    newConnections: fixture.originalSrj.connections,
    originalConnections: fixture.originalSrj.connections,
    originalPreloadedTraces: [], nonMovableMutatedPreloadedTraces: [],
    movablePreloadedSections: [], syntheticConnectionNames: [],
    obstacles: fixture.originalSrj.obstacles, layerCount: fixture.originalSrj.layerCount,
    defaultViaHoleDiameter: 0.15, engineSrj: fixture.originalSrj as SimpleRouteJson,
    engineOptions: { traceClearance: 0.1, viaClearance: 0.1 },
    connectivityNetMap: connMap.netMap, connectivityIdToNetMap: connMap.idToNetMap,
  }
}

function observableState(solver: GlobalDrcForceImproveSolver | ParallelGlobalDrcForceImproveSolver): unknown {
  const privateState = solver as unknown as Record<string, unknown>
  const keys = [
    "candidateAttempts", "viaInPadCandidateAttempts", "viaInPadCandidatesAccepted",
    "padTopologyErrorCursor", "safeTraceLayerCursorByErrorId", "traceLayerCorridorCursorByErrorId",
    "tracePairDetourCursorByErrorId", "errorCursor", "stalledIterations", "outputSnapshot",
    "initialDrcIssueCount", "initialRepairDrcIssueCount", "initialLowCountErrorsHaveMovableTraces",
    "bestDrcIssueCountSeen", "bestDrcIssueScoreSeen", "lastDrcCountImprovementCheckIteration",
    "drcCountPlateauChecks", "largeBoardBroadFallbackMisses", "legacyCleanCheckpoint",
    "viaPadRepairRolledBack", "referenceCandidateRolledBack", "broadForceAccepted", "targetedForceAccepted",
  ]
  return {
    iterations: solver.iterations, solved: solver.solved, failed: solver.failed, error: solver.error,
    maxIterations: solver.MAX_ITERATIONS, progress: solver.progress, stats: solver.stats,
    routes: solver.getOutput(), internalState: Object.fromEntries(keys.map((key) => [key, privateState[key]])),
  }
}

test("asynchronous global force trials retain every native prefix, safe direction budgets, force priorities, and final acceptance", async (): Promise<void> => {
  let contextId = 8000
  let safeBatches = 0
  let forceBatches = 0
  let adopted = 0
  for (const safe of [false, true]) {
    for (const signalCount of [1, 3]) {
      for (const maxIterations of [1, 3]) {
        const fixture = createBoundedRegionalRepairFixture(signalCount)
        fixture.originalSrj.obstacles = fixture.originalSrj.obstacles.map((obstacle, index) => ({
          ...obstacle, connectedTo: [...obstacle.connectedTo, `pcb_smtpad_fixture_${index}`],
        }))
        const input = structuredClone(fixture.routes)
        const params: NativeParams = {
          srj: fixture.originalSrj as SimpleRouteJson, hdRoutes: fixture.routes,
          connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj),
          effort: 1, maxIterations, enableSafeTraceLayerMoves: safe,
          enableBroadFallback: false, enableLargeBoardBroadFallback: false,
          enablePostSolveClearanceRelaxation: false,
        }
        const coordinator = new FixtureCoordinator(++contextId, createContext(fixture))
        const original = new GlobalDrcForceImproveSolver(params)
        const parallel = new ParallelGlobalDrcForceImproveSolver(params, coordinator)
        expect(parallel.getSolverName()).toBe(original.getSolverName())
        while (!original.solved && !original.failed) {
          const iterations = parallel.iterations
          await parallel.prepareForNextStep()
          expect(parallel.iterations).toBe(iterations)
          expect(parallel.solved).toBe(false)
          expect(parallel.failed).toBe(false)
          await parallel.prepareForNextStep()
          original.step()
          parallel.step()
          expect(observableState(parallel)).toEqual(observableState(original))
        }
        expect(parallel.solved).toBe(true)
        expect(parallel.failed).toBe(false)
        expect(fixture.routes).toEqual(input)
        expect(coordinator.discarded).toBe(coordinator.adopted)
        adopted += coordinator.adopted
        for (const batch of coordinator.batches) {
          if (batch[0]!.kind === "safe-trace-layer") {
            safeBatches += 1
            expect(batch.length).toBeLessThanOrEqual(3)
            expect(batch.every((trial) => trial.kind === "safe-trace-layer")).toBe(true)
          } else {
            forceBatches += 1
            expect(batch.map((trial) => trial.kind === "force-scale" ? trial.scale : undefined)).toEqual([1, 1.75, -1])
          }
        }
      }
    }
  }
  expect(safeBatches).toBeGreaterThan(0)
  expect(forceBatches).toBeGreaterThan(0)
  expect(adopted).toBeGreaterThan(0)
})
