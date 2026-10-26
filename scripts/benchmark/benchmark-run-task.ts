import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { TRACE_LINT_LABELS } from "./trace-lint-metrics.js"
import { runTraceLinting } from "../../lib/testing/runTraceLinting"
import { getSvgFromGraphicsObject } from "graphics-debug"
import * as autorouterModule from "../../lib"
import { convertSrjToGraphicsObject } from "../../lib"
import { KrtAutoroutingPipelineSolver } from "../../lib/testing/KrtAutoroutingPipelineSolver"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../../lib/types/srj-types"
import type {
  BenchmarkSnapshotWithImage,
  BenchmarkTask,
  RoutingBenchmarkMetrics,
  TinyHypergraphBenchmarkMetrics,
  WorkerProgress,
  WorkerResultWithImage,
} from "./benchmark-types"
import {
  extractBenchmarkStageTiming,
  type PipelineStageTimingSource,
} from "./benchmark-stage-timing"
import { countDeterministicNetworkedValidationRejections } from "./countDeterministicNetworkedValidationRejections"

type SubSolverInstance = {
  progress?: number
  iterations?: number
  error?: string | null
  getSolverName?: () => string
}

type HighDensityBenchmarkSource = {
  iterations?: number
  stats?: Record<string, unknown>
  waitForAllRemoteRequests?: () => Promise<void>
}

type BenchmarkPipelineStep = {
  solverName: string
  solverClass?: Function
  getConstructorParams?: (...args: any[]) => readonly unknown[]
}

type SolverInstance = Omit<PipelineStageTimingSource, "pipelineDef"> & {
  solved?: boolean
  failed?: boolean
  progress?: number
  iterations?: number
  error?: string | null
  activeSubSolver?: SubSolverInstance | null
  pipelineDef: ReadonlyArray<BenchmarkPipelineStep>
  srjWithPointPairs?: SimpleRouteJson
  step?: () => void
  solve?: () => void | Promise<void>
  solveAsync?: (runtime?: SolverRuntimeExecutor) => Promise<void>
  getOutputSimplifiedPcbTraces?: () => SimplifiedPcbTrace[]
  getOutputSimpleRouteJson?: () => SimpleRouteJson
  getSolverName?: () => string
  portPointPathingSolver?: {
    getSolveGraphBenchmarkMetrics?: () =>
      | TinyHypergraphBenchmarkMetrics
      | undefined
  }
  highDensityRouteSolver?: HighDensityBenchmarkSource
  highDensityRepairSolver?: HighDensityBenchmarkSource
  timeSpentOnPhase: Record<string, number>
}

type SolverOptions = {
  effort?: number
  hdCache2ServerUrl?: string
  hdCache2CacheVersion?: string
}

type SolverConstructor = new (
  srj: SimpleRouteJson,
  opts?: SolverOptions,
) => SolverInstance

type RunTaskOptions = {
  onProgress?: (progress: WorkerProgress) => void
  progressIntervalMs?: number
}

type DrcSummary = {
  drcErrorCount: number
  drcErrorTypes: Record<string, number>
  drcErrorMessages: Array<{
    message: string
    count: number
  }>
}

type FailureInfo = {
  error?: string
  errorPhaseName?: string
  errorSolverName?: string
}

const DEFAULT_PROGRESS_INTERVAL_MS = 1000

const countTraceVias = (traces: SimplifiedPcbTrace[]) =>
  traces.reduce(
    (total, trace) =>
      total +
      trace.route.filter((segment) => segment.route_type === "via").length,
    0,
  )

export const getBenchmarkSolverOptions = (
  scenario: SimpleRouteJson,
): SolverOptions | undefined => {
  const rawEffort = (scenario as SimpleRouteJson & { effort?: number }).effort
  const effort =
    rawEffort !== undefined && Number.isFinite(rawEffort) && rawEffort >= 1
      ? rawEffort
      : undefined

  if (effort === undefined) {
    return undefined
  }

  return {
    effort,
  }
}

