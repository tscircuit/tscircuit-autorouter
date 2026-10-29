import { getTraceLintTypes, TRACE_LINT_LABELS } from "./trace-lint-metrics.js"
import { renderBenchmarkStageTimings } from "./renderBenchmarkStageTimings.js"
import { readFile, writeFile } from "node:fs/promises"
import type { BenchmarkReport, WorkerResult } from "./benchmark-types"

type SameMachineBenchmarkInput = {
  baseReport: BenchmarkReport
  prReport: BenchmarkReport
  baseSha: string
  prSha: string
  repository: string
  runnerName: string
  threaded?: {
    threads: number
    baseReport: BenchmarkReport
    prReport: BenchmarkReport
  }
}

const formatTime = (timeMs: number | null): string => {
  if (timeMs === null || !Number.isFinite(timeMs)) return "n/a"
  return timeMs < 1_000
    ? `${Math.round(timeMs)}ms`
    : `${(timeMs / 1_000).toFixed(1)}s`
}

const formatAverage = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? "n/a" : value.toFixed(2)

const formatMemory = (byteCount: number | null | undefined): string => {
  if (byteCount === null || byteCount === undefined) {
    return "n/a"
  }
  const mebibytes = byteCount / (1024 * 1024)
  return `${mebibytes.toFixed(1)} MiB`
}

