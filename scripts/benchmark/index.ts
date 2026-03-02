#!/usr/bin/env bun

import { readFile } from "node:fs/promises"
import path from "node:path"
import * as dataset from "@tscircuit/autorouting-dataset-01"
import type { SimpleRouteJson } from "../../lib/types/srj-types"

type SolverRunResult = {
  solverName: string
  successRatePercent: number
  relaxedDrcRatePercent: number
  p50TimeMs: number | null
  p95TimeMs: number | null
}

type WorkerResult = {
  scenarioName: string
  elapsedTimeMs: number
  didSolve: boolean
  relaxedDrcPassed: boolean
  error?: string
}

type BenchmarkOptions = {
  solverName?: string
  scenarioLimit?: number
  concurrency: number
}

const formatTime = (timeMs: number | null) => {
  if (timeMs === null) {
    return "n/a"
  }
  return `${(timeMs / 1000).toFixed(1)}s`
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

const parseArgs = (): BenchmarkOptions => {
  const args = process.argv.slice(2)
  const options: BenchmarkOptions = { concurrency: 4 }

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
      options.concurrency = Number.parseInt(args[i + 1], 10)
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

  return options
}

const loadSolverNames = async (): Promise<string[]> => {
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

  return pipelineNames.map((name) => {
    const aliasMatch = libIndex.match(new RegExp(`${name}\\s+as\\s+(\\w+)`))
    return aliasMatch ? aliasMatch[1] : name
  })
}

const loadScenarios = (scenarioLimit?: number) => {
  const allScenarios = Object.entries(dataset)
    .filter(([, value]) => Boolean(value) && typeof value === "object")
    .sort(([a], [b]) => a.localeCompare(b)) as Array<[string, SimpleRouteJson]>

  return scenarioLimit ? allScenarios.slice(0, scenarioLimit) : allScenarios
}

const formatTable = (rows: SolverRunResult[]) => {
  const headers = [
    "Solver",
    "Completed %",
    "Relaxed DRC Pass %",
    "P50 Time",
    "P95 Time",
  ]

  const body = rows.map((row) => [
    row.solverName,
    `${row.successRatePercent.toFixed(1)}%`,
    `${row.relaxedDrcRatePercent.toFixed(1)}%`,
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

const runSolverWithWorkers = async (
  solverName: string,
  scenarios: Array<[string, SimpleRouteJson]>,
  concurrency: number,
) => {
  const workerCount = Math.min(concurrency, scenarios.length)
  const workers = Array.from(
    { length: workerCount },
    () =>
      new Worker(new URL("./benchmark.worker.ts", import.meta.url), {
        type: "module",
      }),
  )

  const results = new Array<WorkerResult>(scenarios.length)
  let nextScenarioIndex = 0
  let completed = 0
  let solvedCount = 0

  const assignWork = (worker: Worker): Promise<void> => {
    return new Promise((resolve) => {
      const sendNext = () => {
        if (nextScenarioIndex >= scenarios.length) {
          resolve()
          return
        }

        const scenarioIndex = nextScenarioIndex
        nextScenarioIndex += 1
        const [scenarioName, scenario] = scenarios[scenarioIndex]

        const onMessage = (event: MessageEvent<WorkerResult>) => {
          worker.removeEventListener("message", onMessage)
          const result = event.data
          results[scenarioIndex] = result
          completed += 1
          if (result.didSolve) {
            solvedCount += 1
          }

          const status = result.didSolve ? "solved" : "failed"
          const successRate = (solvedCount / completed) * 100
          const suffix = result.error ? ` (${result.error})` : ""
          console.log(
            `[${solverName}] ${successRate.toFixed(1)}% success (${solvedCount}/${completed}) ${status} ${result.scenarioName} ${formatTime(result.elapsedTimeMs)}${suffix}`,
          )

          sendNext()
        }

        worker.addEventListener("message", onMessage)
        worker.postMessage({
          solverName,
          scenarioName,
          scenario,
        })
      }

      sendNext()
    })
  }

  try {
    await Promise.all(workers.map((worker) => assignWork(worker)))
  } finally {
    for (const worker of workers) {
      worker.terminate()
    }
  }

  const succeeded = results.filter((result) => result.didSolve)
  const elapsedForSucceeded = succeeded.map((result) => result.elapsedTimeMs)
  const relaxedDrcPassed = succeeded.filter(
    (result) => result.relaxedDrcPassed,
  ).length

  return {
    solverName,
    successRatePercent: (succeeded.length / scenarios.length) * 100,
    relaxedDrcRatePercent: (relaxedDrcPassed / scenarios.length) * 100,
    p50TimeMs: getPercentileMs(elapsedForSucceeded, 0.5),
    p95TimeMs: getPercentileMs(elapsedForSucceeded, 0.95),
  } satisfies SolverRunResult
}

const main = async () => {
  const { solverName, scenarioLimit, concurrency } = parseArgs()
  const availableSolvers = await loadSolverNames()
  const solvers = solverName ? [solverName] : availableSolvers

  if (solverName && !availableSolvers.includes(solverName)) {
    throw new Error(
      `Unknown solver \"${solverName}\". Available: ${availableSolvers.join(", ")}`,
    )
  }

  const scenarios = loadScenarios(scenarioLimit)
  if (scenarios.length === 0) {
    throw new Error("No benchmark scenarios found")
  }

  const rows: SolverRunResult[] = []

  for (const solver of solvers) {
    console.log(`\n=== Benchmarking ${solver} ===`)
    const row = await runSolverWithWorkers(solver, scenarios, concurrency)
    rows.push(row)
  }

  const table = formatTable(rows)
  const output = `${table}\n\nScenarios: ${scenarios.length}\n`
  await Bun.write("benchmark-result.txt", output)

  console.log(`\n${table}`)
  console.log(`\nScenarios: ${scenarios.length}`)
  console.log("Results written to benchmark-result.txt")
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Benchmark failed: ${message}`)
  process.exit(1)
})
