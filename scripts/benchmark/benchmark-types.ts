import type { SimpleRouteJson } from "../../lib/types/srj-types"

export type BenchmarkTask = {
  solverName: string
  scenarioName: string
  scenario: SimpleRouteJson
}

export type WorkerTaskMessage = {
  taskId: number
  task: BenchmarkTask
}

export type WorkerResult = {
  solverName: string
  scenarioName: string
  elapsedTimeMs: number
  didSolve: boolean
  didTimeout: boolean
  relaxedDrcPassed: boolean
  relaxedDrcErrorCount: number
  relaxedDrcErrorTypes: Record<string, number>
  error?: string
}

export type WorkerResultMessage = {
  taskId: number
  result: WorkerResult
}

export type SolverRunSummary = {
  solverName: string
  completedRateLabel: string
  relaxedDrcRateLabel: string
  timedOutLabel: string
  p50TimeMs: number | null
  p95TimeMs: number | null
}

export type DrcErrorTypeSummary = {
  type: string
  count: number
}

export type DrcFailingCircuitSummary = {
  solverName: string
  circuitId: string
  relaxedDrcErrorCount: number
  relaxedDrcErrorTypes: Record<string, number>
}

export type BenchmarkReport = {
  version: 1
  datasetName: string
  scenarioCount: number
  effortLabel: string
  summary: SolverRunSummary[]
  drcErrorTypes: DrcErrorTypeSummary[]
  drcFailingCircuits: DrcFailingCircuitSummary[]
  tests: WorkerResult[]
}