const parsePercentLabel = (label: string): number | null => {
  const match = label.trim().match(/^(-?\d+(?:\.\d+)?)%/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

const formatSigned = (value: number, suffix = ""): string =>
  `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`

const formatPercentPointDelta = (base: string, pr: string): string => {
  const baseValue = parsePercentLabel(base)
  const prValue = parsePercentLabel(pr)
  if (baseValue === null || prValue === null) return "n/a"
  return formatSigned(prValue - baseValue, " pp")
}

const formatRelativeDelta = (
  baseValue: number | null,
  prValue: number | null,
): string => {
  if (
    baseValue === null ||
    prValue === null ||
    !Number.isFinite(baseValue) ||
    !Number.isFinite(prValue) ||
    baseValue === 0
  ) {
    return "n/a"
  }
  return formatSigned(((prValue - baseValue) / baseValue) * 100, "%")
}

const formatCountDelta = (
  baseValue: number | null,
  prValue: number | null,
): string => {
  if (baseValue === null || prValue === null) return "n/a"
  const delta = prValue - baseValue
  return `${delta > 0 ? "+" : ""}${delta}`
}

const getDrcIssueCount = (
  report: BenchmarkReport,
  solverName: string,
): number | null => {
  const solvedTests = report.tests.filter(
    (test) => test.solverName === solverName && test.didSolve,
  )
  if (solvedTests.length === 0) return null
  let drcIssueCount = 0
  for (const test of solvedTests) {
    if (
      typeof test.drcErrorCount !== "number" ||
      !Number.isInteger(test.drcErrorCount) ||
      test.drcErrorCount < 0
    ) {
      return null
    }
    drcIssueCount += test.drcErrorCount
  }
  return drcIssueCount
}

const getTimePercentile = (
  report: BenchmarkReport,
  solverName: string,
  percentile: number,
): number | null => {
  const elapsedTimes: number[] = []
  for (const result of report.tests) {
    if (result.solverName !== solverName) continue
    // Older reports recorded the timeout as elapsed time for timed-out samples,
    // but did not record the limit for early failures. Do not guess that limit.
    const elapsedTime = result.didSolve
      ? result.elapsedTimeMs
      : (result.sampleTimeoutMs ??
        (result.didTimeout ? result.elapsedTimeMs : undefined))
    if (typeof elapsedTime !== "number" || !Number.isFinite(elapsedTime)) {
      return null
    }
    elapsedTimes.push(elapsedTime)
  }
  if (elapsedTimes.length === 0) return null
  elapsedTimes.sort((a, b) => a - b)

  const index = (elapsedTimes.length - 1) * percentile
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)
  const lowerValue = elapsedTimes[lowerIndex]
  const upperValue = elapsedTimes[upperIndex]
  if (lowerValue === undefined || upperValue === undefined) return null
  return lowerValue + (upperValue - lowerValue) * (index - lowerIndex)
}

const outcomeScore = (test: WorkerResult): number => {
  if (!test.didSolve) return 0
  return test.relaxedDrcPassed ? 2 : 1
}

const outcomeLabel = (test: WorkerResult): string => {
  if (test.didTimeout) return "Timeout"
  if (!test.didSolve) return "Failed"
  return test.relaxedDrcPassed ? "DRC passed" : "Solved (DRC failed)"
}

const testKey = (test: WorkerResult): string =>
  `${test.solverName}::${test.scenarioName}::${test.sampleNumber}`

const formatSolverName = (solverName: string): string =>
  solverName.replace(/^AutoroutingPipelineSolver(\d+).*$/, "Pipeline$1")

const escapeTableCell = (value: unknown): string =>
  String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")

const getChangedOutcomes = (
  baseReport: BenchmarkReport,
  prReport: BenchmarkReport,
) => {
  const baseTests = new Map(
    baseReport.tests.map((test) => [testKey(test), test]),
  )
  return prReport.tests.flatMap((prTest) => {
    const baseTest = baseTests.get(testKey(prTest))
    if (!baseTest || outcomeScore(baseTest) === outcomeScore(prTest)) return []
    return [
      {
        solverName: prTest.solverName,
        sampleNumber: prTest.sampleNumber,
        baseTest,
        prTest,
        delta:
          outcomeScore(prTest) > outcomeScore(baseTest)
            ? "Improved"
            : "Regressed",
      },
    ]
  })
}

export const renderSameMachineBenchmarkResults = ({
  baseReport,
  prReport,
  baseSha,
  prSha,
  repository,
  runnerName,
  threaded,
}: SameMachineBenchmarkInput): string => {
  if (baseReport.datasetName !== prReport.datasetName) {
    throw new Error(
      `Dataset mismatch: base=${baseReport.datasetName}, PR=${prReport.datasetName}`,
    )
  }

  const columns = [
    { label: "Base", report: baseReport },
    { label: "PR", report: prReport },
    ...(threaded
      ? [
          { label: `Base (${threaded.threads}T)`, report: threaded.baseReport },
          { label: `PR (${threaded.threads}T)`, report: threaded.prReport },
        ]
      : []),
  ]
  if (threaded) {
    if (!Number.isSafeInteger(threaded.threads) || threaded.threads < 2) {
      throw new Error("Threaded comparisons require a thread count above one")
    }
    const sampleKeys = new Set(baseReport.tests.map(testKey))
    const solverNames = new Set(baseReport.summary.map((row) => row.solverName))
    for (const [index, { label, report }] of columns.entries()) {
      if (
        report.datasetName !== baseReport.datasetName ||
        report.scenarioCount !== baseReport.scenarioCount ||
        report.effortLabel !== baseReport.effortLabel
      ) {
        throw new Error(`Comparison metadata mismatch for ${label}`)
      }
      if (
        report.tests.length !== sampleKeys.size ||
        new Set(report.tests.map(testKey)).size !== sampleKeys.size ||
        report.tests.some((sample) => !sampleKeys.has(testKey(sample))) ||
        report.summary.length !== solverNames.size ||
        new Set(report.summary.map((row) => row.solverName)).size !==
          solverNames.size ||
        report.summary.some((row) => !solverNames.has(row.solverName))
      ) {
        throw new Error(`Comparison samples or solvers mismatch for ${label}`)
      }
      const expectedThreads = index < 2 ? 1 : threaded.threads
      if (
        report.runtime?.threadsPerSample !== undefined &&
        report.runtime.threadsPerSample !== expectedThreads
      ) {
        throw new Error(`Thread count mismatch for ${label}`)
      }
    }
  }
  const changedOutcomes = getChangedOutcomes(baseReport, prReport)
  const lines = [
    "## Same Machine Benchmark Results",
    "",
    `Both revisions ran sequentially in one Blacksmith job on \`${runnerName}\`.`,
    ...(threaded
      ? [
          `Four independent passes ran in order: Base, PR, Base (${threaded.threads}T), PR (${threaded.threads}T). Base and PR use synchronous inline routing; threaded columns request ${threaded.threads} routing workers per sample.`,
          ...columns.map(
            ({ label, report }) =>
              `${label}: effective configured threads per sample: ${report.runtime?.effectiveThreadsPerSample ?? "unavailable"}; concurrent samples: ${report.runtime?.workerCount ?? "unavailable"}.`,
          ),
        ]
      : []),
    "",
    `Dataset: \`${baseReport.datasetName}\` · Scenarios: ${baseReport.scenarioCount}`,
    `Base: [\`${baseSha.slice(0, 7)}\`](https://github.com/${repository}/commit/${baseSha}) · PR: [\`${prSha.slice(0, 7)}\`](https://github.com/${repository}/commit/${prSha})`,
    "",
    `| Solver | Metric | ${columns.map(({ label }) => label).join(" | ")}${threaded ? "" : " | Delta"} |`,
    `| --- | --- | ${columns.map(() => "---:").join(" | ")}${threaded ? "" : " | ---:"} |`,
  ]

  for (const prSummary of prReport.summary) {
    const solver = formatSolverName(prSummary.solverName)
    const summaries = columns.map(({ report, label }) => {
      const summary = report.summary.find(
        (row) => row.solverName === prSummary.solverName,
      )
      if (!summary) {
        throw new Error(
          `${label} report is missing solver ${prSummary.solverName}`,
        )
      }
      return summary
    })
    const appendRow = (
      metric: string,
      values: string[],
      delta: string,
    ): void => {
      const cells = [solver, metric, ...values]
      if (!threaded) {
        cells.push(delta)
      }
      lines.push(`| ${cells.join(" | ")} |`)
    }
    const completion = summaries.map((row) => row.completedRateLabel)
    const drcPass = summaries.map((row) => row.relaxedDrcRateLabel)
    const drcIssues = columns.map(({ report }) =>
      getDrcIssueCount(report, prSummary.solverName),
    )
    const timeouts = columns.map(
      ({ report }) =>
        report.tests.filter(
          (test) => test.solverName === prSummary.solverName && test.didTimeout,
        ).length,
    )
    appendRow(
      "Completion",
      completion,
      formatPercentPointDelta(completion[0]!, completion[1]!),
    )
    appendRow(
      "Relaxed DRC pass",
      drcPass,
      formatPercentPointDelta(drcPass[0]!, drcPass[1]!),
    )
    appendRow(
      "DRC issues",
      drcIssues.map((value) => String(value ?? "n/a")),
      formatCountDelta(drcIssues[0]!, drcIssues[1]!),
    )
    appendRow(
      "Timeouts",
      timeouts.map(String),
      formatCountDelta(timeouts[0]!, timeouts[1]!),
    )
    for (const percentile of [50, 60, 70, 80, 90, 95]) {
      const times = columns.map(({ report }) =>
        getTimePercentile(report, prSummary.solverName, percentile / 100),
      )
      appendRow(
        `P${percentile} time`,
        times.map(formatTime),
        formatRelativeDelta(times[0]!, times[1]!),
      )
    }
    if (summaries.some((row) => typeof row.p90PeakRssBytes === "number")) {
      for (const percentile of [50, 80, 90] as const) {
        const values = summaries.map(
          (row) => row[`p${percentile}PeakRssBytes`] ?? null,
        )
        appendRow(
          `Memory P${percentile}`,
          values.map(formatMemory),
          formatRelativeDelta(values[0]!, values[1]!),
        )
      }
    }
    const vias = summaries.map((row) => row.avgVia)
    appendRow(
      "Average vias",
      vias.map(formatAverage),
      formatRelativeDelta(vias[0]!, vias[1]!),
    )
    for (const type of getTraceLintTypes(...summaries)) {
      const values = summaries.map(
        (row) => row.avgTraceLintIssues?.[type] ?? null,
      )
      appendRow(
        TRACE_LINT_LABELS[type] ?? `Avg ${type}`,
        values.map(formatAverage),
        formatRelativeDelta(values[0]!, values[1]!),
      )
    }
    if (
      ["Pipeline9_Networked Cold", "Pipeline9_Networked Hot"].includes(
        prSummary.solverName,
      )
    ) {
      const caches = summaries.map((row) => row.networkCache)
      for (const [label, key] of [
        ["HD requests", "remoteRequests"],
        ["HD cache hits", "cacheHits"],
        ["HD solver results", "solverResults"],
        ["HD local fallbacks", "localFallbacks"],
        ["HD validation retries", "validationRejections"],
      ] as const) {
        const values = caches.map((cache) => cache?.[key] ?? null)
        const cells =
          key === "cacheHits"
            ? caches.map((cache) =>
                cache ? `${cache.cacheHits}/${cache.remoteRequests}` : "n/a",
              )
            : values.map((value) => String(value ?? "n/a"))
        appendRow(label, cells, formatCountDelta(values[0]!, values[1]!))
      }
    }
  }

  const improvementCount = changedOutcomes.filter(
    (outcome) => outcome.delta === "Improved",
  ).length
  const regressionCount = changedOutcomes.length - improvementCount
  lines.push(
    "",
    `${threaded ? "Serial outcome changes" : "Outcome changes"}: **${improvementCount} improved**, **${regressionCount} regressed**. DRC issues are totaled across solved samples. Timing percentiles include all samples, with failed and timed-out samples counted at their configured timeout; negative timing deltas are faster. Historical failures without timeout metadata make timing percentiles unavailable.`,
  )

  lines.push(
    "Style errors are averaged per completed sample with recorded lint counts for that type; historical/unlinted results are n/a. Angled traces counts violating segments.",
    ...(prReport.summary.some(
      (summary) =>
        ["Pipeline9_Networked Cold", "Pipeline9_Networked Hot"].includes(
          summary.solverName,
        ) && summary.networkCache,
    )
      ? [
          "HD validation retries are geometry results rejected by the existing client and rerouted locally; their cost remains in timings. Cache hits and solver results count accepted responses.",
        ]
      : []),
    ...columns.flatMap(({ label, report }) =>
      renderBenchmarkStageTimings(report, label),
    ),
  )

  if (changedOutcomes.length > 0) {
    lines.push(
      "",
      "<details>",
      `<summary>Changed outcomes (${changedOutcomes.length})</summary>`,
      "",
      "| Solver | Sample | Base | PR | Base time | PR time | Delta |",
      "| --- | ---: | --- | --- | ---: | ---: | --- |",
      ...changedOutcomes.map(
        ({ solverName, sampleNumber, baseTest, prTest, delta }) =>
          `| ${escapeTableCell(formatSolverName(solverName))} | ${sampleNumber} | ${escapeTableCell(outcomeLabel(baseTest))} | ${escapeTableCell(outcomeLabel(prTest))} | ${formatTime(baseTest.elapsedTimeMs)} | ${formatTime(prTest.elapsedTimeMs)} | ${delta} |`,
      ),
      "",
      "</details>",
    )
  }

  if (threaded) {
    const changes = getChangedOutcomes(threaded.baseReport, threaded.prReport)
    const improved = changes.filter(
      (change) => change.delta === "Improved",
    ).length
    lines.push(
      "",
      `Threaded outcome changes (${threaded.threads}T): **${improved} improved**, **${changes.length - improved} regressed**.`,
    )
    if (changes.length > 0) {
      lines.push(
        "",
        "<details>",
        `<summary>Threaded changed outcomes (${changes.length})</summary>`,
        "",
        `| Solver | Sample | Base (${threaded.threads}T) | PR (${threaded.threads}T) | Base time | PR time | Delta |`,
        "| --- | ---: | --- | --- | ---: | ---: | --- |",
        ...changes.map(
          ({ solverName, sampleNumber, baseTest, prTest, delta }) =>
            `| ${escapeTableCell(formatSolverName(solverName))} | ${sampleNumber} | ${escapeTableCell(outcomeLabel(baseTest))} | ${escapeTableCell(outcomeLabel(prTest))} | ${formatTime(baseTest.elapsedTimeMs)} | ${formatTime(prTest.elapsedTimeMs)} | ${delta} |`,
        ),
        "",
        "</details>",
      )
    }
  }

  return `${lines.join("\n")}\n`
}

const getRequiredArg = (name: string): string => {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value) throw new Error(`Missing required argument ${name}`)
  return value
}

