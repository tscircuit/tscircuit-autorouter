import * as autorouterModule from "../../lib"
import { KrtAutoroutingPipelineSolver } from "../../lib/testing/KrtAutoroutingPipelineSolver"
import { RELAXED_DRC_OPTIONS } from "../../lib/testing/drcPresets"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"
import { convertToCircuitJson } from "../../lib/testing/utils/convertToCircuitJson"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../../lib/types/srj-types"
import type {
  BenchmarkTask,
  WorkerProgress,
  WorkerResult,
} from "./benchmark-types"

type SolverInstance = {
  solved?: boolean
  failed?: boolean
  progress?: number
  iterations?: number
  error?: string | null
  activeSubSolver?: SolverInstance | null
  currentPipelineStepIndex?: number
  pipelineDef?: Array<{
    solverName?: string
    solverClass?: {
      name?: string
    }
  }>
  srjWithPointPairs?: SimpleRouteJson
  step?: () => void
  solve?: () => void | Promise<void>
  solveAsync?: () => Promise<void>
  getOutputSimplifiedPcbTraces?: () => SimplifiedPcbTrace[]
  getSolverName?: () => string
}

type SolverOptions = {
  effort?: number
}

type RunTaskOptions = {
  onProgress?: (progress: WorkerProgress) => void
  progressIntervalMs?: number
}

const DEFAULT_PROGRESS_INTERVAL_MS = 1000

export const getBenchmarkSolverOptions = (
  scenario: SimpleRouteJson,
): SolverOptions | undefined => {
  const rawEffort = (scenario as SimpleRouteJson & { effort?: number }).effort
  const effort =
    rawEffort !== undefined && Number.isFinite(rawEffort) && rawEffort >= 1
      ? rawEffort
      : undefined

  if (effort === undefined) {
    return undefined
  }

  return {
    effort,
  }
}

const getSolverConstructor = (solverName: string) => {
  if (solverName === "KrtAutoroutingPipelineSolver") {
    return KrtAutoroutingPipelineSolver as new (
      srj: SimpleRouteJson,
      opts?: SolverOptions,
    ) => SolverInstance
  }

  const ctor = (autorouterModule as Record<string, unknown>)[solverName]
  if (typeof ctor !== "function") {
    throw new Error(`Solver "${solverName}" was not found`)
  }
  return ctor as new (
    srj: SimpleRouteJson,
    opts?: SolverOptions,
  ) => SolverInstance
}

export const createSolverForTask = (task: BenchmarkTask): SolverInstance => {
  const SolverConstructor = getSolverConstructor(task.solverName)
  return new SolverConstructor(
    task.scenario,
    getBenchmarkSolverOptions(task.scenario),
  )
}

const getErrorMessage = (error: unknown): string | undefined => {
  if (error === undefined || error === null) {
    return undefined
  }
  return error instanceof Error ? error.message : String(error)
}

const getSolverInstanceName = (solver: SolverInstance | null | undefined) => {
  if (!solver) {
    return undefined
  }

  const nameFromMethod = solver.getSolverName?.()
  if (nameFromMethod) {
    return nameFromMethod
  }

  return solver.constructor?.name
}

const getFailureInfo = (
  solver: SolverInstance,
  fallbackError?: string,
): Pick<WorkerResult, "error" | "errorPhaseName" | "errorSolverName"> => {
  const pipelineStep =
    Array.isArray(solver.pipelineDef) &&
    typeof solver.currentPipelineStepIndex === "number"
      ? solver.pipelineDef[solver.currentPipelineStepIndex]
      : undefined
  const activeSubSolver = solver.activeSubSolver ?? null

  return {
    errorPhaseName: pipelineStep?.solverName,
    errorSolverName:
      pipelineStep?.solverClass?.name ?? getSolverInstanceName(activeSubSolver),
    error:
      getErrorMessage(activeSubSolver?.error) ??
      getErrorMessage(solver.error) ??
      fallbackError,
  }
}

