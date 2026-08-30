#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { getPngBufferFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver7_MultiGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver12_HybridTransactionalRouter } from "../../lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/AutoroutingPipelineSolver12_HybridTransactionalRouter"
import { createHybridBenchmarkRoutingRules } from "../../lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/benchmark-routing-rules"
import { ContentAddressedRegionCache } from "../../lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/content-addressed-region-cache"
import type {
  HybridRouterMetrics,
  HybridRouterResult,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/types"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../../lib/types"
import { convertSrjToGraphicsObject } from "../../lib/utils/convertSrjToGraphicsObject"
import type {
  HybridBenchmarkRun,
  HybridBenchmarkRunStatus,
  HybridBenchmarkTask,
  HybridBenchmarkTaskOutput,
} from "./types"
import {
  combineHybridBenchmarkRouteGeometry,
  measureHybridBenchmarkRouteGeometry,
} from "./route-geometry"

const taskPath = process.argv[2]
if (!taskPath) {
  throw new Error("usage: bun scripts/hybrid-benchmark/run-task.ts <task.json>")
}

const task = parseTask(JSON.parse(await readFile(resolve(taskPath), "utf8")))
await mkdir(task.outputDirectory, { recursive: true })
const output: HybridBenchmarkTaskOutput =
  task.mode === "production"
    ? { runs: Object.freeze([await runProduction(task)]) }
    : { runs: await runExperimental(task) }
console.log(`HYBRID_BENCHMARK_RESULT=${JSON.stringify(output)}`)

async function runProduction(
  task: HybridBenchmarkTask,
): Promise<HybridBenchmarkRun> {
  const startedAt = performance.now()
  const initialMemory = process.memoryUsage()
  const initialCpu = process.cpuUsage()
  const solver = new AutoroutingPipelineSolver7_MultiGraph(task.input, {
    effort: 1,
    cacheProvider: null,
  })
  let failureReason: string | null = null
  try {
    solver.solve()
  } catch (error) {
    failureReason = getErrorMessage(error)
  }
  const elapsedMs = performance.now() - startedAt
  const processCpuMs = cpuUsageMs(process.cpuUsage(initialCpu))
  const output = solver.solved
    ? safelyGetProductionOutput(solver, (message) => {
        failureReason = message
      })
    : undefined
  const validation = output
    ? validateOutput({
        input: task.input,
        srjWithPointPairs: solver.srjWithPointPairs ?? task.input,
        output,
        outputContainsPreloadedTraces: false,
      })
    : undefined
  const status = getProductionStatus({ solver, output, validation, failureReason })
  const routedOutput = output ?? task.input
  const pngPath = await writeRoutePng({
    task,
    engine: "production",
    output: routedOutput,
  })
  const geometry = output
    ? combineHybridBenchmarkRouteGeometry(
        measureHybridBenchmarkRouteGeometry(task.input.traces ?? []),
        measureHybridBenchmarkRouteGeometry(output.traces ?? []),
      )
    : null
  const finalMemory = process.memoryUsage()
  return Object.freeze({
    scenarioId: task.scenarioId,
    source: task.source,
    categories: task.categories,
    engine: "production" as const,
    status,
    elapsedMs,
    processCpuMs,
    detailedRoutingMs: solver.timeSpentOnPhase.highDensityRouteSolver ?? 0,
    finalizationMs: sumProductionFinalizationMs(solver.timeSpentOnPhase),
    peakHeapBytes: Math.max(initialMemory.heapUsed, finalMemory.heapUsed),
    peakRssBytes: getPeakRssBytes(),
    zeroDrc: validation?.zeroDrc ?? null,
    drcErrorCount: validation?.drcErrorCount ?? null,
    drcErrorMessages: validation?.drcErrorMessages ?? Object.freeze([]),
    finalConnectivityVerified: validation?.zeroDrc ?? null,
    viaCount: geometry?.viaCount ?? null,
    routedLengthMm: geometry?.routedLengthMm ?? null,
    bendCount: geometry?.bendCount ?? null,
    routeHash: output ? hashRoute(output.traces ?? []) : null,
    workerCpuMs: null,
    workerUtilization: null,
    cacheHits: null,
    cacheMisses: null,
    cacheStoredBytes: null,
    stageElapsedMs: Object.freeze({ ...solver.timeSpentOnPhase }),
    workMetrics: null,
    failureReason:
      failureReason ??
      validation?.failureReason ??
      (solver.failed ? solver.error ?? "production solver failed" : null),
    pngPath,
  })
}

async function runExperimental(
  task: HybridBenchmarkTask,
): Promise<readonly HybridBenchmarkRun[]> {
  const cache = new ContentAddressedRegionCache({
    maximumEntryCount: 2_048,
    maximumStoredBytes: 128 * 1024 * 1024,
  })
  const cold = await runExperimentalPass({
    task,
    cache,
    engine: "hybrid-cold",
  })
  const warm = await runExperimentalPass({
    task,
    cache,
    engine: "hybrid-warm",
  })
  return Object.freeze([cold, warm])
}

async function runExperimentalPass({
  task,
  cache,
  engine,
}: {
  task: HybridBenchmarkTask
  cache: ContentAddressedRegionCache
  engine: "hybrid-cold" | "hybrid-warm"
}): Promise<HybridBenchmarkRun> {
  const initialMemory = process.memoryUsage()
  const initialCpu = process.cpuUsage()
  const solver = new AutoroutingPipelineSolver12_HybridTransactionalRouter(
    task.input,
    {
      routingRules: createHybridBenchmarkRoutingRules(task.input),
      execution: {
        kind: "parallel",
        workerEntryPath: resolve(
          "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/hybrid-routing-worker.ts",
        ),
        runtimeTarget: "native",
        runtimeModulePath: task.nativeRuntimeModulePath,
        maximumConcurrency: task.maximumConcurrency,
        maximumWorkerQueueLength: 4_096,
      },
      deterministicSeed: 17,
      maximumSearchExpansions: 250_000,
      maximumActivationRings: 4,
      maximumTransactionHistory: 4_096,
      maximumDemandCellCount: 1_000_000,
      maximumRegionCount: 4_096,
      maximumRegionMutationCount: 4_096,
      maximumMergeRegionCount: 32,
      maximumEstimatedMemoryBytesPerObject: 64 * 1024 * 1024,
      maximumWaveMemoryBytes: 512 * 1024 * 1024,
      maximumFinalViolationCount: 256,
      regionCache: cache,
    },
  )
  const startedAt = performance.now()
  await solver.solveAsync()
  const elapsedMs = performance.now() - startedAt
  const processCpuMs = cpuUsageMs(process.cpuUsage(initialCpu))
  const result = solver.getResult()
  if (!result) throw new Error("hybrid solver returned no result")
  const output = getHybridOutput(result)
  const validation =
    result.status === "solved" && output
      ? validateOutput({
          input: task.input,
          srjWithPointPairs: task.input,
          output,
          outputContainsPreloadedTraces: true,
        })
      : undefined
  const status = getHybridStatus({ result, validation })
  const pngPath = await writeRoutePng({
    task,
    engine,
    output: output ?? task.input,
  })
  const metrics = result.metrics
  const finalizationMs = getHybridFinalizationMs(solver)
  const finalMemory = process.memoryUsage()
  return Object.freeze({
    scenarioId: task.scenarioId,
    source: task.source,
    categories: task.categories,
    engine,
    status,
    elapsedMs,
    processCpuMs,
    detailedRoutingMs: Math.max(0, metrics.solverElapsedMs - finalizationMs),
    finalizationMs,
    peakHeapBytes: Math.max(
      initialMemory.heapUsed,
      finalMemory.heapUsed,
      metrics.peakHeapBytes,
    ),
    peakRssBytes: Math.max(getPeakRssBytes(), metrics.peakRssBytes),
    zeroDrc: validation?.zeroDrc ?? null,
    drcErrorCount: validation?.drcErrorCount ?? null,
    drcErrorMessages: validation?.drcErrorMessages ?? Object.freeze([]),
    finalConnectivityVerified: result.status === "solved",
    viaCount: result.status === "solved" ? metrics.viaCount : null,
    routedLengthMm:
      result.status === "solved" ? metrics.routedLengthMm : null,
    bendCount: result.status === "solved" ? metrics.bendCount : null,
    routeHash: getHybridRouteHash(solver),
    workerCpuMs: metrics.workerCpuMs,
    workerUtilization: metrics.workerUtilization,
    cacheHits: metrics.cacheHits,
    cacheMisses: metrics.cacheMisses,
    cacheStoredBytes: metrics.cacheStoredBytes,
    stageElapsedMs: metrics.stageElapsedMs,
    workMetrics: metrics,
    failureReason:
      validation?.failureReason ??
      (result.status === "solved" ? null : result.diagnostic.message),
    pngPath,
  })
}

function getProductionStatus({
  solver,
  output,
  validation,
  failureReason,
}: {
  solver: AutoroutingPipelineSolver7_MultiGraph
  output: SimpleRouteJson | undefined
  validation: OutputValidation | undefined
  failureReason: string | null
}): HybridBenchmarkRunStatus {
  if (failureReason?.includes("must") || failureReason?.includes("invalid")) {
    return "input-failure"
  }
  if (!solver.solved || !output) return "algorithmic-failure"
  if (!validation?.zeroDrc) return "validation-failure"
  return "solved"
}

function getHybridStatus({
  result,
  validation,
}: {
  result: HybridRouterResult
  validation: OutputValidation | undefined
}): HybridBenchmarkRunStatus {
  if (result.status === "partial") return "partial"
  if (result.status === "failed") {
    return result.diagnostic.code === "hybrid_router_exception" &&
      (result.diagnostic.message.includes("must") ||
        result.diagnostic.message.includes("invalid") ||
        result.diagnostic.message.includes("missing"))
      ? "input-failure"
      : "algorithmic-failure"
  }
  return validation?.zeroDrc ? "solved" : "validation-failure"
}

type OutputValidation = {
  readonly zeroDrc: boolean
  readonly drcErrorCount: number
  readonly drcErrorMessages: readonly string[]
  readonly failureReason: string | null
}

function validateOutput({
  input,
  srjWithPointPairs,
  output,
  outputContainsPreloadedTraces,
}: {
  input: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  output: SimpleRouteJson
  outputContainsPreloadedTraces: boolean
}): OutputValidation {
  try {
    const inputTraceIds = new Set(
      (input.traces ?? []).map((trace) => trace.pcb_trace_id),
    )
    const routedTraces = outputContainsPreloadedTraces
      ? (output.traces ?? []).filter(
          (trace) => !inputTraceIds.has(trace.pcb_trace_id),
        )
      : (output.traces ?? [])
    const result = evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs,
      routedTraces,
    })
    const messages = result.errors
      .slice(0, 8)
      .map((error) => getDrcMessage(error))
    return Object.freeze({
      zeroDrc: result.errors.length === 0,
      drcErrorCount: result.errors.length,
      drcErrorMessages: Object.freeze(messages),
      failureReason:
        result.errors.length === 0
          ? null
          : `external relaxed DRC reported ${result.errors.length} error(s)`,
    })
  } catch (error) {
    return Object.freeze({
      zeroDrc: false,
      drcErrorCount: 1,
      drcErrorMessages: Object.freeze([getErrorMessage(error)]),
      failureReason: `external validation failed: ${getErrorMessage(error)}`,
    })
  }
}

