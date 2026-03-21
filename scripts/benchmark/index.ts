#!/usr/bin/env bun

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import * as readline from "node:readline"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import type {
  BenchmarkTask,
  WorkerResult,
  WorkerResultMessage,
  WorkerTaskMessage,
} from "./benchmark-types"

type SolverRunResult = {
  solverName: string
  completedRateLabel: string
  relaxedDrcRateLabel: string
  timedOutLabel: string
  p50TimeMs: number | null
  p95TimeMs: number | null
}

type BenchmarkOptions = {
  solverName?: string
  scenarioLimit?: number
  concurrency: number
  effort?: number
  sampleTimeoutMs?: number
  excludeAssignable: boolean
  datasetName: DatasetName
}

type WorkerTaskAssignment = {
  request: WorkerTaskMessage
  startedAtMs: number
  timeout: ReturnType<typeof setTimeout>
}

type WorkerSlot = {
  id: number
  child: ChildProcessWithoutNullStreams
  stdoutReader: readline.Interface
  stderrReader: readline.Interface
  currentTask: WorkerTaskAssignment | null
}

type WorkerExecutionResult = {
  result: WorkerResult
  restartWorker: boolean
}

const DEFAULT_TASK_TIMEOUT_PER_EFFORT_MS = 60 * 1000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1000
const DEFAULT_TERMINATE_TIMEOUT_MS = 5 * 1000
const DATASET_NAMES = ["dataset01", "zdwiel"] as const

type DatasetName = (typeof DATASET_NAMES)[number]
type DatasetModule = Record<string, unknown>

const isDatasetName = (value: string): value is DatasetName =>
  DATASET_NAMES.includes(value as DatasetName)

const datasetLoaders: Record<DatasetName, () => Promise<DatasetModule>> = {
  dataset01: async () =>
    (await import("@tscircuit/autorouting-dataset-01")) as DatasetModule,
  zdwiel: async () => (await import("zdwiel-dataset")) as DatasetModule,
}

const datasetScenarioKeyPatterns: Record<DatasetName, RegExp> = {
  dataset01: /^circuit\d+$/,
  zdwiel: /^ts\d+_/,
}

const formatTime = (timeMs: number | null) => {
  if (timeMs === null) {
    return "n/a"
  }
  return `${(timeMs / 1000).toFixed(1)}s`
}

const formatDurationLabel = (timeMs: number) => {
  if (timeMs < 1000) {
    return `${timeMs}ms`
  }
  return formatTime(timeMs)
}

const getTaskTimeoutPerEffortMs = () => {
  const rawTimeout =
    Bun.env.BENCHMARK_TASK_TIMEOUT_PER_EFFORT_MS?.trim() ??
    Bun.env.BENCHMARK_TASK_TIMEOUT_MS?.trim()
  if (!rawTimeout) {
    return DEFAULT_TASK_TIMEOUT_PER_EFFORT_MS
  }

  const parsedTimeout = Number.parseInt(rawTimeout, 10)
  if (!Number.isFinite(parsedTimeout) || parsedTimeout < 1) {
    throw new Error(
      "BENCHMARK_TASK_TIMEOUT_PER_EFFORT_MS must be a positive integer",
    )
  }

  return parsedTimeout
}

const getHeartbeatIntervalMs = () => {
  const rawInterval = Bun.env.BENCHMARK_HEARTBEAT_INTERVAL_MS?.trim()
  if (!rawInterval) {
    return DEFAULT_HEARTBEAT_INTERVAL_MS
  }

  const parsedInterval = Number.parseInt(rawInterval, 10)
  if (!Number.isFinite(parsedInterval) || parsedInterval < 0) {
    throw new Error(
      "BENCHMARK_HEARTBEAT_INTERVAL_MS must be a non-negative integer",
    )
  }

  return parsedInterval
}

