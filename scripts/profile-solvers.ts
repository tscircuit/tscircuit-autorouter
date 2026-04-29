#!/usr/bin/env bun

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import * as os from "node:os"
import * as readline from "node:readline"
import { AutoroutingPipelineSolver } from "../lib"
import { BaseSolver } from "../lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "../lib/types/srj-types"
import {
  DATASET_OPTIONS_LABEL,
  type DatasetName,
  loadScenarios as loadBenchmarkScenarios,
  parseDatasetName,
} from "./benchmark/scenarios"

// --- Types ---
type SolverRecord = {
  name: string
  success: boolean
  timeMs: number
  iterations: number
  maxIterations: number
  scenarioName: string
}

type ProfileOptions = {
  scenarioName?: string
  scenarioLimit?: number
  datasetName: DatasetName
  effort?: number
  concurrency: number
  sampleTimeoutMs?: number
}

type ProfileSolverRow = {
  solverName: string
  attemptCount: number
  scenarioCount: number
  scenarioSuccessRate: number
  maxIterations: number
  totalIterations: number
  totalTimeMs: number
  p50TimeMs: number | null
  p95TimeMs: number | null
  p50Iterations: number | null
  p95Iterations: number | null
}

type ProfileTask = {
  scenarioName: string
  scenario: SimpleRouteJson
}

type ProfileTaskMessage = {
  taskId: number
  task: ProfileTask
}

type ProfileTaskResult = {
  scenarioName: string
  solved: boolean
  elapsedTimeMs: number
  records: SolverRecord[]
  error?: string
  didTimeout?: boolean
}

type ProfileTaskResultMessage = {
  taskId: number
  result: ProfileTaskResult
}

type WorkerTaskAssignment = {
  request: ProfileTaskMessage
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

// --- Global profiling state ---
const isWorkerProcess = process.argv.includes("--worker")
let currentScenarioName = ""
let currentScenarioIndex = 0
let currentScenarioStartedAt = 0
let lastHeartbeatAt = 0
let scenarioCount = 0
const allRecords: SolverRecord[] = []

const getHeartbeatIntervalMs = () => {
  const rawInterval = Bun.env.PROFILE_SOLVERS_HEARTBEAT_INTERVAL_MS?.trim()
  if (!rawInterval) return 30_000

  const intervalMs = Number.parseInt(rawInterval, 10)
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new Error(
      "PROFILE_SOLVERS_HEARTBEAT_INTERVAL_MS must be a non-negative integer",
    )
  }

  return intervalMs
}

const heartbeatIntervalMs = getHeartbeatIntervalMs()
const DEFAULT_TASK_TIMEOUT_PER_EFFORT_MS = 60 * 1000
const DEFAULT_TERMINATE_TIMEOUT_MS = 5 * 1000

// --- Monkey-patch BaseSolver.step() to capture timing/iteration data ---
const origStep = BaseSolver.prototype.step

BaseSolver.prototype.step = function (
  this: BaseSolver & {
    __profilingStartTime?: number
    __profilingRecorded?: boolean
  },
) {
  // Record start time on first step
  if (this.__profilingStartTime === undefined && !this.solved && !this.failed) {
    this.__profilingStartTime = performance.now()
  }

  const wasDone = this.solved || this.failed

  try {
    origStep.call(this)
  } finally {
    const now = performance.now()
    if (
      !isWorkerProcess &&
      heartbeatIntervalMs > 0 &&
      currentScenarioName &&
      now - lastHeartbeatAt >= heartbeatIntervalMs
    ) {
      lastHeartbeatAt = now
      console.log(
        `[profile-solvers] active ${currentScenarioIndex}/${scenarioCount} ${currentScenarioName} ${formatTime(now - currentScenarioStartedAt)} (${allRecords.length} solver records)`,
      )
    }

    // Record once when solver transitions to solved/failed
    if (!wasDone && !this.__profilingRecorded && (this.solved || this.failed)) {
      this.__profilingRecorded = true
      const timeMs =
        performance.now() - (this.__profilingStartTime ?? performance.now())
      allRecords.push({
        name: this.getSolverName(),
        success: this.solved && !this.failed,
        timeMs,
        iterations: this.iterations,
        maxIterations: this.MAX_ITERATIONS,
        scenarioName: currentScenarioName,
      })
    }
  }
}

// --- Helpers ---
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

