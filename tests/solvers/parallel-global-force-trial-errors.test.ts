import { expect, spyOn, test } from "bun:test"
import { GlobalDrcForceImproveSolver, type DrcEvaluator, type SimpleRouteJson } from "high-density-repair03/lib"
import * as helpers from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute } from "high-density-repair03/lib/types/high-density-types"
import { ParallelGlobalDrcForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/force-trial-fork/ParallelGlobalDrcForceImproveSolver"
import type { ParallelGlobalDrcTrial, ParallelGlobalDrcTrialCoordinator, ParallelGlobalDrcTrialPlacement, ParallelGlobalDrcTrialResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGlobalDrcTrialTypes"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

type NativeParams = ConstructorParameters<typeof GlobalDrcForceImproveSolver>[0]
type EvaluatedPlacement = Extract<ParallelGlobalDrcTrialPlacement, { status: "evaluated" }>
type ChangedException = Extract<ParallelGlobalDrcTrialPlacement, { status: "exception"; countedBeforeException: true }>
type ResultFactory = (trials: ParallelGlobalDrcTrial[]) => ParallelGlobalDrcTrialResult[]
const initialError = { type: "pcb_trace_error", pcb_trace_id: "signal_0", center: { x: 0, y: 0 }, message: "controlled trace collision" }

class ControlledCoordinator implements ParallelGlobalDrcTrialCoordinator {
  readonly batches: ParallelGlobalDrcTrial[][] = []
  adopted = 0
  discarded = 0
  pendingException: Error | undefined
  adoptedException: Error | undefined

  constructor(private readonly resultFactory: ResultFactory) {
    this.adopted = 0
    this.discarded = 0
    this.pendingException = undefined
  }

  async dispatch(trials: ParallelGlobalDrcTrial[]): Promise<ParallelGlobalDrcTrialResult[]> {
    this.batches.push(trials)
    expect(trials.length).toBeGreaterThan(0)
    expect(trials.length).toBeLessThanOrEqual(4)
    const results = this.resultFactory(trials)
    return results.reverse()
  }

  adopt(placement: EvaluatedPlacement): void {
    expect(placement.preparedEvaluation.candidateKey).toBe(JSON.stringify(placement.routes))
    expect(this.pendingException).toBeUndefined()
    this.adopted += 1
    expect(this.adopted).toBe(this.discarded + 1)
    expect(placement.routes.length).toBeGreaterThan(0)
  }

  adoptException(placement: ChangedException, error: Error): void {
    expect(placement.candidateKey).toBe(JSON.stringify(placement.routes))
    expect(this.pendingException).toBeUndefined()
    this.pendingException = error
    this.adoptedException = error
    this.adopted += 1
  }

  discardPreparedEvaluation(): void {
    this.pendingException = undefined
    this.discarded += 1
    expect(this.discarded).toBe(this.adopted)
    expect(this.discarded).toBeGreaterThan(0)
    expect(this.pendingException).toBeUndefined()
  }
}

function createParams(safe: boolean, evaluator: DrcEvaluator): NativeParams {
  const fixture = createBoundedRegionalRepairFixture()
  return {
    srj: fixture.originalSrj as SimpleRouteJson, hdRoutes: fixture.routes,
    drcEvaluator: evaluator, effort: 1, maxIterations: 3,
    enableSafeTraceLayerMoves: safe, enableBroadFallback: false,
    enableLargeBoardBroadFallback: false, enablePostSolveClearanceRelaxation: false,
  }
}

function changedRoutes(routes: HighDensityRoute[]): HighDensityRoute[] {
  const candidate = helpers.cloneRoutes(routes)
  const point = candidate[0]!.route[1]!
  point.y += 0.25
  const materialized = helpers.materializeRoutes(candidate)
  expect(materialized).not.toEqual(routes)
  return materialized
}

function evaluatedPlacement(routes: HighDensityRoute[]): EvaluatedPlacement {
  return {
    status: "evaluated", routes,
    preparedEvaluation: {
      candidateKey: JSON.stringify(routes),
      preparedCandidateDrcInput: { evaluatedTraces: [], movableTraceIds: new Set(),
        originalTraceIdByEvaluationTraceId: new Map(), routedTraces: [], solverTraceIdByEvaluationTraceId: new Map() },
      evaluatedDrc: { errors: [], errorsWithCenters: [], locationAwareErrors: [] },
    },
  }
}

function exceptionPlacement(trial: ParallelGlobalDrcTrial, error: Error, counted: boolean): ParallelGlobalDrcTrialPlacement {
  const exception = { name: error.name, message: error.message, stack: error.stack }
  if (!counted) return { status: "exception", countedBeforeException: false, exception }
  const routes = changedRoutes(trial.hdRoutes)
  return {
    status: "exception", countedBeforeException: true,
    routes, candidateKey: JSON.stringify(routes), exception,
  }
}

function exceptionResults(trials: ParallelGlobalDrcTrial[], error: Error, counted: boolean): ParallelGlobalDrcTrialResult[] {
  return trials.map((trial, index) => {
    const placements: ParallelGlobalDrcTrialPlacement[] = index === 0
      ? [exceptionPlacement(trial, error, counted)] : [{ status: "unchanged" }]
    if (trial.kind === "safe-trace-layer" && (index !== 0 || counted)) placements.push({ status: "unchanged" })
    return { kind: "globalDrcForceTrial", trialIndex: trial.trialIndex, placements }
  })
}

function installNativeHelper(safe: boolean, error?: Error): () => void {
  if (safe) {
    const mock = spyOn(helpers, "applySafeTraceLayerMoveForError").mockImplementation((_srj, routes, _error, routeIndex) => {
      if (error) throw error
      routes[routeIndex]!.route[1]!.y += 0.25
      return true
    })
    return (): void => mock.mockRestore()
  }
  const mock = spyOn(helpers, "applyDrcErrorForces").mockImplementation((_srj, routes) => {
    if (error) throw error
    routes[0]!.route[1]!.y += 0.25
    return true
  })
  return (): void => mock.mockRestore()
}

function stepException(solver: GlobalDrcForceImproveSolver | ParallelGlobalDrcForceImproveSolver): unknown {
  try {
    solver.step()
  } catch (error: unknown) {
    return error
  }
  throw new Error("Expected the original Base.step boundary to throw")
}

function nativePrefix(solver: GlobalDrcForceImproveSolver | ParallelGlobalDrcForceImproveSolver): unknown {
  const internal = solver as unknown as Record<string, unknown>
  const keys = ["candidateAttempts", "errorCursor", "safeTraceLayerCursorByErrorId", "initialDrcIssueCount",
    "initialRepairDrcIssueCount", "initialLowCountErrorsHaveMovableTraces", "bestDrcIssueCountSeen", "bestDrcIssueScoreSeen"]
  return {
    iterations: solver.iterations, solved: solver.solved, failed: solver.failed, error: solver.error,
    maxIterations: solver.MAX_ITERATIONS, progress: solver.progress, stats: solver.stats, routes: solver.getOutput(),
    internal: Object.fromEntries(keys.map((key) => [key, internal[key]])),
  }
}

test("global force defers consumed exceptions, ignores unused scale errors and preserves cache and iteration-cap boundaries", async (): Promise<void> => {
  for (const safe of [false, true]) {
    for (const counted of [false, true]) {
      const selectedError = new RangeError(`${safe ? "safe" : "force"} ${counted ? "evaluation" : "helper"} failure`)
      let inputKey = ""
      const originalEvaluator: DrcEvaluator = ({ routes }) => {
        if (JSON.stringify(routes) === inputKey) return [initialError]
        throw selectedError
      }
      const params = createParams(safe, originalEvaluator)
      inputKey = JSON.stringify(helpers.materializeRoutes(helpers.cloneRoutes(params.hdRoutes)))
      const original = new GlobalDrcForceImproveSolver(params)
      const restore = installNativeHelper(safe, counted ? undefined : selectedError)
      try {
        expect(stepException(original)).toBe(selectedError)
      } finally {
        restore()
      }
      const coordinator = new ControlledCoordinator((trials) => exceptionResults(trials, selectedError, counted))
      const parallelEvaluator: DrcEvaluator = ({ routes }) => {
        if (JSON.stringify(routes) === inputKey) return [initialError]
        if (coordinator.pendingException) throw coordinator.pendingException
        throw new Error("Missing adopted exception")
      }
      const parallel = new ParallelGlobalDrcForceImproveSolver({ ...params, drcEvaluator: parallelEvaluator }, coordinator)
      await parallel.prepareForNextStep()
      expect(parallel.iterations).toBe(0)
      expect(parallel.failed).toBe(false)
      expect(parallel.error).toBeNull()
      await parallel.prepareForNextStep()
      expect(coordinator.batches.length).toBe(1)
      const consumedError = stepException(parallel)
      expect(consumedError).toBeInstanceOf(RangeError)
      expect((consumedError as Error).message).toBe(selectedError.message)
      expect((consumedError as Error).stack).toBe(selectedError.stack)
      if (counted) expect(consumedError).toBe(coordinator.adoptedException)
      expect(nativePrefix(parallel)).toEqual(nativePrefix(original))
      expect((parallel as unknown as { candidateAttempts: number }).candidateAttempts).toBe(counted ? 1 : 0)
      expect(coordinator.discarded).toBe(counted ? 1 : 0)
    }
  }

  const dispatchError = new TypeError("dispatch keeps exact identity")
  const initialEvaluator: DrcEvaluator = () => [initialError]
  const dispatchCoordinator = new ControlledCoordinator(() => { throw dispatchError })
  const dispatchSolver = new ParallelGlobalDrcForceImproveSolver(createParams(false, initialEvaluator), dispatchCoordinator)
  await dispatchSolver.prepareForNextStep()
  expect(dispatchSolver.failed).toBe(false)
  expect(dispatchSolver.iterations).toBe(0)
  expect(stepException(dispatchSolver)).toBe(dispatchError)
  expect(dispatchSolver.error).toBe("GlobalDrcForceImproveSolver error: TypeError: dispatch keeps exact identity")

  const winningParams = createParams(false, initialEvaluator)
  const inputKey = JSON.stringify(helpers.materializeRoutes(helpers.cloneRoutes(winningParams.hdRoutes)))
  const winningEvaluator: DrcEvaluator = ({ routes }) => JSON.stringify(routes) === inputKey ? [initialError] : []
  const unusedError = new SyntaxError("later unused scale")
  const winningCoordinator = new ControlledCoordinator((trials) => trials.map((trial, index) => ({
    kind: "globalDrcForceTrial", trialIndex: trial.trialIndex,
    placements: [index === 0 ? evaluatedPlacement(changedRoutes(trial.hdRoutes)) : exceptionPlacement(trial, unusedError, index === 2)],
  })))
  const winner = new ParallelGlobalDrcForceImproveSolver({ ...winningParams, drcEvaluator: winningEvaluator }, winningCoordinator)
  const nativeWinner = new GlobalDrcForceImproveSolver({ ...winningParams, drcEvaluator: winningEvaluator })
  const restoreWinner = installNativeHelper(false)
  try {
    nativeWinner.step()
  } finally {
    restoreWinner()
  }
  await winner.prepareForNextStep()
  winner.step()
  expect(nativePrefix(winner)).toEqual(nativePrefix(nativeWinner))
  expect(winner.solved).toBe(true)
  expect(winningCoordinator.adopted).toBe(1)
  expect(winningCoordinator.adoptedException).toBeUndefined()

  const cachedCoordinator = new ControlledCoordinator((trials) => exceptionResults(trials, unusedError, true))
  const cachedWinner = new ParallelGlobalDrcForceImproveSolver({ ...winningParams, drcEvaluator: winningEvaluator }, cachedCoordinator)
  await cachedWinner.prepareForNextStep()
  cachedWinner.step()
  expect(nativePrefix(cachedWinner)).toEqual(nativePrefix(nativeWinner))
  expect(cachedCoordinator.adoptedException).toBeInstanceOf(SyntaxError)
  expect(cachedCoordinator.pendingException).toBeUndefined()
  expect(cachedCoordinator.discarded).toBe(1)

  const adjustedError = new URIError("second safe placement is consumed")
  const safeParams = { ...winningParams, enableSafeTraceLayerMoves: true, drcEvaluator: winningEvaluator }
  const nativeSafe = new GlobalDrcForceImproveSolver(safeParams)
  let safeHelperCalls = 0
  const safeHelper = spyOn(helpers, "applySafeTraceLayerMoveForError").mockImplementation((_srj, routes, _error, routeIndex) => {
    safeHelperCalls += 1
    if (safeHelperCalls === 2) throw adjustedError
    routes[routeIndex]!.route[1]!.y += 0.25
    return true
  })
  try {
    expect(stepException(nativeSafe)).toBe(adjustedError)
    expect(safeHelperCalls).toBe(2)
  } finally {
    safeHelper.mockRestore()
  }
  const safeCoordinator = new ControlledCoordinator((trials) => trials.map((trial, index) => ({
    kind: "globalDrcForceTrial", trialIndex: trial.trialIndex,
    placements: index === 0
      ? [exceptionPlacement(trial, unusedError, true), exceptionPlacement(trial, adjustedError, false)]
      : [{ status: "unchanged" }, { status: "unchanged" }],
  })))
  const safeParallel = new ParallelGlobalDrcForceImproveSolver(safeParams, safeCoordinator)
  await safeParallel.prepareForNextStep()
  expect(safeParallel.failed).toBe(false)
  expect(stepException(safeParallel)).toBeInstanceOf(URIError)
  expect(nativePrefix(safeParallel)).toEqual(nativePrefix(nativeSafe))
  expect(safeCoordinator.adopted).toBe(1)
  expect(safeCoordinator.discarded).toBe(1)

  for (const maxIterations of [0, 1]) {
    const capParams = { ...createParams(false, initialEvaluator), hdRoutes: [], maxIterations }
    const capCoordinator = new ControlledCoordinator((trials) => trials.map((trial) => ({
      kind: "globalDrcForceTrial", trialIndex: trial.trialIndex, placements: [{ status: "unchanged" }],
    })))
    const original = new GlobalDrcForceImproveSolver(capParams)
    const parallel = new ParallelGlobalDrcForceImproveSolver(capParams, capCoordinator)
    const originalAcceptance = spyOn(original, "tryFinalAcceptance")
    const parallelAcceptance = spyOn(parallel, "tryFinalAcceptance")
    try {
      await parallel.prepareForNextStep()
      await parallel.prepareForNextStep()
      expect(parallelAcceptance).toHaveBeenCalledTimes(0)
      expect(parallel.solved).toBe(false)
      expect(parallel.iterations).toBe(0)
      original.step()
      parallel.step()
      expect(originalAcceptance).toHaveBeenCalledTimes(1)
      expect(parallelAcceptance).toHaveBeenCalledTimes(1)
      expect(nativePrefix(parallel)).toEqual(nativePrefix(original))
      expect(parallel.solved).toBe(true)
      await parallel.prepareForNextStep()
      parallel.step()
      expect(parallel.iterations).toBe(1)
      expect(parallelAcceptance).toHaveBeenCalledTimes(1)
      expect(capCoordinator.batches.length).toBe(1)
    } finally {
      originalAcceptance.mockRestore()
      parallelAcceptance.mockRestore()
    }
  }
})