const getTerminateTimeoutMs = () => {
  const rawTimeout = Bun.env.BENCHMARK_TERMINATE_TIMEOUT_MS?.trim()
  if (!rawTimeout) {
    return DEFAULT_TERMINATE_TIMEOUT_MS
  }

  const parsedTimeout = Number.parseInt(rawTimeout, 10)
  if (!Number.isFinite(parsedTimeout) || parsedTimeout < 1) {
    throw new Error("BENCHMARK_TERMINATE_TIMEOUT_MS must be a positive integer")
  }

  return parsedTimeout
}

const getPercentileMs = (
  values: number[],
  percentile: number,
): number | null => {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)

  if (lower === upper) {
    return sorted[lower]
  }

  const weight = index - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight
}

const parseDurationArg = (rawValue: string, flagName: string) => {
  const value = rawValue.trim()
  const match = value.match(/^(\d+)(ms|s|m)?$/)
  if (!match) {
    throw new Error(
      `${flagName} must be an integer with optional ms, s, or m suffix`,
    )
  }

  const amount = Number.parseInt(match[1], 10)
  const unit = match[2] ?? "ms"
  const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1

  return amount * multiplier
}

const parseArgs = (): BenchmarkOptions => {
  const args = process.argv.slice(2)
  const defaultConcurrency =
    typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : os.cpus().length
  const options: BenchmarkOptions = {
    concurrency: defaultConcurrency,
    excludeAssignable: false,
    datasetName: "dataset01",
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--solver") {
      options.solverName = args[i + 1]
      i += 1
      continue
    }
    if (arg === "--scenario-limit") {
      options.scenarioLimit = Number.parseInt(args[i + 1], 10)
      i += 1
      continue
    }
    if (arg === "--concurrency") {
      const rawConcurrency = args[i + 1]
      options.concurrency =
        rawConcurrency === "auto"
          ? defaultConcurrency
          : Number.parseInt(rawConcurrency, 10)
      i += 1
      continue
    }
    if (arg === "--effort") {
      options.effort = Number.parseInt(args[i + 1] ?? "", 10)
      i += 1
      continue
    }
    if (arg === "--sample-timeout") {
      options.sampleTimeoutMs = parseDurationArg(
        args[i + 1] ?? "",
        "--sample-timeout",
      )
      i += 1
      continue
    }
    if (arg === "--exclude-assignable") {
      options.excludeAssignable = true
      continue
    }
    if (arg === "--dataset") {
      const rawDatasetName = args[i + 1]
      if (!rawDatasetName || rawDatasetName.startsWith("-")) {
        throw new Error(
          `--dataset requires a value (${DATASET_NAMES.join(", ")})`,
        )
      }
      if (!isDatasetName(rawDatasetName)) {
        throw new Error(
          `Unknown dataset "${rawDatasetName}". Available: ${DATASET_NAMES.join(", ")}`,
        )
      }
      options.datasetName = rawDatasetName
      i += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer")
  }

  if (
    options.scenarioLimit !== undefined &&
    (!Number.isFinite(options.scenarioLimit) || options.scenarioLimit < 1)
  ) {
    throw new Error("--scenario-limit must be a positive integer")
  }

  if (
    options.effort !== undefined &&
    (!Number.isFinite(options.effort) || options.effort < 1)
  ) {
    throw new Error("--effort must be a positive integer")
  }

  return options
}

const loadSolverNames = async (
  excludeAssignable: boolean,
): Promise<string[]> => {
  // Use autorouter-pipelines/index.ts as the source of truth for benchmarkable solvers
  const pipelinesIndexPath = path.join(
    process.cwd(),
    "lib",
    "autorouter-pipelines",
    "index.ts",
  )
  const pipelinesIndex = await readFile(pipelinesIndexPath, "utf8")

  const pipelineNames: string[] = []
  for (const match of pipelinesIndex.matchAll(/export\s*\{\s*(\w+)\s*\}/g)) {
    pipelineNames.push(match[1])
  }

  // Resolve aliases from lib/index.ts (e.g. "X as Y")
  const libIndexPath = path.join(process.cwd(), "lib", "index.ts")
  const libIndex = await readFile(libIndexPath, "utf8")

  const solverNames = pipelineNames.map((name) => {
    const aliasMatch = libIndex.match(new RegExp(`${name}\\s+as\\s+(\\w+)`))
    return aliasMatch ? aliasMatch[1] : name
  })

  if (!excludeAssignable) {
    return solverNames
  }

  return solverNames.filter((name) => !name.includes("Assignable"))
}

