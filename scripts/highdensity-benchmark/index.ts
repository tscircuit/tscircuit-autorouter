#!/usr/bin/env bun

import { parseArgs } from "node:util"
import { availableParallelism } from "node:os"
import { calculateMse } from "./metrics/calculateMse.ts"
import { runBenchmarkWithWorkers } from "./runBenchmarkWithWorkers/index.ts"
import { formatSeconds } from "./runBenchmarkWithWorkers/shared.ts"
import { NodeWithPortPoints } from "lib/types/high-density-types.ts"

type CliOptions = {
  concurrency: number
  timeoutSeconds: number
}

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`

const usage = () =>
  [
    "Usage: bun scripts/highdensity-benchmark/index.ts [options]",
    "",
    "Options:",
    "  --concurrency        Number of worker threads to use for fresh solver runs",
    "  --timeout-seconds    Kill and fail any single solve that exceeds this limit",
    "  -h, --help           Show this help",
  ].join("\n")

const parseCliArgs = (): CliOptions => {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: false,
    strict: true,
    options: {
      concurrency: {
        type: "string",
      },
      "timeout-seconds": {
        type: "string",
      },
      help: {
        type: "boolean",
        short: "h",
        default: false,
      },
    },
  })

  if (values.help) {
    console.log(usage())
    process.exit(0)
  }

  const requestedConcurrency =
    values.concurrency === undefined
      ? 0
      : Number.parseInt(values.concurrency, 10)
  const timeoutSeconds =
    values["timeout-seconds"] === undefined
      ? 1000
      : Number.parseInt(values["timeout-seconds"], 10)

  if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 0) {
    throw new TypeError("--concurrency must be a non-negative integer")
  }
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new TypeError("--timeout-seconds must be a positive integer")
  }

  const concurrency =
    requestedConcurrency === 0
      ? Math.max(1, availableParallelism() - 1)
      : requestedConcurrency

  return {
    concurrency,
    timeoutSeconds,
  }
}

const main = async ({ concurrency, timeoutSeconds }: CliOptions) => {
  const { hgProblems } = await import("high-density-dataset-z04")
  const problems = hgProblems as unknown as NodeWithPortPoints[]

  const completedScores = await runBenchmarkWithWorkers({
    problems,
    concurrency,
    timeoutMs: timeoutSeconds * 1000,
  })
  const completedCount = completedScores.results.length
  const passRate =
    completedCount === 0 ? 0 : completedScores.passCount / completedCount

  // Avoid a divide-by-zero MSE when every single problem times out.
  if (completedCount === 0) {
    console.log(
      "Total duration:",
      `${formatSeconds(completedScores.totalDurationMs)} seconds`,
    )
    console.log("Completed problems: 0")
    console.log("Pass rate: 0.0% (0/0)")
    console.log(
      "Timed out problems:",
      completedScores.timedOutProblemIds.length,
    )
    console.log("Mean Squared Error: skipped because no problems completed")
    return
  }

  const mse = calculateMse(completedScores.results)
  console.log(
    "Total duration:",
    `${formatSeconds(completedScores.totalDurationMs)} seconds`,
  )
  console.log("Completed problems:", completedCount)
  console.log(
    "Pass rate:",
    `${formatPercent(passRate)} (${completedScores.passCount}/${completedCount})`,
  )
  console.log("Timed out problems:", completedScores.timedOutProblemIds.length)
  console.log("Mean Squared Error:", mse)
}

try {
  await main(parseCliArgs())
} catch (error) {
  if (error instanceof TypeError) {
    console.error(error.message)
    console.error("")
    console.error(usage())
    process.exit(1)
  }
  throw error
}