const getSolverConstructor = (solverName: string): SolverConstructor => {
  if (solverName === "KrtAutoroutingPipelineSolver") {
    return KrtAutoroutingPipelineSolver
  }

  const ctor = (autorouterModule as Record<string, unknown>)[solverName]
  if (typeof ctor !== "function") {
    throw new Error(`Solver "${solverName}" was not found`)
  }
  return ctor as SolverConstructor
}

export const configureNetworkedBenchmarkRequestTimeout = (
  solver: SolverInstance,
  requestTimeoutMs: number,
): void => {
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("Networked benchmark request timeout must be positive")
  }
  let configuredRouteStage = false
  // These subclasses already accept the option in older checkouts. Extend
  // the public lazy constructor callbacks instead of changing measured lib.
  solver.pipelineDef = solver.pipelineDef.map(
    (step): SolverInstance["pipelineDef"][number] => {
      const isRouteStage = step.solverName === "highDensityRouteSolver"
      if (!isRouteStage && step.solverName !== "highDensityRepairSolver")
        return step
      const getConstructorParams = step.getConstructorParams
      if (typeof getConstructorParams !== "function") {
        throw new Error(
          `Networked benchmark ${step.solverName} constructor parameters are unavailable`,
        )
      }
      if (isRouteStage) configuredRouteStage = true
      return {
        ...step,
        getConstructorParams: (
          instance: SolverInstance,
        ): readonly unknown[] => {
          const constructorParams = getConstructorParams.call(step, instance)
          const params = constructorParams[0]
          const isNetworkedParams =
            params !== null &&
            typeof params === "object" &&
            !Array.isArray(params) &&
            typeof (params as Record<string, unknown>).autorouterVersion ===
              "string"
          if (!isNetworkedParams) {
            if (isRouteStage)
              throw new Error(
                "Networked benchmark high-density routing constructor identity is unavailable",
              )
            return constructorParams // Older checkouts perform repair locally.
          }
          return [
            { ...params, requestTimeoutMs },
            ...constructorParams.slice(1),
          ]
        },
      }
    },
  )
  if (!configuredRouteStage) {
    throw new Error(
      "Networked benchmark high-density routing stage is unavailable",
    )
  }
}

export const createSolverForTask = (task: BenchmarkTask): SolverInstance => {
  const constructorName = task.solverConstructorName ?? task.solverName
  const SolverConstructor = getSolverConstructor(constructorName)
  const scenarioOptions = getBenchmarkSolverOptions(task.scenario)
  if (constructorName !== "AutoroutingPipelineSolver9_Networked") {
    return new SolverConstructor(task.scenario, scenarioOptions)
  }

  const networkedServer = task.networkedServer
  if (!networkedServer) {
    throw new Error(
      "Pipeline9_Networked benchmark requires a configured local cluster or explicit --networked-remote; use benchmark.sh",
    )
  }
  const solver = new SolverConstructor(task.scenario, {
    ...scenarioOptions,
    hdCache2ServerUrl: networkedServer.url,
    hdCache2CacheVersion: networkedServer.cacheVersion,
  })
  if (networkedServer.requestTimeoutMs !== undefined) {
    configureNetworkedBenchmarkRequestTimeout(
      solver,
      networkedServer.requestTimeoutMs,
    )
  }
  return solver
}

const getErrorMessage = (error: unknown): string | undefined => {
  if (error === undefined || error === null) {
    return undefined
  }
  return error instanceof Error ? error.message : String(error)
}

const toErrorRecord = (error: object): Record<string, unknown> =>
  error as unknown as Record<string, unknown>

const normalizeDrcMessage = (message: unknown) =>
  typeof message === "string" && message.trim().length > 0
    ? message.replace(/\s+/g, " ").trim()
    : "no message"