const loadScenarios = async (
  datasetName: DatasetName,
  scenarioLimit?: number,
  effort?: number,
) => {
  const applyEffortOverride = <T extends SimpleRouteJson>(
    scenario: T,
    effortOverride: number,
  ) =>
    ({
      ...scenario,
      effort: effortOverride,
    }) as T & { effort: number }

  const datasetModule = await datasetLoaders[datasetName]()
  const scenarioKeyPattern = datasetScenarioKeyPatterns[datasetName]
  const allScenarios = (
    Object.entries(datasetModule) as Array<[string, SimpleRouteJson]>
  )
    .filter(([, value]) => Boolean(value) && typeof value === "object")
    .filter(([name]) => scenarioKeyPattern.test(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, scenario]) =>
        [
          name,
          effort === undefined
            ? scenario
            : applyEffortOverride(scenario, effort),
        ] as [string, SimpleRouteJson],
    )

  return scenarioLimit ? allScenarios.slice(0, scenarioLimit) : allScenarios
}

const formatTable = (rows: SolverRunResult[]) => {
  const headers = [
    "Solver",
    "Completed %",
    "Relaxed DRC Pass %",
    "Timed Out",
    "P50 Time",
    "P95 Time",
  ]

  const body = rows.map((row) => [
    row.solverName,
    row.completedRateLabel,
    row.relaxedDrcRateLabel,
    row.timedOutLabel,
    formatTime(row.p50TimeMs),
    formatTime(row.p95TimeMs),
  ])

  const widths = headers.map((header, columnIndex) => {
    const maxBodyWidth = Math.max(
      ...body.map((cells) => cells[columnIndex].length),
      0,
    )
    return Math.max(header.length, maxBodyWidth)
  })

  const separator = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`
  const headerLine = `| ${headers.map((header, i) => header.padEnd(widths[i])).join(" | ")} |`
  const bodyLines = body.map(
    (cells) =>
      `| ${cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`,
  )

  return [separator, headerLine, separator, ...bodyLines, separator].join("\n")
}

const createChildProcess = () =>
  spawn(process.execPath, ["scripts/benchmark/benchmark.child.ts"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  })

const createWorkerSlot = (id: number): WorkerSlot => {
  const child = createChildProcess()
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")

  return {
    id,
    child,
    stdoutReader: readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    }),
    stderrReader: readline.createInterface({
      input: child.stderr,
      crlfDelay: Infinity,
    }),
    currentTask: null,
  }
}

const terminateWorker = async (slot: WorkerSlot, context: string) => {
  const terminateTimeoutMs = getTerminateTimeoutMs()
  const closeInterfaces = () => {
    slot.stdoutReader.close()
    slot.stderrReader.close()
  }

  if (slot.child.killed || slot.child.exitCode !== null) {
    closeInterfaces()
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      slot.child.removeListener("close", onClose)
      closeInterfaces()
      resolve()
    }

    const onClose = () => {
      finish()
    }

    timeoutHandle = setTimeout(() => {
      console.warn(
        `[benchmark] Child termination exceeded ${formatDurationLabel(terminateTimeoutMs)} while ${context}; continuing`,
      )
      finish()
    }, terminateTimeoutMs)

    slot.child.once("close", onClose)
    try {
      slot.child.kill("SIGKILL")
    } catch {
      finish()
    }
  })
}

const replaceWorker = async (slot: WorkerSlot) => {
  const previousWorker: WorkerSlot = {
    id: slot.id,
    child: slot.child,
    stdoutReader: slot.stdoutReader,
    stderrReader: slot.stderrReader,
    currentTask: slot.currentTask,
  }
  slot.currentTask = null
  const nextWorker = createWorkerSlot(slot.id)
  slot.child = nextWorker.child
  slot.stdoutReader = nextWorker.stdoutReader
  slot.stderrReader = nextWorker.stderrReader
  await terminateWorker(previousWorker, `replacing worker ${slot.id}`)
}

const createFailedResult = (
  task: BenchmarkTask,
  elapsedTimeMs: number,
  error: string,
  didTimeout = false,
): WorkerResult => ({
  solverName: task.solverName,
  scenarioName: task.scenarioName,
  elapsedTimeMs,
  didSolve: false,
  didTimeout,
  relaxedDrcPassed: false,
  error,
})

const getTaskEffort = (task: BenchmarkTask) => {
  const rawEffort = (task.scenario as SimpleRouteJson & { effort?: number })
    .effort
  if (!Number.isFinite(rawEffort) || rawEffort === undefined || rawEffort < 1) {
    return 1
  }
  return rawEffort
}

const getTaskTimeoutMs = (task: BenchmarkTask, sampleTimeoutMs?: number) => {
  if (sampleTimeoutMs !== undefined) {
    return sampleTimeoutMs
  }

  const baseTimeoutMs = getTaskTimeoutPerEffortMs()
  return baseTimeoutMs + baseTimeoutMs * getTaskEffort(task)
}

const formatEffortLabel = (efforts: number[]) => {
  const uniqueEfforts = [...new Set(efforts)].sort((a, b) => a - b)
  if (uniqueEfforts.length === 0) {
    return "unknown effort"
  }
  if (uniqueEfforts.length === 1) {
    return `${uniqueEfforts[0]}x effort`
  }
  return "mixed effort"
}

const formatPercentWithTimeoutRate = (
  totalCount: number,
  matchedCount: number,
  timeoutCount: number,
) => {
  if (totalCount === 0) {
    return "n/a"
  }

  const ratePercent = (matchedCount / totalCount) * 100
  if (timeoutCount === 0) {
    return `${ratePercent.toFixed(1)}%`
  }

  const timeoutPercent = (timeoutCount / totalCount) * 100
  return `${ratePercent.toFixed(1)}% (🕒${timeoutPercent.toFixed(1)}%)`
}

const executeTaskOnWorker = (
  slot: WorkerSlot,
  request: WorkerTaskMessage,
  sampleTimeoutMs?: number,
): Promise<WorkerExecutionResult> => {
  return new Promise((resolve) => {
    const taskTimeoutMs = getTaskTimeoutMs(request.task, sampleTimeoutMs)
    const startedAtMs = performance.now()
    let settled = false

    const finish = (result: WorkerResult, restartWorker: boolean) => {
      if (settled) {
        return
      }
      settled = true
      if (slot.currentTask) {
        clearTimeout(slot.currentTask.timeout)
        slot.currentTask = null
      }
      slot.stdoutReader.removeListener("line", onLine)
      slot.stderrReader.removeListener("line", onStderrLine)
      slot.child.removeListener("error", onError)
      slot.child.removeListener("exit", onExit)
      resolve({ result, restartWorker })
    }

    const getElapsedTimeMs = () =>
      Math.max(0, Math.round(performance.now() - startedAtMs))

    const onLine = (line: string) => {
      let message: WorkerResultMessage
      try {
        message = JSON.parse(line) as WorkerResultMessage
      } catch {
        return
      }

      if (message.taskId !== request.taskId) {
        return
      }

      finish(message.result, false)
    }

    const onStderrLine = (line: string) => {
      console.error(`[benchmark-child ${slot.id}] ${line}`)
    }

    const onError = (error: Error) => {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          `Child process error: ${error.message}`,
        ),
        true,
      )
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          `Child process exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`,
        ),
        true,
      )
    }

    const timeout = setTimeout(() => {
      finish(
        createFailedResult(
          request.task,
          taskTimeoutMs,
          `Timed out after ${formatDurationLabel(taskTimeoutMs)}`,
          true,
        ),
        true,
      )
    }, taskTimeoutMs)

    slot.currentTask = {
      request,
      startedAtMs,
      timeout,
    }

    slot.stdoutReader.on("line", onLine)
    slot.stderrReader.on("line", onStderrLine)
    slot.child.once("error", onError)
    slot.child.once("exit", onExit)

    try {
      slot.child.stdin.write(`${JSON.stringify(request)}\n`)
    } catch (error) {
      finish(
        createFailedResult(
          request.task,
          getElapsedTimeMs(),
          `Worker dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
        true,
      )
    }
  })
}