function safelyGetProductionOutput(
  solver: AutoroutingPipelineSolver7_MultiGraph,
  onFailure: (message: string) => void,
): SimpleRouteJson | undefined {
  try {
    return solver.getOutputSimpleRouteJson()
  } catch (error) {
    onFailure(getErrorMessage(error))
    return undefined
  }
}

function getHybridOutput(result: HybridRouterResult): SimpleRouteJson | undefined {
  if (result.status === "solved") return result.routedSimpleRouteJson
  if (result.status === "partial") return result.partialSimpleRouteJson
  return undefined
}

function getHybridRouteHash(
  solver: AutoroutingPipelineSolver12_HybridTransactionalRouter,
): string | null {
  const engineResult = solver.getLastEngineResult()
  return engineResult?.status === "routed"
    ? engineResult.verification.routeHash
    : null
}

function getHybridFinalizationMs(
  solver: AutoroutingPipelineSolver12_HybridTransactionalRouter,
): number {
  return (
    solver
      .getLastEngineResult()
      ?.artifacts.attempts.filter(
        (attempt) => attempt.strategy === "transactional-coupled-finalization",
      )
      .reduce((total, attempt) => total + attempt.solveTimeMs, 0) ?? 0
  )
}

async function writeRoutePng({
  task,
  engine,
  output,
}: {
  task: HybridBenchmarkTask
  engine: HybridBenchmarkRun["engine"]
  output: SimpleRouteJson
}): Promise<string> {
  const pngFileName = `${task.scenarioId}--${engine}.png`
  const pngPath = resolve(task.outputDirectory, pngFileName)
  await writeFile(
    pngPath,
    await getPngBufferFromGraphicsObject(convertSrjToGraphicsObject(output), {
      backgroundColor: "white",
      pngWidth: 1280,
      pngHeight: 960,
    }),
  )
  return pngFileName
}