const getDrcErrorType = (error: object) => {
  const errorRecord = toErrorRecord(error)
  const message = normalizeDrcMessage(errorRecord.message)
  if (
    message.includes("overlaps with pcb_smtpad") &&
    message.includes("accidental contact")
  ) {
    return "trace_smtpad_accidental_contact"
  }
  if (
    message.includes("overlaps with pcb_plated_hole") &&
    message.includes("accidental contact")
  ) {
    return "trace_plated_hole_accidental_contact"
  }
  if (message.includes("is too close to pcb_smtpad")) {
    return "trace_smtpad_clearance"
  }
  if (message.includes("is too close to pcb_plated_hole")) {
    return "trace_plated_hole_clearance"
  }
  if (message.includes("overlaps with pcb_trace")) {
    return "trace_trace_overlap"
  }
  if (message.includes("overlaps with pcb_via")) {
    return "trace_via_overlap"
  }

  const explicitType = errorRecord.error_type ?? errorRecord.type
  if (typeof explicitType === "string" && explicitType.length > 0) {
    return explicitType
  }

  const errorId = errorRecord.pcb_error_id
  if (typeof errorId === "string") {
    if (errorId.startsWith("same_net_vias_close_")) {
      return "same_net_vias_close"
    }
    if (errorId.startsWith("different_net_vias_close_")) {
      return "different_net_vias_close"
    }
  }

  return "unknown_drc_error"
}

const incrementCount = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1
}

const summarizeDrcErrors = (errors: object[]): DrcSummary => {
  const drcErrorTypes: Record<string, number> = {}
  const messageCounts: Record<string, number> = {}

  for (const error of errors) {
    incrementCount(drcErrorTypes, getDrcErrorType(error))
    incrementCount(
      messageCounts,
      normalizeDrcMessage(toErrorRecord(error).message),
    )
  }

  const drcErrorMessages = Object.entries(messageCounts)
    .sort(([, countA], [, countB]) => countB - countA)
    .slice(0, 5)
    .map(([message, count]) => ({ message, count }))

  return {
    drcErrorCount: errors.length,
    drcErrorTypes,
    drcErrorMessages,
  }
}

const getSolverInstanceName = (
  solver: SubSolverInstance | null | undefined,
) => {
  if (!solver) {
    return undefined
  }

  const nameFromMethod = solver.getSolverName?.()
  if (nameFromMethod) {
    return nameFromMethod
  }

  return solver.constructor?.name
}

const getFailureInfo = (
  solver: SolverInstance,
  fallbackError?: string,
): FailureInfo => {
  const pipelineStep = solver.pipelineDef[solver.currentPipelineStepIndex]
  const activeSubSolver = solver.activeSubSolver ?? null

  return {
    errorPhaseName: pipelineStep?.solverName,
    errorSolverName:
      pipelineStep?.solverClass?.name ?? getSolverInstanceName(activeSubSolver),
    error:
      getErrorMessage(activeSubSolver?.error) ??
      getErrorMessage(solver.error) ??
      fallbackError,
  }
}

const getProgressInfo = (
  task: BenchmarkTask,
  solver: SolverInstance,
  elapsedTimeMs: number,
): WorkerProgress => {
  const pipelineStep = solver.pipelineDef[solver.currentPipelineStepIndex]
  const activeSubSolver = solver.activeSubSolver ?? null

  return {
    solverName: task.solverName,
    scenarioName: task.scenarioName,
    sampleNumber: task.sampleNumber,
    elapsedTimeMs,
    phaseName: pipelineStep?.solverName,
    phaseSolverName:
      pipelineStep?.solverClass?.name ?? getSolverInstanceName(activeSubSolver),
    solverProgress: solver.progress,
    solverIterations: solver.iterations,
    activeSubSolverProgress: activeSubSolver?.progress,
    activeSubSolverIterations: activeSubSolver?.iterations,
    stageTiming: extractBenchmarkStageTiming(solver, "partial"),
  }
}

const getProgressKey = (solver: SolverInstance): string => {
  const pipelineStep = solver.pipelineDef[solver.currentPipelineStepIndex]
  const phaseName = pipelineStep?.solverName ?? ""
  const phaseSolverName =
    pipelineStep?.solverClass?.name ??
    getSolverInstanceName(solver.activeSubSolver) ??
    ""
  return `${phaseName}|${phaseSolverName}`
}