const runBenchmarkTasks = async (
  tasks: BenchmarkTask[],
  concurrency: number,
  sampleTimeoutMs?: number,
) => {
  const workerCount = Math.min(concurrency, tasks.length)
  const heartbeatIntervalMs = getHeartbeatIntervalMs()
  const queue = tasks.map((task, index) => ({
    taskId: index + 1,
    task,
  }))
  const results = new Array<WorkerResult>(queue.length)
  let completedTaskCount = 0
  const progress = new Map<
    string,
    {
      completed: number
      solved: number
      total: number
    }
  >()

  for (const task of tasks) {
    const existing = progress.get(task.solverName)
    if (existing) {
      existing.total += 1
      continue
    }
    progress.set(task.solverName, {
      completed: 0,
      solved: 0,
      total: 1,
    })
  }

  const workers = Array.from({ length: workerCount }, (_, index) =>
    createWorkerSlot(index + 1),
  )

  const logHeartbeat = () => {
    const activeWorkers = workers
      .filter((worker) => worker.currentTask)
      .map((worker) => {
        const currentTask = worker.currentTask
        if (!currentTask) {
          return null
        }

        const elapsedTimeMs = Math.max(
          0,
          Math.round(performance.now() - currentTask.startedAtMs),
        )
        return `worker ${worker.id}: ${currentTask.request.task.scenarioName} ${formatDurationLabel(elapsedTimeMs)}`
      })
      .filter(Boolean)

    console.log(
      `[benchmark] heartbeat ${completedTaskCount}/${tasks.length} complete, ${queue.length} queued, ${activeWorkers.length} running`,
    )

    if (activeWorkers.length > 0) {
      console.log(`[benchmark] active ${activeWorkers.join(" | ")}`)
    }
  }

  const heartbeat =
    heartbeatIntervalMs > 0
      ? setInterval(logHeartbeat, heartbeatIntervalMs)
      : null

  const runWorkerLoop = async (slot: WorkerSlot) => {
    while (queue.length > 0) {
      const request = queue.shift()
      if (!request) {
        return
      }

      const { result, restartWorker } = await executeTaskOnWorker(
        slot,
        request,
        sampleTimeoutMs,
      )
      results[request.taskId - 1] = result
      completedTaskCount += 1

      const solverProgress = progress.get(result.solverName)
      if (!solverProgress) {
        throw new Error(`Missing progress tracker for ${result.solverName}`)
      }

      solverProgress.completed += 1
      if (result.didSolve) {
        solverProgress.solved += 1
      }

      const status = result.didTimeout
        ? "timed out"
        : result.didSolve
          ? "solved"
          : "failed"
      const successRate =
        solverProgress.completed === 0
          ? 0
          : (solverProgress.solved / solverProgress.completed) * 100
      const suffix = result.error ? ` (${result.error})` : ""
      console.log(
        `[${result.solverName}] ${successRate.toFixed(1)}% success (${solverProgress.solved}/${solverProgress.completed}) ${status} ${result.scenarioName} ${formatTime(result.elapsedTimeMs)}${suffix}`,
      )

      if (restartWorker) {
        console.warn(
          `[benchmark] Restarting worker ${slot.id} after ${result.scenarioName}`,
        )
        await replaceWorker(slot)
      }
    }
  }

  try {
    await Promise.all(workers.map((worker) => runWorkerLoop(worker)))
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat)
    }
    for (const worker of workers) {
      await terminateWorker(worker, `shutting down worker ${worker.id}`)
    }
  }

  return results
}