const parseArgs = (): ProfileOptions => {
  const args = process.argv.slice(2)
  const defaultConcurrency =
    typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : os.cpus().length
  const options: ProfileOptions = {
    datasetName: "dataset01",
    concurrency: defaultConcurrency,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--worker") {
      continue
    }
    if (arg === "--scenario") {
      const scenarioName = args[i + 1]
      if (!scenarioName || scenarioName.startsWith("-")) {
        throw new Error("--scenario requires a scenario name")
      }
      options.scenarioName = scenarioName
      i += 1
    } else if (arg === "--scenario-limit") {
      const rawScenarioLimit = args[i + 1]
      if (!rawScenarioLimit || rawScenarioLimit.startsWith("-")) {
        throw new Error("--scenario-limit requires a value")
      }
      options.scenarioLimit = Number.parseInt(rawScenarioLimit, 10)
      i += 1
    } else if (arg === "--dataset") {
      const rawDatasetName = args[i + 1]
      if (!rawDatasetName || rawDatasetName.startsWith("-")) {
        throw new Error(`--dataset requires a value (${DATASET_OPTIONS_LABEL})`)
      }
      const datasetName = parseDatasetName(rawDatasetName)
      if (!datasetName) {
        throw new Error(
          `Unknown dataset "${rawDatasetName}". Available: ${DATASET_OPTIONS_LABEL}`,
        )
      }
      options.datasetName = datasetName
      i += 1
    } else if (arg === "--effort") {
      const rawEffort = args[i + 1]
      if (!rawEffort || rawEffort.startsWith("-")) {
        throw new Error("--effort requires a value")
      }
      options.effort = Number.parseInt(rawEffort, 10)
      i += 1
    } else if (arg === "--concurrency") {
      const rawConcurrency = args[i + 1]
      if (!rawConcurrency || rawConcurrency.startsWith("-")) {
        throw new Error("--concurrency requires a value")
      }
      options.concurrency =
        rawConcurrency === "auto"
          ? defaultConcurrency
          : Number.parseInt(rawConcurrency, 10)
      i += 1
    } else if (arg === "--sample-timeout") {
      const rawSampleTimeout = args[i + 1]
      if (!rawSampleTimeout || rawSampleTimeout.startsWith("-")) {
        throw new Error("--sample-timeout requires a value")
      }
      options.sampleTimeoutMs = parseDurationArg(
        rawSampleTimeout,
        "--sample-timeout",
      )
      i += 1
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        [
          "Usage: bun scripts/profile-solvers.ts [--scenario NAME] [--scenario-limit N] [--dataset NAME] [--effort N] [--concurrency N] [--sample-timeout DURATION]",
          "",
          "Options:",
          "  --scenario NAME      Run only the named scenario",
          "  --scenario-limit N   Run only first N scenarios",
          `  --dataset NAME       Dataset to profile: ${DATASET_OPTIONS_LABEL}`,
          "  --effort N           Override scenario effort multiplier",
          "  --concurrency N      Number of worker processes to use, or auto",
          "  --sample-timeout D   Per-scenario timeout, e.g. 120s or 2m",
          "  -h, --help           Show this help",
        ].join("\n"),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
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

  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer")
  }

  return options
}

const loadScenarios = async (options: ProfileOptions) => {
  const allScenarios = await loadBenchmarkScenarios(options.datasetName, {
    scenarioLimit: options.scenarioLimit,
    effort: options.effort,
  })

  return options.scenarioName
    ? allScenarios.filter(([name]) => name === options.scenarioName)
    : allScenarios
}

const getPercentile = (values: number[], p: number): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  const weight = index - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight
}

const formatTime = (ms: number | null): string => {
  if (ms === null) return "n/a"
  if (ms < 1000) return `${ms.toFixed(2)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const formatIter = (n: number | null): string => {
  if (n === null) return "n/a"
  return String(Math.round(n))
}

const formatTable = (headers: string[], body: string[][]): string => {
  const widths = headers.map((h, i) => {
    const maxBody = Math.max(...body.map((row) => row[i].length), 0)
    return Math.max(h.length, maxBody)
  })

  const sep = `+${widths.map((w) => "-".repeat(w + 2)).join("+")}+`
  const headerLine = `| ${headers.map((h, i) => h.padEnd(widths[i])).join(" | ")} |`
  const bodyLines = body.map(
    (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`,
  )

  return [sep, headerLine, sep, ...bodyLines, sep].join("\n")
}

const formatDurationLabel = (timeMs: number) => {
  if (timeMs < 1000) {
    return `${Math.round(timeMs)}ms`
  }
  return `${(timeMs / 1000).toFixed(1)}s`
}

const getTaskEffort = (scenario: SimpleRouteJson) => {
  const rawEffort = (scenario as SimpleRouteJson & { effort?: number }).effort
  if (!Number.isFinite(rawEffort) || rawEffort === undefined || rawEffort < 1) {
    return 1
  }
  return rawEffort
}

