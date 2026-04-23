import * as autorouterModule from "../../lib"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"
import { RELAXED_DRC_OPTIONS } from "../../lib/testing/drcPresets"
import { convertToCircuitJson } from "../../lib/testing/utils/convertToCircuitJson"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../../lib/types/srj-types"
import type { BenchmarkTask, WorkerResult } from "./benchmark-types"

type SolverInstance = {
  solved?: boolean
  failed?: boolean
  srjWithPointPairs?: SimpleRouteJson
  solve?: () => void | Promise<void>
  solveAsync?: () => Promise<void>
  getOutputSimplifiedPcbTraces?: () => SimplifiedPcbTrace[]
}

type SolverOptions = {
  effort?: number
}

const getDrcErrorType = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return "unknown"
  }

  const record = error as Record<string, unknown>
  for (const key of ["error_type", "type", "pcb_error_type", "name"]) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) {
      return value
    }
  }

  const pcbErrorId = record.pcb_error_id
  if (typeof pcbErrorId === "string") {
    if (pcbErrorId.startsWith("same_net_vias_close_")) {
      return "same_net_vias_close"
    }
    if (pcbErrorId.startsWith("different_net_vias_close_")) {
      return "different_net_vias_close"
    }
  }

  return "unknown"
}

const countDrcErrorTypes = (errors: unknown[]) => {
  const counts: Record<string, number> = {}
  for (const error of errors) {
    const type = getDrcErrorType(error)
    counts[type] = (counts[type] ?? 0) + 1
  }
  return counts
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
    solveError = error instanceof Error ? error.message : String(error)
  }

  const elapsedTimeMs = performance.now() - start
  const didSolve = Boolean(solver.solved)

  if (!didSolve) {
    return {
      solverName: task.solverName,
      scenarioName: task.scenarioName,
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed: false,
      relaxedDrcErrorCount: 0,
      relaxedDrcErrorTypes: {},
      error: solveError,
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
    const relaxedDrcErrorTypes = countDrcErrorTypes(errors)

    return {
      solverName: task.solverName,
      scenarioName: task.scenarioName,
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed,
      relaxedDrcErrorCount: errors.length,
      relaxedDrcErrorTypes,
    }
  } catch (error) {
    return {
      solverName: task.solverName,
      scenarioName: task.scenarioName,
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed: false,
      relaxedDrcErrorCount: 0,
      relaxedDrcErrorTypes: {},
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
