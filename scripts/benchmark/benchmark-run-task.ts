import * as autorouterModule from "../../lib"
import { KrtAutoroutingPipelineSolver } from "../../lib/testing/KrtAutoroutingPipelineSolver"
import { RELAXED_DRC_OPTIONS } from "../../lib/testing/drcPresets"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"
import { convertToCircuitJson } from "../../lib/testing/utils/convertToCircuitJson"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../../lib/types/srj-types"
import type { BenchmarkTask, WorkerResult } from "./benchmark-types"

type SolverInstance = {
  solved?: boolean
  failed?: boolean
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
  solve?: () => void | Promise<void>
  solveAsync?: () => Promise<void>
  getOutputSimplifiedPcbTraces?: () => SimplifiedPcbTrace[]
  getSolverName?: () => string
}

type SolverOptions = {
  effort?: number
}

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

export const runTask = async (task: BenchmarkTask): Promise<WorkerResult> => {
  const solver = createSolverForTask(task)
  const start = performance.now()
  let solveError: string | undefined

  try {
    if (typeof solver.solveAsync === "function") {
      await solver.solveAsync()
    } else if (typeof solver.solve === "function") {
      await solver.solve()
    } else {
      throw new Error("Solver does not implement solve() or solveAsync()")
    }
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
