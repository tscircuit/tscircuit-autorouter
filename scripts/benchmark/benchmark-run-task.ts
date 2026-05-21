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

const toErrorRecord = (error: object): Record<string, unknown> =>
  error as unknown as Record<string, unknown>

const normalizeDrcMessage = (message: unknown) =>
  typeof message === "string" && message.trim().length > 0
    ? message.replace(/\s+/g, " ").trim()
    : "no message"

const getDrcErrorType = (error: object) => {
  const errorRecord = toErrorRecord(error)
  const message = normalizeDrcMessage(errorRecord.message)
  if (
    message.includes("overlaps with pcb_smtpad") &&
    message.includes("accidental contact")
  ) {
    return "trace_smtpad_accidental_contact"
  }
  if (
    message.includes("overlaps with pcb_plated_hole") &&
    message.includes("accidental contact")
  ) {
    return "trace_plated_hole_accidental_contact"
  }
  if (message.includes("is too close to pcb_smtpad")) {
    return "trace_smtpad_clearance"
  }
  if (message.includes("is too close to pcb_plated_hole")) {
    return "trace_plated_hole_clearance"
  }
  if (message.includes("overlaps with pcb_trace")) {
    return "trace_trace_overlap"
  }
  if (message.includes("overlaps with pcb_via")) {
    return "trace_via_overlap"
  }

  const explicitType = errorRecord.error_type ?? errorRecord.type
  if (typeof explicitType === "string" && explicitType.length > 0) {
    return explicitType
  }

  const errorId = errorRecord.pcb_error_id
  if (typeof errorId === "string") {
    if (errorId.startsWith("same_net_vias_close_")) {
      return "same_net_vias_close"
    }
    if (errorId.startsWith("different_net_vias_close_")) {
      return "different_net_vias_close"
    }
  }

  return "unknown_drc_error"
}

const incrementCount = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1
}

const summarizeDrcErrors = (
  errors: object[],
): Pick<WorkerResult, "drcErrorCount" | "drcErrorTypes" | "drcErrorMessages"> => {
  const drcErrorTypes: Record<string, number> = {}
  const messageCounts: Record<string, number> = {}

  for (const error of errors) {
    incrementCount(drcErrorTypes, getDrcErrorType(error))
    incrementCount(
      messageCounts,
      normalizeDrcMessage(toErrorRecord(error).message),
    )
  }

  const drcErrorMessages = Object.entries(messageCounts)
    .sort(([, countA], [, countB]) => countB - countA)
    .slice(0, 5)
    .map(([message, count]) => ({ message, count }))

  return {
    drcErrorCount: errors.length,
    drcErrorTypes,
    drcErrorMessages,
  }
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
      {
        minTraceWidth: task.scenario.minTraceWidth,
        minViaDiameter: task.scenario.minViaDiameter,
      },
    )
    const { errors } = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS)
    const relaxedDrcPassed = errors.length === 0
    const drcSummary = summarizeDrcErrors(errors as object[])

    return {
      solverName: task.solverName,
      scenarioName: task.scenarioName,
      sampleNumber: task.sampleNumber,
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed,
      ...drcSummary,
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