export const getRoutingBenchmarkMetrics = (
  solver: SolverInstance,
): RoutingBenchmarkMetrics => {
  const networkedStats = [
    solver.highDensityRouteSolver?.stats,
    solver.highDensityRepairSolver?.stats,
  ].filter(
    (stats): stats is Record<string, unknown> =>
      stats !== undefined && typeof stats.remoteRequestsStarted === "number",
  )
  let networkedHighDensity: RoutingBenchmarkMetrics["networkedHighDensity"]
  if (networkedStats.length > 0) {
    networkedHighDensity = {
      remoteRequestsStarted: 0,
      remoteRequestsCompleted: 0,
      remoteBatchCacheMisses: 0,
      remoteSingleRequestsStarted: 0,
      remoteCacheHits: 0,
      remoteSolverResults: 0,
      remoteTransportFallbacks: 0,
    }
    for (const stats of networkedStats) {
      for (const key of [
        "remoteRequestsStarted",
        "remoteRequestsCompleted",
        "remoteBatchCacheMisses",
        "remoteSingleRequestsStarted",
        "remoteCacheHits",
        "remoteSolverResults",
        "remoteTransportFallbacks",
      ] as const) {
        networkedHighDensity[key] += Number(stats[key] ?? 0)
      }
      const reasonCounts = stats.remoteFallbackReasonCounts as
        | Record<string, number>
        | undefined
      if (reasonCounts) {
        const combined = (networkedHighDensity.remoteFallbackReasonCounts ??=
          {})
        for (const [reason, count] of Object.entries(reasonCounts)) {
          combined[reason] = (combined[reason] ?? 0) + count
        }
      }
    }
  }
  return {
    tinyHypergraph:
      solver.portPointPathingSolver?.getSolveGraphBenchmarkMetrics?.(),
    highDensityIterations: solver.highDensityRouteSolver?.iterations,
    phaseTimeMs: solver.timeSpentOnPhase,
    networkedHighDensity,
  }
}

const getNetworkedBenchmarkValidationError = (
  task: BenchmarkTask,
  solver: SolverInstance,
): string | undefined => {
  if (!task.networkedCachePass) return undefined
  const stats = getRoutingBenchmarkMetrics(solver).networkedHighDensity
  if (!stats) return "Pipeline9_Networked did not expose remote cache metrics"
  const validationRejections =
    task.networkedServer?.backend === "local"
      ? countDeterministicNetworkedValidationRejections(stats)
      : 0
  if (stats.remoteTransportFallbacks > validationRejections) {
    return `Pipeline9_Networked used ${stats.remoteTransportFallbacks} local transport fallback(s)`
  }
  if (stats.remoteRequestsCompleted !== stats.remoteRequestsStarted) {
    return `Pipeline9_Networked did not drain all requests (${stats.remoteRequestsCompleted}/${stats.remoteRequestsStarted})`
  }
  if (
    task.networkedCachePass === "hot" &&
    (stats.remoteBatchCacheMisses > 0 ||
      stats.remoteSingleRequestsStarted > 0 ||
      stats.remoteSolverResults > 0 ||
      stats.remoteCacheHits + validationRejections !==
        stats.remoteRequestsStarted)
  ) {
    return `Pipeline9_Networked hot pass was not fully cached (${stats.remoteCacheHits}/${stats.remoteRequestsStarted} cache hit(s), ${stats.remoteBatchCacheMisses} batch miss(es), ${stats.remoteSingleRequestsStarted} single solve(s), ${stats.remoteSolverResults} solver result(s))`
  }
  return undefined
}

