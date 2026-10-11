import type { BenchmarkStageTimingBreakdown } from "../benchmark/benchmark-types"

export type BenchmarkVariant = "baseline" | "parallel"
export type BenchmarkPathingStrategy = "indexed" | "adaptive-bitset" | "cached-cost" | "landmark" | "negotiated" | "goal-balls"
export type BenchmarkHighDensityPolicy = "ordered" | "first-valid"
export type BenchmarkStatus = "solved" | "failed" | "timeout" | "crashed"

export type ParallelBenchmarkQuality = {
  traceCount: number
  viaCount: number
  drcErrorCount: number
  traceLintIssueCounts: Record<string, number>
  connectionCoverage?: {
    requiredNetCount: number
    requiredPairCount: number
    coveredNetCount: number
    uncoveredNetCount: number
    missingPortCount: number
    singletonNetCount: number
    errorCount: number
    connectedNetNames?: string[]
    unconnectedNetNames?: string[]
    missingPortIds?: string[]
    detailsHash?: string
  }
}

export type ParallelBenchmarkResult = {
  sampleName: string
  repeat: number
  variant: BenchmarkVariant
  status: BenchmarkStatus
  elapsedTimeMs: number
  geometryHash?: string
  outputHash?: string
  quality?: ParallelBenchmarkQuality
  error?: string
  stageTiming?: BenchmarkStageTimingBreakdown
  phaseName?: string
  workerStats?: Record<string, unknown>
  workerPoolStats?: Record<string, unknown>
  stageStats?: Record<string, Record<string, unknown>>
  pathingSearchStats?: Record<string, unknown>
}

export type ParallelBenchmarkChildMessage =
  | {
      kind: "progress"
      elapsedTimeMs: number
      phaseName?: string
      stageTiming?: BenchmarkStageTimingBreakdown
    }
  | { kind: "result"; result: ParallelBenchmarkResult }

export type ParallelBenchmarkSummaryOptions = {
  expectedSamples: string[]
  repetitions: number
  timeoutMs: number
  targetSpeedup: number
  highDensityPolicy?: BenchmarkHighDensityPolicy
  pathingStrategy?: BenchmarkPathingStrategy
  physicalRouting?: boolean
}

export type ParallelBenchmarkSampleSummary = {
  sampleName: string
  baselineTimeMs: number
  parallelTimeMs: number
  speedup: number
  baselineSolved: number
  parallelSolved: number
  exactGeometry: boolean
  qualityPreserved: boolean
  connectionCoveragePreserved: boolean
}

export type ParallelBenchmarkSummary = {
  fullCoverage: boolean
  allCompleted: boolean
  exactGeometry: boolean
  qualityPreserved: boolean
  connectionCoveragePreserved: boolean
  highDensityPolicy: BenchmarkHighDensityPolicy
  pathingStrategy: BenchmarkPathingStrategy
  physicalRouting: boolean
  geometryRequired: boolean
  coverageAcceptanceMode: "baseline-parity" | "full-physical-completion"
  arithmeticMeanSpeedup: number
  aggregateSpeedup: number
  geometricMeanSpeedup: number
  targetReached: boolean
  perSample: ParallelBenchmarkSampleSummary[]
}
