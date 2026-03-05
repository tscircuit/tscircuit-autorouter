#!/usr/bin/env bun

import * as dataset from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver } from "../lib"
import { BaseSolver } from "../lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "../lib/types/srj-types"

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
  scenarioLimit?: number
}

// --- Global profiling state ---
let currentScenarioName = ""
const allRecords: SolverRecord[] = []

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
  const options: ProfileOptions = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--scenario-limit") {
      options.scenarioLimit = Number.parseInt(args[i + 1], 10)
      i += 1
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        [
          "Usage: bun scripts/profile-solvers.ts [--scenario-limit N]",
          "",
          "Options:",
          "  --scenario-limit N   Run only first N scenarios",
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

  return options
}

const loadScenarios = (scenarioLimit?: number) => {
  const allScenarios = Object.entries(dataset)
    .filter(([, value]) => Boolean(value) && typeof value === "object")
    .sort(([a], [b]) => a.localeCompare(b)) as Array<[string, SimpleRouteJson]>

  return scenarioLimit ? allScenarios.slice(0, scenarioLimit) : allScenarios
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
  if (ms < 1000) return `${ms.toFixed(0)}ms`
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
const main = () => {
  const opts = parseArgs()
  const scenarios = loadScenarios(opts.scenarioLimit)

  if (scenarios.length === 0) {
    throw new Error("No scenarios found")
  }

  console.log(
    `Profiling ${scenarios.length} scenarios with AutoroutingPipelineSolver...\n`,
  )

  let solved = 0
  let total = 0

  for (const [scenarioName, scenario] of scenarios) {
    currentScenarioName = scenarioName
    total++
    const solver = new AutoroutingPipelineSolver(scenario)

    try {
      solver.solve()
    } catch {}

    if (solver.solved) {
      solved++
      console.log(
        `  [OK]   ${scenarioName} ${formatTime(solver.timeToSolve ?? 0)}`,
      )
    } else {
      console.log(
        `  [FAIL] ${scenarioName} ${formatTime(solver.timeToSolve ?? 0)}`,
      )
    }
  }

  const failed = total - solved
  console.log(`\n${solved}/${total} scenarios solved (${failed} failed)\n`)

  // --- Aggregate by solver name + success/fail ---
  // Skip the top-level pipeline solver itself
  const records = allRecords.filter(
    (r) => r.name !== "AutoroutingPipelineSolver2_PortPointPathing",
  )

  const groups = new Map<string, SolverRecord[]>()
  for (const record of records) {
    const key = `${record.name}|${record.success ? "success" : "fail"}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(record)
  }

  type Row = {
    name: string
    status: string
    count: number
    maxIter: number
    p50Time: number | null
    p95Time: number | null
    p99Time: number | null
    p50Iter: number | null
    p95Iter: number | null
    p99Iter: number | null
  }

  const rows: Row[] = []
  for (const [key, recs] of groups) {
    const [name, status] = key.split("|")
    const times = recs.map((r) => r.timeMs)
    const iters = recs.map((r) => r.iterations)
    const maxIter = Math.round(Math.max(...recs.map((r) => r.maxIterations)))
    rows.push({
      name: name!,
      status: status!,
      count: recs.length,
      maxIter,
      p50Time: getPercentile(times, 0.5),
      p95Time: getPercentile(times, 0.95),
      p99Time: getPercentile(times, 0.99),
      p50Iter: getPercentile(iters, 0.5),
      p95Iter: getPercentile(iters, 0.95),
      p99Iter: getPercentile(iters, 0.99),
    })
  }

  // Sort by P95 time (slowest first), then solver name, then success before fail
  rows.sort((a, b) => {
    const aP95 = a.p95Time ?? Number.NEGATIVE_INFINITY
    const bP95 = b.p95Time ?? Number.NEGATIVE_INFINITY
    if (aP95 !== bP95) return bP95 - aP95
    if (a.name !== b.name) return a.name.localeCompare(b.name)
    return a.status === "success" ? -1 : 1
  })

  const headers = [
    "Solver",
    "Status",
    "N",
    "MAX_ITER",
    "P50 Time",
    "P50 Iters",
    "P95 Time",
    "P95 Iters",
    "P99 Time",
    "P99 Iters",
  ]

  const body = rows.map((r) => [
    r.name,
    r.status,
    String(r.count),
    String(r.maxIter),
    formatTime(r.p50Time),
    formatIter(r.p50Iter),
    formatTime(r.p95Time),
    formatIter(r.p95Iter),
    formatTime(r.p99Time),
    formatIter(r.p99Iter),
  ])

  const table = formatTable(headers, body)
  console.log(table)
  console.log()
}

main()