export const validateNetworkedBenchmark = async (
  task: BenchmarkTask,
  solver: SolverInstance,
): Promise<void> => {
  if (!task.networkedCachePass) return
  const sources = [
    {
      name: "highDensityRouteSolver",
      source: solver.highDensityRouteSolver,
      required: true,
    },
    {
      name: "highDensityRepairSolver",
      source: solver.highDensityRepairSolver,
      required:
        typeof solver.highDensityRepairSolver?.stats?.remoteRequestsStarted ===
        "number",
    },
  ]
  const drains = await Promise.allSettled(
    sources.map(async ({ name, source, required }): Promise<void> => {
      if (typeof source?.waitForAllRemoteRequests === "function") {
        await source.waitForAllRemoteRequests()
      } else if (required) {
        throw new Error(
          `Pipeline9_Networked benchmark requires an explicit remote-request drain for ${name}`,
        )
      }
    }),
  )
  for (const drain of drains) {
    if (drain.status === "rejected") throw drain.reason
  }
  const validationError = getNetworkedBenchmarkValidationError(task, solver)
  if (validationError) throw new Error(validationError)
}

export const solveWithProgress = async (
  task: BenchmarkTask,
  solver: SolverInstance,
  start: number,
  options: RunTaskOptions,
): Promise<void> => {
  const progressIntervalMs =
    options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS
  let lastProgressAt = -Infinity
  let lastProgressKey = ""

  const emitProgress = (force = false) => {
    if (!options.onProgress) {
      return
    }

    const elapsedTimeMs = performance.now() - start
    const progressKey = getProgressKey(solver)
    if (
      !force &&
      progressKey === lastProgressKey &&
      elapsedTimeMs - lastProgressAt < progressIntervalMs
    ) {
      return
    }

    lastProgressAt = elapsedTimeMs
    lastProgressKey = progressKey
    // Building stage timings walks the completed pipeline and allocates a
    // report. Do that only for emitted updates, not every routing iteration.
    options.onProgress(getProgressInfo(task, solver, elapsedTimeMs))
  }

  emitProgress(true)

  if (
    (task.threads ?? 1) > 1 &&
    ((task.solverConstructorName ?? task.solverName) !==
      "AutoroutingPipelineSolver9_PreloadedTraceGraph" ||
      typeof solver.solveAsync !== "function")
  ) {
    throw new Error("--threads > 1 requires Pipeline9_PreloadedTraceGraph")
  }

  if (typeof solver.solveAsync === "function") {
    const interval =
      options.onProgress && progressIntervalMs > 0
        ? setInterval(() => emitProgress(true), progressIntervalMs)
        : null
    let runtime:
      | (SolverRuntimeExecutor & { dispose(): Promise<void> })
      | undefined
    try {
      if ((task.threads ?? 1) > 1) {
        const { createAutorouterSolverRuntime } = await import(
          "../../lib/runtime/bun"
        )
        runtime = createAutorouterSolverRuntime({
          workerCount: task.threads!,
          requireWorker: true,
        })
      }
      await solver.solveAsync(runtime)
    } finally {
      if (interval) {
        clearInterval(interval)
      }
      await runtime?.dispose()
    }
    emitProgress(true)
    return
  }

  if (typeof solver.step === "function") {
    while (!solver.solved && !solver.failed) {
      solver.step()
      emitProgress()
    }
    emitProgress(true)
    return
  }

  if (typeof solver.solve === "function") {
    await solver.solve()
    emitProgress(true)
    return
  }

  throw new Error("Solver does not implement step(), solve(), or solveAsync()")
}

const createBenchmarkSnapshot = async ({
  task,
  solver,
  traces,
  elapsedTimeMs,
  viaCount,
  relaxedDrcPassed,
  drcErrorCount,
}: {
  task: BenchmarkTask
  solver: SolverInstance
  traces: SimplifiedPcbTrace[]
  elapsedTimeMs: number
  viaCount: number
  relaxedDrcPassed: boolean
  drcErrorCount?: number
}): Promise<BenchmarkSnapshotWithImage> => {
  const finalSrj: SimpleRouteJson = solver.getOutputSimpleRouteJson?.() ?? {
    ...(solver.srjWithPointPairs ?? task.scenario),
    traces,
  }

  const graphics = convertSrjToGraphicsObject(finalSrj)
  const imageSvg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
  })

  return {
    datasetName: task.datasetName,
    solverName: task.solverName,
    scenarioName: task.scenarioName,
    sampleNumber: task.sampleNumber,
    label: `${task.datasetName} sample ${task.sampleNumber} - ${task.solverName}`,
    elapsedTimeMs,
    traceCount: traces.length,
    viaCount,
    relaxedDrcPassed,
    drcErrorCount,
    imageSvg,
  }
}

