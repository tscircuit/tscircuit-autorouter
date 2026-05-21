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

export type WorkerProgress = {
  solverName: string
  scenarioName: string
  sampleNumber: number
  elapsedTimeMs: number
  phaseName?: string
  phaseSolverName?: string
  solverProgress?: number
  solverIterations?: number
  activeSubSolverProgress?: number
  activeSubSolverIterations?: number
}

export type WorkerResult = {
  solverName: string
  scenarioName: string
  sampleNumber: number
  elapsedTimeMs: number
  didSolve: boolean
  didTimeout: boolean
  relaxedDrcPassed: boolean
  drcErrorCount?: number
  drcErrorTypes?: Record<string, number>
  drcErrorMessages?: Array<{
    message: string
    count: number
  }>
  errorPhaseName?: string
  errorSolverName?: string
  error?: string
}

export type FailureSummary = {
  failureKind: string
  failureKey: string
  affectedSamples: number
  occurrences: number
  sampleNumbers: number[]
}

export type WorkerResultMessage = {
  taskId: number
  result: WorkerResult
}

export type WorkerProgressMessage = {
  taskId: number
  progress: WorkerProgress
}

export type WorkerChildMessage = WorkerResultMessage | WorkerProgressMessage

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
  solverFailureSummary: FailureSummary[]
  timeoutSummary: FailureSummary[]
  failureSummary: FailureSummary[]
  tests: WorkerResult[]
}
