import type { HybridBenchmarkInputPolicy } from "../../lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/benchmark-routing-rules"
import type { HybridRouterMetrics } from "../../lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/types"
import type { SimpleRouteJson } from "../../lib/types"

export type HybridBenchmarkTask = {
  readonly mode: "production" | "experimental"
  readonly scenarioId: string
  readonly source: string
  readonly categories: readonly string[]
  readonly input: SimpleRouteJson
  readonly inputPolicy: HybridBenchmarkInputPolicy
  readonly outputDirectory: string
  readonly nativeRuntimeModulePath: string
  readonly maximumConcurrency: number
}

export type HybridBenchmarkRunStatus =
  | "solved"
  | "partial"
  | "input-failure"
  | "algorithmic-failure"
  | "validation-failure"
  | "timeout"

export type HybridBenchmarkRun = {
  readonly scenarioId: string
  readonly source: string
  readonly categories: readonly string[]
  readonly engine: "production" | "hybrid-cold" | "hybrid-warm"
  readonly status: HybridBenchmarkRunStatus
  readonly elapsedMs: number
  readonly processCpuMs: number
  readonly detailedRoutingMs: number
  readonly finalizationMs: number
  readonly peakHeapBytes: number
  readonly peakRssBytes: number
  readonly zeroDrc: boolean | null
  readonly drcErrorCount: number | null
  readonly drcErrorMessages: readonly string[]
  readonly finalConnectivityVerified: boolean | null
  readonly viaCount: number | null
  readonly routedLengthMm: number | null
  readonly bendCount: number | null
  readonly routeHash: string | null
  readonly workerCpuMs: number | null
  readonly workerUtilization: number | null
  readonly cacheHits: number | null
  readonly cacheMisses: number | null
  readonly cacheStoredBytes: number | null
  readonly stageElapsedMs: Readonly<Record<string, number>>
  readonly workMetrics: HybridRouterMetrics | null
  readonly failureReason: string | null
  readonly pngPath: string
}

export type HybridBenchmarkTaskOutput = {
  readonly runs: readonly HybridBenchmarkRun[]
}
