import type { SimpleRouteJson } from "../../lib/types/srj-types"

export type BenchmarkTask = {
  datasetName: string
  solverName: string
  scenarioName: string
  sampleNumber: number
  scenario: SimpleRouteJson
}

export type BenchmarkSnapshot = {
  datasetName: string
  solverName: string
  scenarioName: string
  sampleNumber: number
  label: string
  elapsedTimeMs: number
  traceCount: number
  viaCount: number
  relaxedDrcPassed: boolean
  drcErrorCount?: number
}

export type BenchmarkSnapshotWithImage = BenchmarkSnapshot & {
  imageSvg: string
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

export type WorkerResult<
  TBenchmarkSnapshot extends BenchmarkSnapshot = BenchmarkSnapshot,
> = {
  solverName: string
  scenarioName: string
  sampleNumber: number
  elapsedTimeMs: number
  didSolve: boolean
  didTimeout: boolean
  relaxedDrcPassed: boolean
  viaCount?: number
  drcErrorCount?: number
  drcErrorTypes?: Record<string, number>
  drcErrorMessages?: Array<{
    message: string
    count: number
  }>
  solverStats?: Record<string, string | number | boolean | null>
  errorPhaseName?: string
  errorSolverName?: string
  error?: string
  benchmarkSnapshot?: TBenchmarkSnapshot
}

export type WorkerResultWithImage = WorkerResult<BenchmarkSnapshotWithImage>

export type FailureSummary = {
  failureKind: string
  failureKey: string
  affectedSamples: number
  occurrences: number
  sampleNumbers: number[]
}

export type WorkerResultMessage = {
  taskId: number
  result: WorkerResultWithImage
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
  avgVia: number | null
}

export type BestViaCountRecord = {
  datasetName: string
  solverName: string
  scenarioName: string
  sampleNumber: number
  viaCount: number
  elapsedTimeMs: number
}

export type BenchmarkBestViasReport = {
  version: 1
  kind: "benchmark-best-vias"
  records: BestViaCountRecord[]
}

export type BestViaCountCell = {
  datasetName: string
  solverName: string
  scenarioName: string
  label: string
}

export type BenchmarkBestViaCellsReport = {
  version: 1
  kind: "benchmark-best-via-cells"
  cells: BestViaCountCell[]
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
  snapshots: BenchmarkSnapshot[]
  tests: WorkerResult[]
}
