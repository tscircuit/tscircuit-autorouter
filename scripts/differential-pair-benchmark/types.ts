import type { CorpusSample } from "../differential-pair-corpus/types"
import type { PairOutputEvaluation } from "./evaluatePairOutput"

export type BenchmarkConfig = { solver: string; effort: number; timeoutMs: number }
export type LogicalPathMeasurement = {
  pairId: string
  status: "measured" | "unavailable"
  positivePlanarLengthMm: number | null
  negativePlanarLengthMm: number | null
  planarSkewMm: number | null
}
export type SampleResult = {
  sampleId: string
  fingerprint: string
  kind: CorpusSample["kind"]
  split: CorpusSample["provenance"]["split"]
  familyId: string
  declaredPairCount: number
  durationMs: number
  timedOut: boolean
  exitCode: number
  outputAvailable: boolean
  outputSource: "final" | "pre-power-checkpoint" | "none"
  metricsStatus: "measured" | "unavailable"
  metrics: PairOutputEvaluation | null
  logicalPaths: LogicalPathMeasurement[]
  error: string | null
}
export type RunResults = {
  schemaVersion: 1
  metricVersion: string
  metricImplementationSha256: string
  createdAt: string
  gitCommit: string
  workingTreeSha256: string
  datasetSha256: string
  dependencyLockSha256: string | null
  bunVersion: string
  host: { platform: string; architecture: string; cpu: string }
  config: BenchmarkConfig
  samples: SampleResult[]
}
