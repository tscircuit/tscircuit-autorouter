import { readFile, writeFile } from "node:fs/promises"
import type { BenchmarkReport, WorkerResult } from "./benchmark-types"

type SameMachineBenchmarkInput = {
  mainReport: BenchmarkReport
  prReport: BenchmarkReport
  mainSha: string
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

const parsePercentLabel = (label: string): number | null => {
  const match = label.trim().match(/^(-?\d+(?:\.\d+)?)%/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

const formatSigned = (value: number, suffix = ""): string =>
  `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`

const formatPercentPointDelta = (main: string, pr: string): string => {
  const mainValue = parsePercentLabel(main)
  const prValue = parsePercentLabel(pr)
  if (mainValue === null || prValue === null) return "n/a"
  return formatSigned(prValue - mainValue, " pp")
}

const formatRelativeDelta = (
  mainValue: number | null,
  prValue: number | null,
): string => {
  if (
    mainValue === null ||
    prValue === null ||
    !Number.isFinite(mainValue) ||
    !Number.isFinite(prValue) ||
    mainValue === 0
  ) {
    return "n/a"
  }
  return formatSigned(((prValue - mainValue) / mainValue) * 100, "%")
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
  mainReport: BenchmarkReport,
  prReport: BenchmarkReport,
) => {
  const mainTests = new Map(
    mainReport.tests.map((test) => [testKey(test), test]),
  )
  return prReport.tests.flatMap((prTest) => {
    const mainTest = mainTests.get(testKey(prTest))
    if (!mainTest || outcomeScore(mainTest) === outcomeScore(prTest)) return []
    return [
      {
        solverName: prTest.solverName,
        sampleNumber: prTest.sampleNumber,
        mainTest,
        prTest,
        delta:
          outcomeScore(prTest) > outcomeScore(mainTest)
            ? "Improved"
            : "Regressed",
      },
    ]
  })
}

export const renderSameMachineBenchmarkResults = ({
  mainReport,
  prReport,
  mainSha,
  prSha,
  repository,
  runnerName,
}: SameMachineBenchmarkInput): string => {
  if (mainReport.datasetName !== prReport.datasetName) {
    throw new Error(
      `Dataset mismatch: main=${mainReport.datasetName}, PR=${prReport.datasetName}`,
    )
  }

  const mainSummaries = new Map(
    mainReport.summary.map((summary) => [summary.solverName, summary]),
  )
  const changedOutcomes = getChangedOutcomes(mainReport, prReport)
  const lines = [
    "## Same Machine Benchmark Results",
    "",
    `Both revisions ran sequentially in one Blacksmith job on \`${runnerName}\`.`,
    "",
    `Dataset: \`${mainReport.datasetName}\` · Scenarios: ${mainReport.scenarioCount}`,
    `Main: [\`${mainSha.slice(0, 7)}\`](https://github.com/${repository}/commit/${mainSha}) · PR: [\`${prSha.slice(0, 7)}\`](https://github.com/${repository}/commit/${prSha})`,
    "",
    "| Solver | Metric | Main | PR | Delta |",
    "| --- | --- | ---: | ---: | ---: |",
  ]

  for (const prSummary of prReport.summary) {
    const mainSummary = mainSummaries.get(prSummary.solverName)
    if (!mainSummary) {
      throw new Error(`Main report is missing solver ${prSummary.solverName}`)
    }
    const solver = formatSolverName(prSummary.solverName)
    const mainTimeouts = mainReport.tests.filter(
      (test) => test.solverName === prSummary.solverName && test.didTimeout,
    ).length
    const prTimeouts = prReport.tests.filter(
      (test) => test.solverName === prSummary.solverName && test.didTimeout,
    ).length

    lines.push(
      `| ${solver} | Completion | ${mainSummary.completedRateLabel} | ${prSummary.completedRateLabel} | ${formatPercentPointDelta(mainSummary.completedRateLabel, prSummary.completedRateLabel)} |`,
      `| ${solver} | Relaxed DRC pass | ${mainSummary.relaxedDrcRateLabel} | ${prSummary.relaxedDrcRateLabel} | ${formatPercentPointDelta(mainSummary.relaxedDrcRateLabel, prSummary.relaxedDrcRateLabel)} |`,
      `| ${solver} | Timeouts | ${mainTimeouts} | ${prTimeouts} | ${prTimeouts - mainTimeouts > 0 ? "+" : ""}${prTimeouts - mainTimeouts} |`,
      `| ${solver} | P50 time | ${formatTime(mainSummary.p50TimeMs)} | ${formatTime(prSummary.p50TimeMs)} | ${formatRelativeDelta(mainSummary.p50TimeMs, prSummary.p50TimeMs)} |`,
      `| ${solver} | P95 time | ${formatTime(mainSummary.p95TimeMs)} | ${formatTime(prSummary.p95TimeMs)} | ${formatRelativeDelta(mainSummary.p95TimeMs, prSummary.p95TimeMs)} |`,
      `| ${solver} | Average vias | ${formatAverage(mainSummary.avgVia)} | ${formatAverage(prSummary.avgVia)} | ${formatRelativeDelta(mainSummary.avgVia, prSummary.avgVia)} |`,
    )
  }

  const improvementCount = changedOutcomes.filter(
    (outcome) => outcome.delta === "Improved",
  ).length
  const regressionCount = changedOutcomes.length - improvementCount
  lines.push(
    "",
    `Outcome changes: **${improvementCount} improved**, **${regressionCount} regressed**. Negative timing deltas are faster.`,
  )

  if (changedOutcomes.length > 0) {
    lines.push(
      "",
      "<details>",
      `<summary>Changed outcomes (${changedOutcomes.length})</summary>`,
      "",
      "| Solver | Sample | Main | PR | Main time | PR time | Delta |",
      "| --- | ---: | --- | --- | ---: | ---: | --- |",
      ...changedOutcomes.map(
        ({ solverName, sampleNumber, mainTest, prTest, delta }) =>
          `| ${escapeTableCell(formatSolverName(solverName))} | ${sampleNumber} | ${escapeTableCell(outcomeLabel(mainTest))} | ${escapeTableCell(outcomeLabel(prTest))} | ${formatTime(mainTest.elapsedTimeMs)} | ${formatTime(prTest.elapsedTimeMs)} | ${delta} |`,
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
  const mainReportPath = getRequiredArg("--main-report")
  const prReportPath = getRequiredArg("--pr-report")
  const outputPath = getRequiredArg("--output")
  const mainReport = JSON.parse(
    await readFile(mainReportPath, "utf8"),
  ) as BenchmarkReport
  const prReport = JSON.parse(
    await readFile(prReportPath, "utf8"),
  ) as BenchmarkReport

  await writeFile(
    outputPath,
    renderSameMachineBenchmarkResults({
      mainReport,
      prReport,
      mainSha: getRequiredArg("--main-sha"),
      prSha: getRequiredArg("--pr-sha"),
      repository: getRequiredArg("--repository"),
      runnerName: getRequiredArg("--runner-name"),
    }),
  )
}