const getTaskTimeoutPerEffortMs = () => {
  const rawTimeout =
    Bun.env.PROFILE_SOLVERS_TASK_TIMEOUT_PER_EFFORT_MS?.trim() ??
    Bun.env.PROFILE_SOLVERS_TASK_TIMEOUT_MS?.trim()
  if (!rawTimeout) {
    return DEFAULT_TASK_TIMEOUT_PER_EFFORT_MS
  }

  const parsedTimeout = Number.parseInt(rawTimeout, 10)
  if (!Number.isFinite(parsedTimeout) || parsedTimeout < 1) {
    throw new Error(
      "PROFILE_SOLVERS_TASK_TIMEOUT_PER_EFFORT_MS must be a positive integer",
    )
  }

  return parsedTimeout
}

const getTaskTimeoutMs = (task: ProfileTask, sampleTimeoutMs?: number) => {
  if (sampleTimeoutMs !== undefined) {
    return sampleTimeoutMs
  }

  const baseTimeoutMs = getTaskTimeoutPerEffortMs()
  return baseTimeoutMs + baseTimeoutMs * getTaskEffort(task.scenario)
}

const getTerminateTimeoutMs = () => {
  const rawTimeout = Bun.env.PROFILE_SOLVERS_TERMINATE_TIMEOUT_MS?.trim()
  if (!rawTimeout) {
    return DEFAULT_TERMINATE_TIMEOUT_MS
  }

  const parsedTimeout = Number.parseInt(rawTimeout, 10)
  if (!Number.isFinite(parsedTimeout) || parsedTimeout < 1) {
    throw new Error(
      "PROFILE_SOLVERS_TERMINATE_TIMEOUT_MS must be a positive integer",
    )
  }

  return parsedTimeout
}

const createFailedTaskResult = (
  task: ProfileTask,
  elapsedTimeMs: number,
  error: string,
  didTimeout = false,
): ProfileTaskResult => ({
  scenarioName: task.scenarioName,
  solved: false,
  elapsedTimeMs,
  records: [],
  error,
  didTimeout,
})

const runProfileTask = (task: ProfileTask): ProfileTaskResult => {
  currentScenarioName = task.scenarioName
  currentScenarioIndex = 1
  currentScenarioStartedAt = performance.now()
  lastHeartbeatAt = currentScenarioStartedAt
  scenarioCount = 1
  allRecords.length = 0

  const solver = new AutoroutingPipelineSolver(task.scenario)
  const startTimeMs = performance.now()
  let solveError: string | undefined

  try {
    solver.solve()
  } catch (error) {
    solveError = error instanceof Error ? error.message : String(error)
  }

  const elapsedTimeMs = performance.now() - startTimeMs

  return {
    scenarioName: task.scenarioName,
    solved: Boolean(solver.solved),
    elapsedTimeMs,
    records: allRecords.map((record) => ({ ...record })),
    error: solveError,
  }
}

const runWorkerProcess = async () => {
  const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })

  input.on("line", (line) => {
    let message: ProfileTaskMessage
    try {
      message = JSON.parse(line) as ProfileTaskMessage
    } catch (error) {
      console.error(
        `[profile-solvers-worker] failed to parse task: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }

    const resultMessage: ProfileTaskResultMessage = {
      taskId: message.taskId,
      result: runProfileTask(message.task),
    }
    process.stdout.write(`${JSON.stringify(resultMessage)}\n`)
  })
}

const createChildProcess = () =>
  spawn(process.execPath, [process.argv[1], "--worker"], {
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
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      slot.child.removeListener("close", onClose)
      closeInterfaces()
      resolve()
    }

    const onClose = () => finish()

    timeoutHandle = setTimeout(() => {
      console.warn(
        `[profile-solvers] Worker termination exceeded ${formatDurationLabel(terminateTimeoutMs)} while ${context}; continuing`,
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

const executeTaskOnWorker = (
  slot: WorkerSlot,
  request: ProfileTaskMessage,
  sampleTimeoutMs?: number,
): Promise<{ result: ProfileTaskResult; restartWorker: boolean }> =>
  new Promise((resolve) => {
    const taskTimeoutMs = getTaskTimeoutMs(request.task, sampleTimeoutMs)
    const startedAtMs = performance.now()
    let settled = false

    const finish = (result: ProfileTaskResult, restartWorker: boolean) => {
      if (settled) return
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
      let message: ProfileTaskResultMessage
      try {
        message = JSON.parse(line) as ProfileTaskResultMessage
      } catch {
        return
      }

      if (message.taskId !== request.taskId) {
        return
      }

      finish(message.result, false)
    }

    const onStderrLine = (line: string) => {
      console.error(`[profile-solvers-child ${slot.id}] ${line}`)
    }

    const onError = (error: Error) => {
      finish(
        createFailedTaskResult(
          request.task,
          getElapsedTimeMs(),
          `Child process error: ${error.message}`,
        ),
        true,
      )
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(
        createFailedTaskResult(
          request.task,
          getElapsedTimeMs(),
          `Child process exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`,
        ),
        true,
      )
    }

    const timeout = setTimeout(() => {
      finish(
        createFailedTaskResult(
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
        createFailedTaskResult(
          request.task,
          getElapsedTimeMs(),
          `Worker dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
        true,
      )
    }
  })

