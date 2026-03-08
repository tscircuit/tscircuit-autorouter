#!/usr/bin/env bun

import { parseArgs } from "node:util"
import { FAIL_AT_OR_ABOVE, PASS_AT_OR_BELOW } from "./config/benchmarkPolicy.ts"
import { evaluatePredictions } from "./evaluation/evaluatePredictions.ts"
import { calculateExtremeBandMetrics } from "./metrics/calculateExtremeBandMetrics.ts"
import { calculateMse } from "./metrics/calculateMse.ts"
import { loadCachedResults } from "./results/loadCachedResults.ts"
import { runCurrentSolver } from "./runtime/runCurrentSolver.ts"

type CliOptions = {
  concurrency: number
  run: boolean
  timeoutSeconds: number
}

const usage = () =>
  [
    "Usage: bun scripts/highdensity-benchmark/index.ts [options]",
    "",
    "Options:",
    "  --run                Generate fresh benchmark results with the current solver",
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
      run: {
        type: "boolean",
        default: false,
      },
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

  const concurrency =
    values.concurrency === undefined
      ? 0
      : Number.parseInt(values.concurrency, 10)
  const timeoutSeconds =
    values["timeout-seconds"] === undefined
      ? 1000
      : Number.parseInt(values["timeout-seconds"], 10)

  if (!Number.isInteger(concurrency) || concurrency < 0) {
    throw new TypeError("--concurrency must be a non-negative integer")
  }
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new TypeError("--timeout-seconds must be a positive integer")
  }

  return {
    concurrency,
    run: values.run ?? false,
    timeoutSeconds,
  }
}

const main = async ({ run, concurrency, timeoutSeconds }: CliOptions) => {
  // Use either cached benchmark outputs or fresh solver runs as the ground truth set.
  const results = run
    ? await runCurrentSolver({ concurrency, timeoutSeconds })
    : await loadCachedResults()
  const evaluationRows = await evaluatePredictions(results)
  const mse = calculateMse(evaluationRows)
  const extremeBandMetrics = calculateExtremeBandMetrics(evaluationRows, {
    passAtOrBelow: PASS_AT_OR_BELOW,
    failAtOrAbove: FAIL_AT_OR_ABOVE,
  })

  console.log(
    JSON.stringify(
      {
        mse: Number(mse.toFixed(8)),
        policy: extremeBandMetrics.policy,
        totalEvaluated: extremeBandMetrics.totalEvaluated,
        coverage: extremeBandMetrics.coverage,
        outcomes: extremeBandMetrics.outcomes,
        passPrecision: Number(extremeBandMetrics.pass.precision.toFixed(8)),
        passRecall: Number(extremeBandMetrics.pass.recall.toFixed(8)),
        failPrecision: Number(extremeBandMetrics.fail.precision.toFixed(8)),
        failRecall: Number(extremeBandMetrics.fail.recall.toFixed(8)),
      },
      null,
      2,
    ),
  )
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
