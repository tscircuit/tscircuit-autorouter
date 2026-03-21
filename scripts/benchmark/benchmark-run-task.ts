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
  solve: () => void
  getOutputSimplifiedPcbTraces?: () => SimplifiedPcbTrace[]
}

const getSolverConstructor = (solverName: string) => {
  const ctor = (autorouterModule as Record<string, unknown>)[solverName]
  if (typeof ctor !== "function") {
    throw new Error(`Solver "${solverName}" was not found`)
  }
  return ctor as new (
    srj: SimpleRouteJson,
  ) => SolverInstance
}

export const runTask = async (task: BenchmarkTask): Promise<WorkerResult> => {
  const SolverConstructor = getSolverConstructor(task.solverName)
  const solver = new SolverConstructor(task.scenario)
  const start = performance.now()

  try {
    solver.solve()
  } catch {
    solver.solved = false
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
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed,
    }
  } catch (error) {
    return {
      solverName: task.solverName,
      scenarioName: task.scenarioName,
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