const getProgressInfo = (
  task: BenchmarkTask,
  solver: SolverInstance,
  elapsedTimeMs: number,
): WorkerProgress => {
  const pipelineStep =
    Array.isArray(solver.pipelineDef) &&
    typeof solver.currentPipelineStepIndex === "number"
      ? solver.pipelineDef[solver.currentPipelineStepIndex]
      : undefined
  const activeSubSolver = solver.activeSubSolver ?? null

  return {
    solverName: task.solverName,
    scenarioName: task.scenarioName,
    sampleNumber: task.sampleNumber,
    elapsedTimeMs,
    phaseName: pipelineStep?.solverName,
    phaseSolverName:
      pipelineStep?.solverClass?.name ?? getSolverInstanceName(activeSubSolver),
    solverProgress: solver.progress,
    solverIterations: solver.iterations,
    activeSubSolverProgress: activeSubSolver?.progress,
    activeSubSolverIterations: activeSubSolver?.iterations,
  }
}

const getProgressKey = (progress: WorkerProgress) =>
  [progress.phaseName ?? "", progress.phaseSolverName ?? ""].join("|")

const solveWithProgress = async (
  task: BenchmarkTask,
  solver: SolverInstance,
  start: number,
  options: RunTaskOptions,
) => {
  const progressIntervalMs =
    options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS
  let lastProgressAt = -Infinity
  let lastProgressKey = ""

  const emitProgress = (force = false) => {
    if (!options.onProgress) {
      return
    }

    const elapsedTimeMs = performance.now() - start
    const progress = getProgressInfo(task, solver, elapsedTimeMs)
    const progressKey = getProgressKey(progress)
    if (
      !force &&
      progressKey === lastProgressKey &&
      elapsedTimeMs - lastProgressAt < progressIntervalMs
    ) {
      return
    }

    lastProgressAt = elapsedTimeMs
    lastProgressKey = progressKey
    options.onProgress(progress)
  }

  emitProgress(true)

  if (typeof solver.solveAsync === "function") {
    const interval =
      options.onProgress && progressIntervalMs > 0
        ? setInterval(() => emitProgress(true), progressIntervalMs)
        : null
    try {
      await solver.solveAsync()
    } finally {
      if (interval) {
        clearInterval(interval)
      }
    }
    emitProgress(true)
    return
  }

  if (typeof solver.step === "function") {
    while (!solver.solved && !solver.failed) {
      solver.step()
      emitProgress()
    }
    emitProgress(true)
    return
  }

  if (typeof solver.solve === "function") {
    await solver.solve()
    emitProgress(true)
    return
  }

  throw new Error("Solver does not implement step(), solve(), or solveAsync()")
}

export const runTask = async (
  task: BenchmarkTask,
  options: RunTaskOptions = {},
): Promise<WorkerResult> => {
  const solver = createSolverForTask(task)
  const start = performance.now()
  let solveError: string | undefined

  try {
    await solveWithProgress(task, solver, start, options)
  } catch (error) {
    solver.solved = false
    solveError = getErrorMessage(error)
  }

  const elapsedTimeMs = performance.now() - start
  const didSolve = Boolean(solver.solved)

  if (!didSolve) {
    const failureInfo = getFailureInfo(solver, solveError)
    return {
      solverName: task.solverName,
      scenarioName: task.scenarioName,
      sampleNumber: task.sampleNumber,
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed: false,
      ...failureInfo,
    }
  }

  try {
    const traces = solver.failed
      ? []
      : (solver.getOutputSimplifiedPcbTraces?.() ?? [])
    const circuitJson = convertToCircuitJson(
      solver.srjWithPointPairs ?? task.scenario,
      traces,
      task.scenario.minTraceWidth,
      task.scenario.minViaDiameter,
    )
    const { errors } = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS)
    const relaxedDrcPassed = errors.length === 0

    return {
      solverName: task.solverName,
      scenarioName: task.scenarioName,
      sampleNumber: task.sampleNumber,
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed,
    }
  } catch (error) {
    return {
      solverName: task.solverName,
      scenarioName: task.scenarioName,
      sampleNumber: task.sampleNumber,
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