const runProfileTasks = async (
  tasks: ProfileTask[],
  concurrency: number,
  sampleTimeoutMs?: number,
) => {
  const workerCount = Math.min(concurrency, tasks.length)
  const queue = tasks.map((task, index) => ({
    taskId: index + 1,
    task,
  }))
  const results = new Array<ProfileTaskResult>(queue.length)
  const workers = Array.from({ length: workerCount }, (_, index) =>
    createWorkerSlot(index + 1),
  )
  let completedTaskCount = 0
  let solvedTaskCount = 0

  const logHeartbeat = () => {
    const activeWorkers = workers
      .filter((worker) => worker.currentTask)
      .map((worker) => {
        const currentTask = worker.currentTask
        if (!currentTask) return null

        const elapsedTimeMs = Math.max(
          0,
          Math.round(performance.now() - currentTask.startedAtMs),
        )
        return `worker ${worker.id}: ${currentTask.request.task.scenarioName} ${formatDurationLabel(elapsedTimeMs)}`
      })
      .filter(Boolean)

    console.log(
      `[profile-solvers] heartbeat ${completedTaskCount}/${tasks.length} complete, ${queue.length} queued, ${activeWorkers.length} running`,
    )

    if (activeWorkers.length > 0) {
      console.log(`[profile-solvers] active ${activeWorkers.join(" | ")}`)
    }
  }

  const heartbeat =
    heartbeatIntervalMs > 0
      ? setInterval(logHeartbeat, heartbeatIntervalMs)
      : null

  const runWorkerLoop = async (slot: WorkerSlot) => {
    while (queue.length > 0) {
      const request = queue.shift()
      if (!request) return

      console.log(
        `[profile-solvers] queued ${request.taskId}/${tasks.length} running ${request.task.scenarioName} on worker ${slot.id}`,
      )

      const { result, restartWorker } = await executeTaskOnWorker(
        slot,
        request,
        sampleTimeoutMs,
      )
      results[request.taskId - 1] = result
      completedTaskCount += 1
      if (result.solved) solvedTaskCount += 1

      const status = result.didTimeout
        ? "timed out"
        : result.solved
          ? "solved"
          : "failed"
      const successRate = (solvedTaskCount / completedTaskCount) * 100
      const suffix = result.error ? ` (${result.error})` : ""
      console.log(
        `[profile-solvers] ${successRate.toFixed(1)}% success (${solvedTaskCount}/${completedTaskCount}) ${status} ${result.scenarioName} ${formatTime(result.elapsedTimeMs)}${suffix}`,
      )

      if (restartWorker) {
        console.warn(
          `[profile-solvers] Restarting worker ${slot.id} after ${result.scenarioName}`,
        )
        await replaceWorker(slot)
      }
    }
  }

  try {
    await Promise.all(workers.map((worker) => runWorkerLoop(worker)))
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    for (const worker of workers) {
      await terminateWorker(worker, `shutting down worker ${worker.id}`)
    }
  }

  return results
}

