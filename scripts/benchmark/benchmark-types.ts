import type { SimpleRouteJson } from "../../lib/types/srj-types"

export type BenchmarkTask = {
  datasetName: string
  /** Display/report name; may differ for two passes of the same constructor. */
  solverName: string
  solverConstructorName?: string
  networkedCachePass?: "cold" | "hot"
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

export type BenchmarkStageTiming = {
  stageName: string
  elapsedTimeMs: number
}

export type BenchmarkStageTimingBreakdown = {
  status: "complete" | "partial"
  stages: BenchmarkStageTiming[]
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
  stageTiming?: BenchmarkStageTimingBreakdown
}

export type TinyHypergraphBenchmarkMetrics = {
  routeCount: number
  traceDensityCandidateEvaluated?: boolean
  traceDensityCandidateSelected?: boolean
  downstreamNodePfSum?: number
  downstreamNodePfSquaredSum?: number
  downstreamNodePfMax?: number
  downstreamSquaredNodePortPointCount?: number
  iterations: number
  timeMs?: number
  ripCount?: number
  partialRipCount?: number
  partiallyRippedRouteCount?: number
  partiallyRippedSegmentCount?: number
  retainedPartialRipSegmentCount?: number
  firstMaxRegionCost?: number
  bestMaxRegionCost?: number
  firstTotalRegionCost?: number
  bestTotalRegionCost?: number
  firstSegmentCount?: number
  bestSolvedSegmentCount?: number
  bestSolvedMaxRegionSegmentCount?: number
  bestSolvedSquaredRegionSegmentCount?: number
  finalMaxRegionSegmentCount: number
  finalSquaredRegionSegmentCount: number
  finalSegmentCount?: number
  finalLayerChangeCount?: number
  warmupFullRipAttempts?: number
  complexityAwareSelection?: boolean
  targetReached?: boolean
  outsideInCompletedRouteCount?: number
  outsideInFallbackRouteCount?: number
  outsideInForwardExpansionCount?: number
  outsideInReverseExpansionCount?: number
}

export type RoutingBenchmarkMetrics = {
  tinyHypergraph?: TinyHypergraphBenchmarkMetrics
  highDensityIterations?: number
  phaseTimeMs?: Record<string, number>
  networkedHighDensity?: {
    remoteRequestsStarted: number
    remoteRequestsCompleted: number
    remoteBatchCacheMisses: number
    remoteSingleRequestsStarted: number
    remoteCacheHits: number
    remoteSolverResults: number
    remoteTransportFallbacks: number
  }
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
  errorPhaseName?: string
  errorSolverName?: string
  error?: string
  stageTiming?: BenchmarkStageTimingBreakdown
  routingMetrics?: RoutingBenchmarkMetrics
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
  // Optional so previously published version 1 artifacts remain readable.
  p60TimeMs?: number | null
  p70TimeMs?: number | null
  p80TimeMs?: number | null
  p90TimeMs?: number | null
  p95TimeMs: number | null
  avgVia: number | null
  networkCache?: {
    remoteRequests: number
    cacheHits: number
    solverResults: number
    batchCacheMisses: number
    localFallbacks: number
  }
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
  /** Exact revisions used by a paired run; absent in standalone reports. */
  solverRevision?: string
  drcRevision?: string
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
