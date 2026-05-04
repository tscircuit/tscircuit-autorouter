import type { SimpleRouteJson } from "../../lib/types/srj-types"

export type BenchmarkTask = {
  solverName: string
  scenarioName: string
  sampleNumber: number
  scenario: SimpleRouteJson
}

export type WorkerTaskMessage = {
  taskId: number
  task: BenchmarkTask
}

export type WorkerResult = {
  solverName: string
  scenarioName: string
  sampleNumber: number
  elapsedTimeMs: number
  didSolve: boolean
  didTimeout: boolean
  relaxedDrcPassed: boolean
  errorPhaseName?: string
  errorSolverName?: string
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

export type BenchmarkReport = {
  version: 1
  datasetName: string
  scenarioCount: number
  effortLabel: string
  summary: SolverRunSummary[]
  tests: WorkerResult[]
}