function sumProductionFinalizationMs(
  stageElapsedMs: Readonly<Record<string, number>>,
): number {
  return [
    "traceSimplificationSolver",
    "lengthMatchingPostProcessingSolver",
    "powerTraceExpansionSolver",
    "exactGeometryDrcForceImproveSolver",
    "globalDrcForceImproveSolver",
  ].reduce((total, stageName) => total + (stageElapsedMs[stageName] ?? 0), 0)
}

function hashRoute(traces: readonly SimplifiedPcbTrace[]): string {
  return createHash("sha256")
    .update(JSON.stringify(traces))
    .digest("hex")
    .slice(0, 16)
}

function cpuUsageMs(usage: NodeJS.CpuUsage): number {
  return (usage.user + usage.system) / 1_000
}

function getPeakRssBytes(): number {
  return process.resourceUsage().maxRSS * 1_024
}

function getDrcMessage(error: object): string {
  if ("message" in error && typeof error.message === "string") {
    return error.message
  }
  return JSON.stringify(error)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseTask(value: unknown): HybridBenchmarkTask {
  if (!isRecord(value)) throw new Error("benchmark task must be an object")
  if (
    (value.mode !== "production" && value.mode !== "experimental") ||
    typeof value.scenarioId !== "string" ||
    typeof value.source !== "string" ||
    !Array.isArray(value.categories) ||
    !value.categories.every((category) => typeof category === "string") ||
    !isSimpleRouteJson(value.input) ||
    !isRecord(value.inputPolicy) ||
    typeof value.outputDirectory !== "string" ||
    typeof value.nativeRuntimeModulePath !== "string" ||
    !Number.isSafeInteger(value.maximumConcurrency) ||
    Number(value.maximumConcurrency) <= 0
  ) {
    throw new Error("benchmark task has an invalid shape")
  }
  return {
    mode: value.mode,
    scenarioId: value.scenarioId,
    source: value.source,
    categories: value.categories,
    input: value.input,
    inputPolicy: parseInputPolicy(value.inputPolicy),
    outputDirectory: value.outputDirectory,
    nativeRuntimeModulePath: value.nativeRuntimeModulePath,
    maximumConcurrency: Number(value.maximumConcurrency),
  }
}

function parseInputPolicy(
  value: Record<string, unknown>,
): HybridBenchmarkTask["inputPolicy"] {
  if (
    !Array.isArray(value.inferredFields) ||
    !value.inferredFields.every((field) => typeof field === "string") ||
    typeof value.minimumViaHoleDiameterMm !== "number" ||
    typeof value.minimumViaPadDiameterMm !== "number" ||
    typeof value.defaultClearanceMm !== "number"
  ) {
    throw new Error("benchmark task input policy is invalid")
  }
  return {
    inferredFields: value.inferredFields,
    minimumViaHoleDiameterMm: value.minimumViaHoleDiameterMm,
    minimumViaPadDiameterMm: value.minimumViaPadDiameterMm,
    defaultClearanceMm: value.defaultClearanceMm,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSimpleRouteJson(value: unknown): value is SimpleRouteJson {
  if (!isRecord(value) || !isRecord(value.bounds)) return false
  return (
    Number.isSafeInteger(value.layerCount) &&
    typeof value.minTraceWidth === "number" &&
    typeof value.bounds.minX === "number" &&
    typeof value.bounds.maxX === "number" &&
    typeof value.bounds.minY === "number" &&
    typeof value.bounds.maxY === "number" &&
    Array.isArray(value.obstacles) &&
    Array.isArray(value.connections)
  )
}
