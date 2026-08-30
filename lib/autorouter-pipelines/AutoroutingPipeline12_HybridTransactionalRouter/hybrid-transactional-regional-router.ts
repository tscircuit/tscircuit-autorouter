import type { SimpleRouteJson } from "../../types"
import { buildTypedRoutingProblem } from "./build-typed-routing-problem"
import { compileRoutingRules } from "./compile-routing-rules"
import { ContentAddressedRegionCache } from "./content-addressed-region-cache"
import { copperSnapshotToSimpleRouteJson } from "./copper-snapshot-to-simple-route-json"
import { runParallelHybridTransactionalEngine } from "./parallel-hybrid-transactional-engine"
import type { HybridRoutingCoreRuntime } from "./rust-core-protocol"
import { runSerialHybridTransactionalEngine } from "./serial-hybrid-transactional-engine"
import type { SerialHybridEngineResult } from "./serial-engine-types"
import type {
  HybridRouterDiagnostic,
  HybridRouterMetrics,
  HybridRouterResult,
  HybridRoutingRulesInput,
} from "./types"
import { createHybridRouterMetrics } from "./work-metrics"

const DEFAULT_MAXIMUM_SEARCH_EXPANSIONS = 250_000
const DEFAULT_MAXIMUM_ACTIVATION_RINGS = 4
const DEFAULT_MAXIMUM_TRANSACTION_HISTORY = 1_024
const DEFAULT_MAXIMUM_DEMAND_CELL_COUNT = 1_000_000
const DEFAULT_MAXIMUM_REGION_COUNT = 4_096
const DEFAULT_MAXIMUM_REGION_MUTATION_COUNT = 4_096
const DEFAULT_MAXIMUM_MERGE_REGION_COUNT = 32
const DEFAULT_MAXIMUM_ESTIMATED_MEMORY_BYTES_PER_OBJECT = 64 * 1024 * 1024
const DEFAULT_MAXIMUM_WAVE_MEMORY_BYTES = 512 * 1024 * 1024
const DEFAULT_MAXIMUM_FINAL_VIOLATION_COUNT = 256
const DEFAULT_MAXIMUM_CACHE_ENTRY_COUNT = 512
const DEFAULT_MAXIMUM_CACHE_STORED_BYTES = 64 * 1024 * 1024

export type HybridRouterExecution =
  | {
      readonly kind: "serial"
      readonly runtime: HybridRoutingCoreRuntime
    }
  | {
      readonly kind: "parallel"
      readonly workerEntryPath: string
      readonly runtimeTarget: "native" | "wasm"
      readonly runtimeModulePath: string
      readonly maximumConcurrency: number
      readonly maximumWorkerQueueLength: number
    }

export type HybridTransactionalRegionalRouterOptions = {
  readonly routingRules: HybridRoutingRulesInput
  readonly execution: HybridRouterExecution
  readonly deterministicSeed?: number
  readonly maximumSearchExpansions?: number
  readonly maximumActivationRings?: number
  readonly maximumTransactionHistory?: number
  readonly maximumDemandCellCount?: number
  readonly maximumRegionCount?: number
  readonly maximumRegionMutationCount?: number
  readonly maximumMergeRegionCount?: number
  readonly maximumEstimatedMemoryBytesPerObject?: number
  readonly maximumWaveMemoryBytes?: number
  readonly maximumFinalViolationCount?: number
  readonly regionCache?: ContentAddressedRegionCache | false
}

type MemorySample = {
  readonly heapBytes: number
  readonly rssBytes: number
}

export class HybridTransactionalRegionalRouter {
  private readonly input: SimpleRouteJson
  private readonly options: HybridTransactionalRegionalRouterOptions
  private readonly regionCache?: ContentAddressedRegionCache
  private lastEngineResult?: SerialHybridEngineResult
  private result?: HybridRouterResult

  constructor(
    input: SimpleRouteJson,
    options: HybridTransactionalRegionalRouterOptions,
  ) {
    this.input = input
    this.options = options
    this.regionCache =
      options.regionCache === false
        ? undefined
        : options.regionCache ??
          new ContentAddressedRegionCache({
            maximumEntryCount: DEFAULT_MAXIMUM_CACHE_ENTRY_COUNT,
            maximumStoredBytes: DEFAULT_MAXIMUM_CACHE_STORED_BYTES,
          })
  }

