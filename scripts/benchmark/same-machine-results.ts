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
}: SameMachineBenchmarkInput): string => {
  if (baseReport.datasetName !== prReport.datasetName) {
    throw new Error(
      `Dataset mismatch: base=${baseReport.datasetName}, PR=${prReport.datasetName}`,
    )
  }

  const baseSummaries = new Map(
    baseReport.summary.map((summary) => [summary.solverName, summary]),
  )
  const changedOutcomes = getChangedOutcomes(baseReport, prReport)
  const lines = [
    "## Same Machine Benchmark Results",
    "",
    `Both revisions ran sequentially in one Blacksmith job on \`${runnerName}\`.`,
    "",
    `Dataset: \`${baseReport.datasetName}\` · Scenarios: ${baseReport.scenarioCount}`,
    `Base: [\`${baseSha.slice(0, 7)}\`](https://github.com/${repository}/commit/${baseSha}) · PR: [\`${prSha.slice(0, 7)}\`](https://github.com/${repository}/commit/${prSha})`,
    "",
    "| Solver | Metric | Base | PR | Delta |",
    "| --- | --- | ---: | ---: | ---: |",
  ]

  for (const prSummary of prReport.summary) {
    const baseSummary = baseSummaries.get(prSummary.solverName)
    if (!baseSummary) {
      throw new Error(`Base report is missing solver ${prSummary.solverName}`)
    }
    const solver = formatSolverName(prSummary.solverName)
    const baseTimeouts = baseReport.tests.filter(
      (test) => test.solverName === prSummary.solverName && test.didTimeout,
    ).length
    const prTimeouts = prReport.tests.filter(
      (test) => test.solverName === prSummary.solverName && test.didTimeout,
    ).length
    const baseDrcIssues = getDrcIssueCount(baseReport, prSummary.solverName)
    const prDrcIssues = getDrcIssueCount(prReport, prSummary.solverName)
    const timePercentiles = [50, 60, 70, 80, 90, 95].map((percentile) => {
      const baseTime = getTimePercentile(
        baseReport,
        prSummary.solverName,
        percentile / 100,
      )
      const prTime = getTimePercentile(
        prReport,
        prSummary.solverName,
        percentile / 100,
      )
      return `| ${solver} | P${percentile} time | ${formatTime(baseTime)} | ${formatTime(prTime)} | ${formatRelativeDelta(baseTime, prTime)} |`
    })

    lines.push(
      `| ${solver} | Completion | ${baseSummary.completedRateLabel} | ${prSummary.completedRateLabel} | ${formatPercentPointDelta(baseSummary.completedRateLabel, prSummary.completedRateLabel)} |`,
      `| ${solver} | Relaxed DRC pass | ${baseSummary.relaxedDrcRateLabel} | ${prSummary.relaxedDrcRateLabel} | ${formatPercentPointDelta(baseSummary.relaxedDrcRateLabel, prSummary.relaxedDrcRateLabel)} |`,
      `| ${solver} | DRC issues | ${baseDrcIssues ?? "n/a"} | ${prDrcIssues ?? "n/a"} | ${formatCountDelta(baseDrcIssues, prDrcIssues)} |`,
      `| ${solver} | Timeouts | ${baseTimeouts} | ${prTimeouts} | ${prTimeouts - baseTimeouts > 0 ? "+" : ""}${prTimeouts - baseTimeouts} |`,
      ...timePercentiles,
    )
    if (
      typeof baseSummary.p90PeakRssBytes === "number" ||
      typeof prSummary.p90PeakRssBytes === "number"
    ) {
      lines.push(
        `| ${solver} | P50 peak RSS | ${formatMemory(baseSummary.p50PeakRssBytes)} | ${formatMemory(prSummary.p50PeakRssBytes)} | ${formatRelativeDelta(baseSummary.p50PeakRssBytes ?? null, prSummary.p50PeakRssBytes ?? null)} |`,
        `| ${solver} | P80 peak RSS | ${formatMemory(baseSummary.p80PeakRssBytes)} | ${formatMemory(prSummary.p80PeakRssBytes)} | ${formatRelativeDelta(baseSummary.p80PeakRssBytes ?? null, prSummary.p80PeakRssBytes ?? null)} |`,
        `| ${solver} | P90 peak RSS | ${formatMemory(baseSummary.p90PeakRssBytes)} | ${formatMemory(prSummary.p90PeakRssBytes)} | ${formatRelativeDelta(baseSummary.p90PeakRssBytes ?? null, prSummary.p90PeakRssBytes ?? null)} |`,
      )
    }
    lines.push(
      `| ${solver} | Average vias | ${formatAverage(baseSummary.avgVia)} | ${formatAverage(prSummary.avgVia)} | ${formatRelativeDelta(baseSummary.avgVia, prSummary.avgVia)} |`,
    )
    for (const type of getTraceLintTypes(baseSummary, prSummary)) {
      const baseAverage = baseSummary.avgTraceLintIssues?.[type] ?? null
      const prAverage = prSummary.avgTraceLintIssues?.[type] ?? null
      lines.push(
        `| ${solver} | ${TRACE_LINT_LABELS[type] ?? `Avg ${type}`} | ${formatAverage(baseAverage)} | ${formatAverage(prAverage)} | ${formatRelativeDelta(baseAverage, prAverage)} |`,
      )
    }
  }

  const improvementCount = changedOutcomes.filter(
    (outcome) => outcome.delta === "Improved",
  ).length
  const regressionCount = changedOutcomes.length - improvementCount
  lines.push(
    "",
    `Outcome changes: **${improvementCount} improved**, **${regressionCount} regressed**. DRC issues are totaled across solved samples. Timing percentiles include all samples, with failed and timed-out samples counted at their configured timeout; negative timing deltas are faster. Historical failures without timeout metadata make timing percentiles unavailable.`,
  )

  lines.push(
    "Style errors are averaged per completed sample with recorded lint counts for that type; historical/unlinted results are n/a. Angled traces counts violating segments.",
    ...renderBenchmarkStageTimings(baseReport, "Base"),
    ...renderBenchmarkStageTimings(prReport, "PR"),
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

  await writeFile(
    outputPath,
    renderSameMachineBenchmarkResults({
      baseReport,
      prReport,
      baseSha: getRequiredArg("--base-sha"),
      prSha: getRequiredArg("--pr-sha"),
      repository: getRequiredArg("--repository"),
      runnerName: getRequiredArg("--runner-name"),
    }),
  )
}