export const runTask = async (
  task: BenchmarkTask,
  options: RunTaskOptions = {},
): Promise<WorkerResultWithImage> => {
  const solver = createSolverForTask(task)
  const start = performance.now()
  let solveError: string | undefined

  try {
    await solveWithProgress(task, solver, start, options)
  } catch (error) {
    solver.solved = false
    solveError = getErrorMessage(error)
  }

  if (task.networkedCachePass) {
    try {
      await validateNetworkedBenchmark(task, solver)
    } catch (error) {
      solver.solved = false
      solveError = getErrorMessage(error)
    }
  }
  const elapsedTimeMs = performance.now() - start

  const didSolve = Boolean(solver.solved)
  const routingMetrics = getRoutingBenchmarkMetrics(solver)
  let stageTimingStatus: "complete" | "partial" = "partial"
  if (didSolve) {
    stageTimingStatus = "complete"
  }
  const stageTiming = extractBenchmarkStageTiming(solver, stageTimingStatus)

  if (!didSolve) {
    const failureInfo = getFailureInfo(solver, solveError)
    return {
      solverName: task.solverName,
      scenarioName: task.scenarioName,
      sampleNumber: task.sampleNumber,
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed: false,
      stageTiming,
      routingMetrics,
      ...failureInfo,
    }
  }

  try {
    const traces = solver.failed
      ? []
      : (solver.getOutputSimplifiedPcbTraces?.() ?? [])
    if (typeof solver.getOutputSimpleRouteJson !== "function") {
      throw new Error(
        "Cannot lint a solved benchmark without routed SimpleRouteJson",
      )
    }
    const finalSrj = solver.getOutputSimpleRouteJson()
    const traceLinter = runTraceLinting(finalSrj)
    const traceLintIssueCounts: Record<string, number> = Object.fromEntries(
      Object.keys(TRACE_LINT_LABELS).map((type) => [type, 0]),
    )
    for (const issue of traceLinter.getOutput()) {
      traceLintIssueCounts[issue.type] =
        (traceLintIssueCounts[issue.type] ?? 0) + 1
    }
    const viaCount = countTraceVias(traces)
    const { errors } = evaluateRelaxedDrc({
      inputSrj: task.scenario,
      srjWithPointPairs: solver.srjWithPointPairs ?? task.scenario,
      routedTraces: traces,
    })
    const relaxedDrcPassed = errors.length === 0
    const drcSummary = summarizeDrcErrors(errors as object[])
    let benchmarkSnapshot: BenchmarkSnapshotWithImage | undefined

    try {
      benchmarkSnapshot = await createBenchmarkSnapshot({
        task,
        solver,
        traces,
        elapsedTimeMs,
        viaCount,
        relaxedDrcPassed,
        drcErrorCount: drcSummary.drcErrorCount,
      })
    } catch (error) {
      console.error(
        `[benchmark-snapshot] ${task.solverName} ${task.scenarioName} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    return {
      solverName: task.solverName,
      scenarioName: task.scenarioName,
      sampleNumber: task.sampleNumber,
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed,
      viaCount,
      traceLintIssueCounts,
      stageTiming,
      routingMetrics,
      benchmarkSnapshot,
      ...(task.captureFinalSrj ? { finalSrj } : {}),
      ...drcSummary,
    }
  } catch (error) {
    return {
      solverName: task.solverName,
      scenarioName: task.scenarioName,
      sampleNumber: task.sampleNumber,
      elapsedTimeMs,
      didSolve,
      didTimeout: false,
      relaxedDrcPassed: false,
      stageTiming,
      routingMetrics,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
