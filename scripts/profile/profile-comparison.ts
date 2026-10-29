#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises"

type PipelineStageTiming = {
  solverName: string
  timeMs: number
}

type CompletedProfileScenario = {
  scenarioName: string
  elapsedTimeMs: number
  stageTimings: PipelineStageTiming[]
}

type ProfileReport = {
  datasetName: string
  scenarioCount: number
  solved: number
  failed: number
  completedScenarios: CompletedProfileScenario[]
}

type ProfileComparisonInput = {
  mainReport: ProfileReport
  prReport: ProfileReport
  mainSha: string
  prSha: string
  repository: string
  runnerName: string
}

const MINIMUM_DISPLAY_PERCENT = 4
const PERCENTILES = [50, 80, 95] as const

const getPercentile = (values: number[], percentile: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower] ?? 0
  const lowerValue = sorted[lower] ?? 0
  const upperValue = sorted[upper] ?? 0
  return lowerValue + (upperValue - lowerValue) * (index - lower)
}

const getStagePercentiles = (
  report: ProfileReport,
  solverName: string,
  includedScenarioNames: Set<string>,
): Record<(typeof PERCENTILES)[number], number> => {
  const percentages = report.completedScenarios
    .filter((scenario) => includedScenarioNames.has(scenario.scenarioName))
    .map((scenario) => {
      const totalTimeMs = scenario.stageTimings.reduce(
        (sum, stage) => sum + stage.timeMs,
        0,
      )
      const stageTimeMs =
        scenario.stageTimings.find((stage) => stage.solverName === solverName)
          ?.timeMs ?? 0
      return totalTimeMs === 0 ? 0 : (stageTimeMs / totalTimeMs) * 100
    })

  return Object.fromEntries(
    PERCENTILES.map((percentile) => [
      percentile,
      getPercentile(percentages, percentile / 100),
    ]),
  ) as Record<(typeof PERCENTILES)[number], number>
}

const formatPercent = (value: number): string => `${value.toFixed(1)}%`

export const renderProfileComparison = ({
  mainReport,
  prReport,
  mainSha,
  prSha,
  repository,
  runnerName,
}: ProfileComparisonInput): string => {
  if (mainReport.datasetName !== prReport.datasetName) {
    throw new Error(
      `Dataset mismatch: main=${mainReport.datasetName}, PR=${prReport.datasetName}`,
    )
  }

  const prCompletedScenarioNames = new Set(
    prReport.completedScenarios.map((scenario) => scenario.scenarioName),
  )
  const commonCompletedScenarioNames = new Set(
    mainReport.completedScenarios
      .map((scenario) => scenario.scenarioName)
      .filter((scenarioName) => prCompletedScenarioNames.has(scenarioName)),
  )
  if (commonCompletedScenarioNames.size === 0) {
    throw new Error("Main and PR have no commonly completed profile problems")
  }

  const solverNames = [
    ...new Set(
      [mainReport, prReport].flatMap((report) =>
        report.completedScenarios.flatMap((scenario) =>
          scenario.stageTimings.map((stage) => stage.solverName),
        ),
      ),
    ),
  ]
  const rows = solverNames
    .map((solverName) => ({
      solverName,
      main: getStagePercentiles(
        mainReport,
        solverName,
        commonCompletedScenarioNames,
      ),
      pr: getStagePercentiles(
        prReport,
        solverName,
        commonCompletedScenarioNames,
      ),
    }))
    .filter((row) =>
      PERCENTILES.some(
        (percentile) =>
          Math.max(row.main[percentile], row.pr[percentile]) >
          MINIMUM_DISPLAY_PERCENT,
      ),
    )
    .sort(
      (a, b) =>
        Math.max(b.main[50], b.pr[50]) - Math.max(a.main[50], a.pr[50]) ||
        Math.max(b.main[95], b.pr[95]) - Math.max(a.main[95], a.pr[95]) ||
        a.solverName.localeCompare(b.solverName),
    )

  return [
    "## Pipeline 7 Profile Comparison",
    "",
    `Main and PR ran sequentially in one Blacksmith job on \`${runnerName}\`.`,
    "",
    `Dataset: \`${mainReport.datasetName}\` · Completed: main ${mainReport.solved}/${mainReport.scenarioCount}, PR ${prReport.solved}/${prReport.scenarioCount}`,
    `Percentile population: ${commonCompletedScenarioNames.size} problems completed by both revisions.`,
    `Main: [\`${mainSha.slice(0, 7)}\`](https://github.com/${repository}/commit/${mainSha}) · PR: [\`${prSha.slice(0, 7)}\`](https://github.com/${repository}/commit/${prSha})`,
    "",
    "Only direct Pipeline 7 stages exceeding 4% at P50, P80, or P95 on either revision are shown.",
    "",
    "| Pipeline 7 solver | Main P50 | PR P50 | Main P80 | PR P80 | Main P95 | PR P95 |",
    "| :--- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.solverName} | ${formatPercent(row.main[50])} | ${formatPercent(row.pr[50])} | ${formatPercent(row.main[80])} | ${formatPercent(row.pr[80])} | ${formatPercent(row.main[95])} | ${formatPercent(row.pr[95])} |`,
    ),
    "",
    "Each percentile is calculated independently from per-problem stage shares, so columns do not sum to 100%.",
    "",
  ].join("\n")
}

const getRequiredArg = (name: string): string => {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value) throw new Error(`Missing required argument ${name}`)
  return value
}

if (import.meta.main) {
  const mainReport = JSON.parse(
    await readFile(getRequiredArg("--main-report"), "utf8"),
  ) as ProfileReport
  const prReport = JSON.parse(
    await readFile(getRequiredArg("--pr-report"), "utf8"),
  ) as ProfileReport

  await writeFile(
    getRequiredArg("--output"),
    renderProfileComparison({
      mainReport,
      prReport,
      mainSha: getRequiredArg("--main-sha"),
      prSha: getRequiredArg("--pr-sha"),
      repository: getRequiredArg("--repository"),
      runnerName: getRequiredArg("--runner-name"),
    }),
  )
}