const summarizeSolverResults = (
  solverName: string,
  efforts: number[],
  results: WorkerResult[],
): SolverRunResult => {
  const timedOut = results.filter((result) => result.didTimeout)
  const succeeded = results.filter((result) => result.didSolve)
  const elapsedForSucceeded = succeeded.map((result) => result.elapsedTimeMs)
  const relaxedDrcPassed = succeeded.filter(
    (result) => result.relaxedDrcPassed,
  ).length

  return {
    solverName,
    completedRateLabel: formatPercentWithTimeoutRate(
      results.length,
      succeeded.length,
      timedOut.length,
    ),
    relaxedDrcRateLabel: formatPercentWithTimeoutRate(
      results.length,
      relaxedDrcPassed,
      timedOut.length,
    ),
    timedOutLabel: `${timedOut.length}/${results.length}`,
    p50TimeMs: getPercentileMs(elapsedForSucceeded, 0.5),
    p95TimeMs: getPercentileMs(elapsedForSucceeded, 0.95),
  } satisfies SolverRunResult
}

const main = async () => {
  const {
    solverName,
    scenarioLimit,
    concurrency,
    effort,
    sampleTimeoutMs,
    excludeAssignable,
    datasetName,
  } = parseArgs()
  const availableSolvers = await loadSolverNames(excludeAssignable)
  const solvers = solverName ? [solverName] : availableSolvers

  if (solverName && !availableSolvers.includes(solverName)) {
    throw new Error(
      `Unknown solver \"${solverName}\". Available: ${availableSolvers.join(", ")}`,
    )
  }

  const scenarios = await loadScenarios(datasetName, scenarioLimit, effort)
  if (scenarios.length === 0) {
    throw new Error(`No benchmark scenarios found for dataset "${datasetName}"`)
  }

  const tasks = solvers.flatMap((solver) =>
    scenarios.map(
      ([scenarioName, scenario]) =>
        ({
          solverName: solver,
          scenarioName,
          scenario,
        }) satisfies BenchmarkTask,
    ),
  )

  console.log(
    `Running ${tasks.length} benchmark tasks across ${concurrency} workers (${solvers.length} solver${solvers.length === 1 ? "" : "s"}, ${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"}, dataset: ${datasetName})`,
  )

  const results = await runBenchmarkTasks(tasks, concurrency, sampleTimeoutMs)
  const rows = solvers.map((solver) =>
    summarizeSolverResults(
      solver,
      scenarios.map(([, scenario]) =>
        getTaskEffort({
          solverName: solver,
          scenarioName: "",
          scenario,
        }),
      ),
      results.filter((result) => result.solverName === solver),
    ),
  )

  const effortLabel = formatEffortLabel(
    scenarios.map(([, scenario]) =>
      getTaskEffort({
        solverName: solvers[0] ?? "",
        scenarioName: "",
        scenario,
      }),
    ),
  )
  const table = formatTable(rows)
  const output = `Benchmark Results (${effortLabel})\n\n${table}\n\nDataset: ${datasetName}\nScenarios: ${scenarios.length}\n`
  await Bun.write("benchmark-result.txt", output)

  console.log(`\nBenchmark Results (${effortLabel})\n`)
  console.log(table)
  console.log(`\nDataset: ${datasetName}`)
  console.log(`\nScenarios: ${scenarios.length}`)
  console.log("Results written to benchmark-result.txt")
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Benchmark failed: ${message}`)
  process.exit(1)
})