if (import.meta.main) {
  const baseReportPath = getRequiredArg("--base-report")
  const prReportPath = getRequiredArg("--pr-report")
  const outputPath = getRequiredArg("--output")
  const baseReport = JSON.parse(
    await readFile(baseReportPath, "utf8"),
  ) as BenchmarkReport
  const prReport = JSON.parse(
    await readFile(prReportPath, "utf8"),
  ) as BenchmarkReport

  const hasThreadedArgs = [
    "--threads",
    "--base-threaded-report",
    "--pr-threaded-report",
  ].some((name) => process.argv.includes(name))
  const threaded = hasThreadedArgs
    ? {
        threads: Number(getRequiredArg("--threads")),
        baseReport: JSON.parse(
          await readFile(getRequiredArg("--base-threaded-report"), "utf8"),
        ) as BenchmarkReport,
        prReport: JSON.parse(
          await readFile(getRequiredArg("--pr-threaded-report"), "utf8"),
        ) as BenchmarkReport,
      }
    : undefined

  await writeFile(
    outputPath,
    renderSameMachineBenchmarkResults({
      baseReport,
      prReport,
      baseSha: getRequiredArg("--base-sha"),
      prSha: getRequiredArg("--pr-sha"),
      repository: getRequiredArg("--repository"),
      runnerName: getRequiredArg("--runner-name"),
      threaded,
    }),
  )
}