  async route(): Promise<HybridRouterResult> {
    if (this.result) return this.result
    const startedAt = performance.now()
    const initialMemory = sampleMemory()
    const stageElapsedMs: Record<string, number> = {}
    let engineResult: SerialHybridEngineResult | undefined
    try {
      const compileStartedAt = performance.now()
      const compiledRules = compileRoutingRules({
        simpleRouteJson: this.input,
        routingRules: this.options.routingRules,
      })
      stageElapsedMs.constraintCompilation = performance.now() - compileStartedAt
      const objectBuildStartedAt = performance.now()
      const problem = buildTypedRoutingProblem(compiledRules)
      stageElapsedMs.typedProblemBuild = performance.now() - objectBuildStartedAt
      const engineStartedAt = performance.now()
      engineResult = await this.runEngine(problem)
      stageElapsedMs.transactionalRouting = performance.now() - engineStartedAt
      this.lastEngineResult = engineResult
      if (engineResult.status === "routed") {
        const outputStartedAt = performance.now()
        const routedSimpleRouteJson = copperSnapshotToSimpleRouteJson({
          input: this.input,
          copperSnapshot: engineResult.artifacts.copperSnapshot,
        })
        stageElapsedMs.outputMaterialization = performance.now() - outputStartedAt
        const totalElapsedMs = performance.now() - startedAt
        const memory = maximumMemory(initialMemory, sampleMemory())
        this.result = Object.freeze({
          status: "solved" as const,
          routedSimpleRouteJson,
          metrics: this.createMetrics({
            totalElapsedMs,
            stageElapsedMs,
            engineResult,
            memory,
            solveOutcome: "solved",
          }),
        })
        return this.result
      }
      if (engineResult.status === "partial") {
        const outputStartedAt = performance.now()
        const unresolvedRegionIds = engineResult.unresolvedRegionIds
        const partialSimpleRouteJson = copperSnapshotToSimpleRouteJson({
          input: this.input,
          copperSnapshot: engineResult.artifacts.copperSnapshot,
        })
        const unresolvedConnectionNames = Object.freeze([
          ...new Set(
            engineResult.artifacts.regionGraph.regions
              .filter((region) =>
                unresolvedRegionIds.includes(region.regionId),
              )
              .flatMap((region) => region.connectionNames),
          ),
        ])
        stageElapsedMs.outputMaterialization = performance.now() - outputStartedAt
        const totalElapsedMs = performance.now() - startedAt
        const memory = maximumMemory(initialMemory, sampleMemory())
        this.result = Object.freeze({
          status: "partial" as const,
          partialSimpleRouteJson,
          unresolvedConnectionNames,
          metrics: this.createMetrics({
            totalElapsedMs,
            stageElapsedMs,
            engineResult,
            memory,
            solveOutcome: "partial",
          }),
          diagnostic: createDiagnostic({
            code: "hybrid_route_partial",
            message: engineResult.message,
            regionIds: unresolvedRegionIds,
            connectionNames: unresolvedConnectionNames,
          }),
        })
        return this.result
      }
      const totalElapsedMs = performance.now() - startedAt
      const memory = maximumMemory(initialMemory, sampleMemory())
      this.result = Object.freeze({
        status: "failed" as const,
        metrics: this.createMetrics({
          totalElapsedMs,
          stageElapsedMs,
          engineResult,
          memory,
          solveOutcome: "failed",
        }),
        diagnostic: createDiagnostic({
          code: "hybrid_route_failed",
          message: engineResult.message,
          regionIds: engineResult.failedRegionId
            ? [engineResult.failedRegionId]
            : [],
          connectionNames: problem.compiledRules.connections.map(
            (connection) => connection.connectionName,
          ),
        }),
      })
      return this.result
    } catch (error) {
      const finalMemory = sampleMemory()
      this.result = Object.freeze({
        status: "failed" as const,
        metrics: this.createMetrics({
          totalElapsedMs: performance.now() - startedAt,
          stageElapsedMs,
          engineResult,
          memory: maximumMemory(initialMemory, finalMemory),
          solveOutcome: "failed",
        }),
        diagnostic: createDiagnostic({
          code: "hybrid_router_exception",
          message: getErrorMessage(error),
          regionIds: [],
          connectionNames: this.input.connections.map(
            (connection) => connection.name,
          ),
        }),
      })
      return this.result
    }
  }

  getResult(): HybridRouterResult | undefined {
    return this.result
  }

  getLastEngineResult(): SerialHybridEngineResult | undefined {
    return this.lastEngineResult
  }