// --- Main ---
const main = async () => {
  const runStartedAtMs = performance.now()
  const opts = parseArgs()
  const scenarios = await loadScenarios(opts)
  const workerCount = Math.min(opts.concurrency, scenarios.length)

  if (scenarios.length === 0) {
    if (opts.scenarioName) {
      throw new Error(`Scenario not found: ${opts.scenarioName}`)
    }
    throw new Error("No scenarios found")
  }

  console.log(
    `Running ${scenarios.length} profile-solver tasks across ${workerCount} workers (dataset: ${opts.datasetName})`,
  )

  const results = await runProfileTasks(
    scenarios.map(([scenarioName, scenario]) => ({
      scenarioName,
      scenario,
    })),
    opts.concurrency,
    opts.sampleTimeoutMs,
  )

  allRecords.length = 0
  for (const result of results) {
    allRecords.push(...result.records)
  }

  const solved = results.filter((result) => result.solved).length
  const total = results.length
  const failed = total - solved
  const totalTimeMs = performance.now() - runStartedAtMs
  console.log(
    `\n${solved}/${total} scenarios solved (${failed} failed) in ${formatDurationLabel(totalTimeMs)} using ${workerCount} workers\n`,
  )

  // --- Aggregate by solver name + success/fail ---
  // Skip the top-level pipeline solver itself
  const records = allRecords.filter(
    (r) => !r.name.startsWith("AutoroutingPipelineSolver"),
  )

  const groupsByName = new Map<string, SolverRecord[]>()
  for (const record of records) {
    if (!groupsByName.has(record.name)) groupsByName.set(record.name, [])
    groupsByName.get(record.name)!.push(record)
  }

  type Row = {
    name: string
    attemptCount: number
    scenarioCount: number
    scenarioSuccessRate: number
    maxIter: number
    totalIterations: number
    totalTimeMs: number
    p50Time: number | null
    p95Time: number | null
    p50Iter: number | null
    p95Iter: number | null
  }

  const rows: Row[] = []
  for (const [name, recs] of groupsByName) {
    const scenariosTouched = new Set(recs.map((r) => r.scenarioName))
    const scenariosWithSuccess = new Set(
      recs.filter((r) => r.success).map((r) => r.scenarioName),
    )
    const times = recs.map((r) => r.timeMs)
    const iters = recs.map((r) => r.iterations)
    const maxIter = Math.round(Math.max(...recs.map((r) => r.maxIterations)))
    const totalIterations = recs.reduce((sum, r) => sum + r.iterations, 0)
    const totalTimeMs = recs.reduce((sum, r) => sum + r.timeMs, 0)
    rows.push({
      name,
      attemptCount: recs.length,
      scenarioCount: scenariosTouched.size,
      scenarioSuccessRate:
        scenariosTouched.size === 0
          ? 0
          : (scenariosWithSuccess.size / scenariosTouched.size) * 100,
      maxIter,
      totalIterations,
      totalTimeMs,
      p50Time: getPercentile(times, 0.5),
      p95Time: getPercentile(times, 0.95),
      p50Iter: getPercentile(iters, 0.5),
      p95Iter: getPercentile(iters, 0.95),
    })
  }

  // Sort by total accumulated time (slowest first), then solver name
  rows.sort((a, b) => {
    if (a.totalTimeMs !== b.totalTimeMs) return b.totalTimeMs - a.totalTimeMs
    return a.name.localeCompare(b.name)
  })

  const headers = [
    "Solver",
    "Attempts",
    "Scenarios",
    "Success %",
    "MAX_ITER",
    "Total Iters",
    "Total Time",
    "P50 Time",
    "P95 Time",
    "P50 Iters",
    "P95 Iters",
  ]

  const body = rows.map((r) => [
    r.name,
    String(r.attemptCount),
    String(r.scenarioCount),
    `${r.scenarioSuccessRate.toFixed(0)}%`,
    String(r.maxIter),
    String(Math.round(r.totalIterations)),
    formatTime(r.totalTimeMs),
    formatTime(r.p50Time),
    formatTime(r.p95Time),
    formatIter(r.p50Iter),
    formatIter(r.p95Iter),
  ])

  const table = formatTable(headers, body)
  console.log(table)
  console.log()

  const profileReport = {
    datasetName: opts.datasetName,
    scenarioCount: scenarios.length,
    scenarioName: opts.scenarioName ?? null,
    scenarioLimit: opts.scenarioLimit ?? null,
    effort: opts.effort ?? null,
    concurrency: opts.concurrency,
    workerCount,
    totalTimeMs,
    solved,
    failed,
    rows: rows.map(
      (r): ProfileSolverRow => ({
        solverName: r.name,
        attemptCount: r.attemptCount,
        scenarioCount: r.scenarioCount,
        scenarioSuccessRate: r.scenarioSuccessRate,
        maxIterations: r.maxIter,
        totalIterations: r.totalIterations,
        totalTimeMs: r.totalTimeMs,
        p50TimeMs: r.p50Time,
        p95TimeMs: r.p95Time,
        p50Iterations: r.p50Iter,
        p95Iterations: r.p95Iter,
      }),
    ),
  }

  await Bun.write(
    "profile-solvers.json",
    JSON.stringify(profileReport, null, 2),
  )
}

if (isWorkerProcess) {
  await runWorkerProcess()
} else {
  await main()
}
