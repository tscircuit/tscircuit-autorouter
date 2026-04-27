#!/usr/bin/env bun

import { AutoroutingPipelineSolver } from "../lib"
import { BaseSolver } from "../lib/solvers/BaseSolver"
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

// --- Global profiling state ---
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
const parseArgs = (): ProfileOptions => {
  const args = process.argv.slice(2)
  const options: ProfileOptions = {
    datasetName: "dataset01",
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
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
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        [
          "Usage: bun scripts/profile-solvers.ts [--scenario NAME] [--scenario-limit N] [--dataset NAME] [--effort N]",
          "",
          "Options:",
          "  --scenario NAME      Run only the named scenario",
          "  --scenario-limit N   Run only first N scenarios",
          `  --dataset NAME       Dataset to profile: ${DATASET_OPTIONS_LABEL}`,
          "  --effort N           Override scenario effort multiplier",
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

// --- Main ---
const main = async () => {
  const opts = parseArgs()
  const scenarios = await loadScenarios(opts)

  if (scenarios.length === 0) {
    if (opts.scenarioName) {
      throw new Error(`Scenario not found: ${opts.scenarioName}`)
    }
    throw new Error("No scenarios found")
  }

  console.log(
    `Running ${scenarios.length} profile-solver tasks (dataset: ${opts.datasetName})`,
  )

  let solved = 0
  let total = 0
  scenarioCount = scenarios.length

  for (const [scenarioName, scenario] of scenarios) {
    currentScenarioName = scenarioName
    currentScenarioIndex = total + 1
    currentScenarioStartedAt = performance.now()
    lastHeartbeatAt = currentScenarioStartedAt
    total++
    const solver = new AutoroutingPipelineSolver(scenario)

    console.log(
      `[profile-solvers] ${((solved / total) * 100).toFixed(1)}% success (${solved}/${total}) running ${scenarioName}`,
    )

    try {
      solver.solve()
    } catch {}

    if (solver.solved) {
      solved++
      console.log(
        `[profile-solvers] ${((solved / total) * 100).toFixed(1)}% success (${solved}/${total}) solved ${scenarioName} ${formatTime(solver.timeToSolve ?? 0)}`,
      )
    } else {
      console.log(
        `[profile-solvers] ${((solved / total) * 100).toFixed(1)}% success (${solved}/${total}) failed ${scenarioName} ${formatTime(solver.timeToSolve ?? 0)}`,
      )
    }
  }

  const failed = total - solved
  console.log(`\n${solved}/${total} scenarios solved (${failed} failed)\n`)

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

main()