  private runEngine(
    problem: Parameters<typeof runSerialHybridTransactionalEngine>[0]["problem"],
  ): Promise<SerialHybridEngineResult> {
    const commonConfiguration = {
      deterministicSeed: this.options.deterministicSeed ?? 17,
      maximumSearchExpansions:
        this.options.maximumSearchExpansions ??
        DEFAULT_MAXIMUM_SEARCH_EXPANSIONS,
      maximumActivationRings:
        this.options.maximumActivationRings ??
        DEFAULT_MAXIMUM_ACTIVATION_RINGS,
      maximumTransactionHistory:
        this.options.maximumTransactionHistory ??
        DEFAULT_MAXIMUM_TRANSACTION_HISTORY,
      maximumDemandCellCount:
        this.options.maximumDemandCellCount ??
        DEFAULT_MAXIMUM_DEMAND_CELL_COUNT,
      maximumRegionCount:
        this.options.maximumRegionCount ?? DEFAULT_MAXIMUM_REGION_COUNT,
      maximumRegionMutationCount:
        this.options.maximumRegionMutationCount ??
        DEFAULT_MAXIMUM_REGION_MUTATION_COUNT,
      maximumMergeRegionCount:
        this.options.maximumMergeRegionCount ??
        DEFAULT_MAXIMUM_MERGE_REGION_COUNT,
      maximumEstimatedMemoryBytesPerObject:
        this.options.maximumEstimatedMemoryBytesPerObject ??
        DEFAULT_MAXIMUM_ESTIMATED_MEMORY_BYTES_PER_OBJECT,
      maximumWaveMemoryBytes:
        this.options.maximumWaveMemoryBytes ??
        DEFAULT_MAXIMUM_WAVE_MEMORY_BYTES,
      maximumFinalViolationCount:
        this.options.maximumFinalViolationCount ??
        DEFAULT_MAXIMUM_FINAL_VIOLATION_COUNT,
      regionCache: this.regionCache,
    }
    if (this.options.execution.kind === "serial") {
      return runSerialHybridTransactionalEngine({
        problem,
        configuration: {
          ...commonConfiguration,
          runtime: this.options.execution.runtime,
        },
      })
    }
    return runParallelHybridTransactionalEngine({
      problem,
      configuration: {
        ...commonConfiguration,
        workerEntryPath: this.options.execution.workerEntryPath,
        runtimeTarget: this.options.execution.runtimeTarget,
        runtimeModulePath: this.options.execution.runtimeModulePath,
        maximumConcurrency: this.options.execution.maximumConcurrency,
        maximumWorkerQueueLength:
          this.options.execution.maximumWorkerQueueLength,
      },
    })
  }

  private createMetrics({
    totalElapsedMs,
    stageElapsedMs,
    engineResult,
    memory,
    solveOutcome,
  }: {
    totalElapsedMs: number
    stageElapsedMs: Readonly<Record<string, number>>
    engineResult?: SerialHybridEngineResult
    memory: MemorySample
    solveOutcome: HybridRouterMetrics["solveOutcome"]
  }): HybridRouterMetrics {
    return createHybridRouterMetrics({
      totalElapsedMs,
      stageElapsedMs,
      artifacts: engineResult?.artifacts,
      maximumConcurrency:
        this.options.execution.kind === "parallel"
          ? this.options.execution.maximumConcurrency
          : 1,
      peakHeapBytes: memory.heapBytes,
      peakRssBytes: memory.rssBytes,
      solveOutcome,
    })
  }
}

function createDiagnostic({
  code,
  message,
  regionIds,
  connectionNames,
}: HybridRouterDiagnostic): HybridRouterDiagnostic {
  return Object.freeze({
    code,
    message,
    regionIds: Object.freeze([...regionIds]),
    connectionNames: Object.freeze([...connectionNames]),
  })
}

function sampleMemory(): MemorySample {
  if (typeof process === "undefined") return { heapBytes: 0, rssBytes: 0 }
  const memory = process.memoryUsage()
  return Object.freeze({
    heapBytes: memory.heapUsed,
    rssBytes: memory.rss,
  })
}

function maximumMemory(
  first: MemorySample,
  second: MemorySample,
): MemorySample {
  return Object.freeze({
    heapBytes: Math.max(first.heapBytes, second.heapBytes),
    rssBytes: Math.max(first.rssBytes, second.rssBytes),
  })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
