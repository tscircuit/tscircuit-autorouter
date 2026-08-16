#!/usr/bin/env bun

import { existsSync } from "node:fs"
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"
import stableStringify from "fast-json-stable-stringify"
import type { BenchmarkStageTimingBreakdown } from "./benchmark-types"

// Older benchmark artifacts predate avgVia, sampleNumber, and stageTiming. The
// parser accepts those omissions, then normalizes them for dashboard data.
type BenchmarkHistorySummary = {
  [key: string]: unknown
  solverName: string
  completedRateLabel: string
  relaxedDrcRateLabel: string
  timedOutLabel: string
  p50TimeMs: number | null
  p95TimeMs: number | null
  avgVia?: number | null
}

type BenchmarkHistorySample = {
  [key: string]: unknown
  solverName: string
  scenarioName: string
  sampleNumber?: number
  elapsedTimeMs: number
  didSolve: boolean
  didTimeout: boolean
  relaxedDrcPassed: boolean
  viaCount?: number
  errorPhaseName?: string
  error?: string
  stageTiming?: BenchmarkStageTimingBreakdown
}

type BenchmarkHistoryReport = {
  [key: string]: unknown
  version: 1
  datasetName: string
  scenarioCount: number
  effortLabel: string
  summary: BenchmarkHistorySummary[]
  tests: BenchmarkHistorySample[]
}

export type BenchmarkReportCollection = {
  version: 2
  kind: "benchmark-report-collection"
  generatedFor: "main"
  reports: BenchmarkHistoryReport[]
}

type BenchmarkRunMetadata = {
  workflowRunId: string
  workflowRunAttempt: number
  commitSha: string
  createdAt: string
  runner: {
    name: string
  }
  raw: Record<string, unknown>
}

export type BenchmarkHistoryRun = {
  version: 1
  runId: string
  workflowRunId: string
  workflowRunAttempt: number
  runUrl: string
  commitSha: string
  createdAt: string
  runner: string
  metadata: Record<string, unknown>
  report: BenchmarkHistoryReport | BenchmarkReportCollection
}

export type BenchmarkHistoryIndex = {
  version: 1
  runs: Array<{
    runId: string
    createdAt: string
    path: string
  }>
}

type DashboardPoint = {
  runId: string
  runUrl: string
  createdAt: string
  datasetName: string
  solverName: string
  effortLabel: string
  completedRate: number | null
  relaxedDrcRate: number | null
  p50TimeMs: number | null
  p90TimeMs: number | null
  p95TimeMs: number | null
  maxTimeMs: number | null
  avgVia: number | null
  medianVia: number | null
  maxVia: number | null
  samples: Array<BenchmarkHistorySample & { sampleNumber: number }>
}

type RenderCommand = {
  command: "render"
  historyDirectory: string
  outputDirectory: string
}

type RecordCommand = {
  command: "record"
  historyDirectory: string
  outputDirectory: string
  publishedHistoryDirectory?: string
  reportPath: string
  metadataPath: string
  runUrl: string
}

type BenchmarkHistoryCommand = RenderCommand | RecordCommand

const HISTORY_INDEX_NAME = "index.json"
const HISTORY_RUNS_DIRECTORY = "runs"
const DASHBOARD_RUN_LIMIT = 100

const getPercentile = (values: number[], percentile: number): number | null => {
  if (values.length === 0) return null
  const sortedValues = [...values].sort((a, b) => a - b)
  const index = (sortedValues.length - 1) * percentile
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)
  const lowerValue = sortedValues[lowerIndex]
  const upperValue = sortedValues[upperIndex]
  if (lowerValue === undefined || upperValue === undefined) {
    throw new Error(`Could not calculate percentile ${percentile}`)
  }
  return lowerValue + (upperValue - lowerValue) * (index - lowerIndex)
}

const parseRateLabelOrThrow = ({
  label,
  context,
}: {
  label: string
  context: string
}): number | null => {
  const trimmedLabel = label.trim()
  if (trimmedLabel === "n/a") return null
  const match = /^(\d+(?:\.\d+)?)%(?: \([^)]*\))?$/.exec(trimmedLabel)
  if (!match) throw new Error(`Malformed ${context} rate label: "${label}"`)
  const rate = Number.parseFloat(match[1])
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error(`${context} rate label is out of range: "${label}"`)
  }
  return rate
}

const parseMetricOrThrow = (
  value: unknown,
  metricName: string,
  sourceLabel: string,
): number | null => {
  if (value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${metricName} in ${sourceLabel}`)
  }
  return value
}

const parseBenchmarkSummaryOrThrow = (
  value: unknown,
  sourceLabel: string,
): BenchmarkHistorySummary => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid benchmark summary in ${sourceLabel}`)
  }
  if (
    !("solverName" in value) ||
    typeof value.solverName !== "string" ||
    value.solverName.trim() === "" ||
    !("completedRateLabel" in value) ||
    typeof value.completedRateLabel !== "string" ||
    !("relaxedDrcRateLabel" in value) ||
    typeof value.relaxedDrcRateLabel !== "string" ||
    !("timedOutLabel" in value) ||
    typeof value.timedOutLabel !== "string"
  ) {
    throw new Error(`Invalid benchmark summary labels in ${sourceLabel}`)
  }
  if (!("p50TimeMs" in value) || !("p95TimeMs" in value)) {
    throw new Error(`Missing benchmark timing summary in ${sourceLabel}`)
  }
  const p50TimeMs = parseMetricOrThrow(
    value.p50TimeMs,
    "p50TimeMs",
    sourceLabel,
  )
  const p95TimeMs = parseMetricOrThrow(
    value.p95TimeMs,
    "p95TimeMs",
    sourceLabel,
  )
  const avgVia =
    "avgVia" in value
      ? parseMetricOrThrow(value.avgVia, "avgVia", sourceLabel)
      : undefined
  return {
    ...value,
    solverName: value.solverName,
    completedRateLabel: value.completedRateLabel,
    relaxedDrcRateLabel: value.relaxedDrcRateLabel,
    timedOutLabel: value.timedOutLabel,
    p50TimeMs,
    p95TimeMs,
    avgVia,
  }
}

const parseBenchmarkStageTimingOrThrow = (
  value: unknown,
  expectedStatus: BenchmarkStageTimingBreakdown["status"],
  sourceLabel: string,
): BenchmarkStageTimingBreakdown => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("status" in value) ||
    (value.status !== "complete" && value.status !== "partial") ||
    !("stages" in value) ||
    !Array.isArray(value.stages)
  ) {
    throw new Error(`Invalid stageTiming in ${sourceLabel}`)
  }
  if (value.status !== expectedStatus) {
    throw new Error(`Inconsistent stageTiming status in ${sourceLabel}`)
  }
  const stageNames = new Set<string>()
  const stages = value.stages.map((stage, index) => {
    if (
      typeof stage !== "object" ||
      stage === null ||
      Array.isArray(stage) ||
      !("stageName" in stage) ||
      typeof stage.stageName !== "string" ||
      stage.stageName.trim() === "" ||
      !("elapsedTimeMs" in stage) ||
      typeof stage.elapsedTimeMs !== "number" ||
      !Number.isFinite(stage.elapsedTimeMs) ||
      stage.elapsedTimeMs < 0
    ) {
      throw new Error(`Invalid stageTiming stage ${index} in ${sourceLabel}`)
    }
    if (stageNames.has(stage.stageName)) {
      throw new Error(
        `Duplicate stageTiming stage ${stage.stageName} in ${sourceLabel}`,
      )
    }
    stageNames.add(stage.stageName)
    return {
      stageName: stage.stageName,
      elapsedTimeMs: stage.elapsedTimeMs,
    }
  })
  return { status: expectedStatus, stages }
}

const parseBenchmarkSampleOrThrow = (
  value: unknown,
  sourceLabel: string,
): BenchmarkHistorySample => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid benchmark sample in ${sourceLabel}`)
  }
  if (
    !("solverName" in value) ||
    typeof value.solverName !== "string" ||
    value.solverName.trim() === "" ||
    !("scenarioName" in value) ||
    typeof value.scenarioName !== "string" ||
    value.scenarioName.trim() === "" ||
    !("elapsedTimeMs" in value) ||
    typeof value.elapsedTimeMs !== "number" ||
    !Number.isFinite(value.elapsedTimeMs) ||
    value.elapsedTimeMs < 0 ||
    !("didSolve" in value) ||
    typeof value.didSolve !== "boolean" ||
    !("didTimeout" in value) ||
    typeof value.didTimeout !== "boolean" ||
    !("relaxedDrcPassed" in value) ||
    typeof value.relaxedDrcPassed !== "boolean"
  ) {
    throw new Error(`Invalid benchmark sample fields in ${sourceLabel}`)
  }
  const sampleNumber = "sampleNumber" in value ? value.sampleNumber : undefined
  if (
    sampleNumber !== undefined &&
    (typeof sampleNumber !== "number" ||
      !Number.isInteger(sampleNumber) ||
      sampleNumber < 1)
  ) {
    throw new Error(`Invalid sampleNumber in ${sourceLabel}`)
  }
  const viaCount = "viaCount" in value ? value.viaCount : undefined
  if (
    viaCount !== undefined &&
    (typeof viaCount !== "number" || !Number.isFinite(viaCount) || viaCount < 0)
  ) {
    throw new Error(`Invalid viaCount in ${sourceLabel}`)
  }
  const errorPhaseName =
    "errorPhaseName" in value ? value.errorPhaseName : undefined
  const error = "error" in value ? value.error : undefined
  if (errorPhaseName !== undefined && typeof errorPhaseName !== "string") {
    throw new Error(`Invalid errorPhaseName in ${sourceLabel}`)
  }
  if (error !== undefined && typeof error !== "string") {
    throw new Error(`Invalid error in ${sourceLabel}`)
  }
  if (value.didSolve && value.didTimeout) {
    throw new Error(
      `Benchmark sample is both solved and timed out in ${sourceLabel}`,
    )
  }
  if (value.relaxedDrcPassed && !value.didSolve) {
    throw new Error(
      `Unsolved benchmark sample passed relaxed DRC in ${sourceLabel}`,
    )
  }
  const stageTiming =
    "stageTiming" in value
      ? parseBenchmarkStageTimingOrThrow(
          value.stageTiming,
          value.didSolve ? "complete" : "partial",
          sourceLabel,
        )
      : undefined
  return {
    ...value,
    solverName: value.solverName,
    scenarioName: value.scenarioName,
    sampleNumber,
    elapsedTimeMs: value.elapsedTimeMs,
    didSolve: value.didSolve,
    didTimeout: value.didTimeout,
    relaxedDrcPassed: value.relaxedDrcPassed,
    viaCount,
    errorPhaseName,
    error,
    stageTiming,
  }
}

const parseBenchmarkReportOrThrow = (
  value: unknown,
  sourceLabel: string,
): BenchmarkHistoryReport => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid benchmark report in ${sourceLabel}`)
  }
  if (
    !("version" in value) ||
    value.version !== 1 ||
    !("datasetName" in value) ||
    typeof value.datasetName !== "string" ||
    value.datasetName.trim() === "" ||
    !("scenarioCount" in value) ||
    typeof value.scenarioCount !== "number" ||
    !Number.isInteger(value.scenarioCount) ||
    value.scenarioCount < 1 ||
    !("effortLabel" in value) ||
    typeof value.effortLabel !== "string" ||
    value.effortLabel.trim() === "" ||
    !("summary" in value) ||
    !Array.isArray(value.summary) ||
    value.summary.length === 0 ||
    !("tests" in value) ||
    !Array.isArray(value.tests) ||
    value.tests.length === 0
  ) {
    throw new Error(`Invalid benchmark report fields in ${sourceLabel}`)
  }
  return {
    ...value,
    version: 1,
    datasetName: value.datasetName,
    scenarioCount: value.scenarioCount,
    effortLabel: value.effortLabel,
    summary: value.summary.map((summary, index) =>
      parseBenchmarkSummaryOrThrow(summary, `${sourceLabel} summary ${index}`),
    ),
    tests: value.tests.map((sample, index) =>
      parseBenchmarkSampleOrThrow(sample, `${sourceLabel} sample ${index}`),
    ),
  }
}

const parseBenchmarkOutputOrThrow = (
  value: unknown,
  sourceLabel: string,
): BenchmarkHistoryReport | BenchmarkReportCollection => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid benchmark output in ${sourceLabel}`)
  }
  if (!("kind" in value)) return parseBenchmarkReportOrThrow(value, sourceLabel)
  if (
    value.kind !== "benchmark-report-collection" ||
    !("version" in value) ||
    value.version !== 2 ||
    !("generatedFor" in value) ||
    value.generatedFor !== "main" ||
    !("reports" in value) ||
    !Array.isArray(value.reports) ||
    value.reports.length === 0
  ) {
    throw new Error(`Invalid benchmark report collection in ${sourceLabel}`)
  }
  return {
    version: 2,
    kind: "benchmark-report-collection",
    generatedFor: "main",
    reports: value.reports.map((report, index) =>
      parseBenchmarkReportOrThrow(report, `${sourceLabel} report ${index}`),
    ),
  }
}

const normalizeSamplesOrThrow = ({
  report,
  summary,
}: {
  report: BenchmarkHistoryReport
  summary: BenchmarkHistorySummary
}): Array<BenchmarkHistorySample & { sampleNumber: number }> => {
  const samples = report.tests.filter(
    (sample) => sample.solverName === summary.solverName,
  )
  if (samples.length === 0) {
    throw new Error(
      `Benchmark report ${report.datasetName} has a summary for ${summary.solverName} without samples`,
    )
  }
  const hasExplicitSampleNumbers = samples.some(
    (sample) => sample.sampleNumber !== undefined,
  )
  if (
    hasExplicitSampleNumbers &&
    samples.some((sample) => sample.sampleNumber === undefined)
  ) {
    throw new Error(
      `Benchmark report ${report.datasetName} mixes numbered and legacy samples for ${summary.solverName}`,
    )
  }
  if (!hasExplicitSampleNumbers) {
    const normalizedSamples = samples.map((sample) => {
      const numberMatches = sample.scenarioName.match(/\d+/g)
      if (numberMatches?.length !== 1) {
        throw new Error(
          `Legacy benchmark sample ${sample.scenarioName} does not contain one sample number`,
        )
      }
      const sampleNumber = Number.parseInt(numberMatches[0], 10)
      if (!Number.isInteger(sampleNumber) || sampleNumber < 1) {
        throw new Error(
          `Legacy benchmark sample ${sample.scenarioName} has an invalid sample number`,
        )
      }
      return { ...sample, sampleNumber }
    })
    const sampleNumbers = new Set(
      normalizedSamples.map((sample) => sample.sampleNumber),
    )
    if (sampleNumbers.size !== normalizedSamples.length) {
      throw new Error(
        `Legacy benchmark report ${report.datasetName} has duplicate sample numbers for ${summary.solverName}`,
      )
    }
    return normalizedSamples
  }
  const sampleNumbers = new Set<number>()
  return samples.map((sample) => {
    if (sample.sampleNumber === undefined) {
      throw new Error(
        `Benchmark report ${report.datasetName} is missing a sample number for ${summary.solverName}`,
      )
    }
    if (sampleNumbers.has(sample.sampleNumber)) {
      throw new Error(
        `Benchmark report ${report.datasetName} has duplicate sample ${sample.sampleNumber} for ${summary.solverName}`,
      )
    }
    sampleNumbers.add(sample.sampleNumber)
    return { ...sample, sampleNumber: sample.sampleNumber }
  })
}

const makeDashboardPoint = (
  run: BenchmarkHistoryRun,
  report: BenchmarkHistoryReport,
  summary: BenchmarkHistorySummary,
): DashboardPoint => {
  const samples = normalizeSamplesOrThrow({ report, summary })
  const completedSamples = samples.filter((sample) => sample.didSolve)
  const solveTimes = completedSamples.map((sample) => sample.elapsedTimeMs)
  const viaCounts = completedSamples
    .map((sample) => sample.viaCount)
    .filter((viaCount): viaCount is number => typeof viaCount === "number")

  return {
    runId: run.runId,
    runUrl: run.runUrl,
    createdAt: run.createdAt,
    datasetName: report.datasetName,
    solverName: summary.solverName,
    effortLabel: report.effortLabel,
    completedRate: parseRateLabelOrThrow({
      label: summary.completedRateLabel,
      context: `${report.datasetName} ${summary.solverName} completion`,
    }),
    relaxedDrcRate: parseRateLabelOrThrow({
      label: summary.relaxedDrcRateLabel,
      context: `${report.datasetName} ${summary.solverName} relaxed DRC`,
    }),
    p50TimeMs: summary.p50TimeMs,
    p90TimeMs: getPercentile(solveTimes, 0.9),
    p95TimeMs: summary.p95TimeMs,
    maxTimeMs: solveTimes.length === 0 ? null : Math.max(...solveTimes),
    avgVia: summary.avgVia === undefined ? null : summary.avgVia,
    medianVia: getPercentile(viaCounts, 0.5),
    maxVia: viaCounts.length === 0 ? null : Math.max(...viaCounts),
    samples,
  }
}

export const getDashboardPoints = (
  runs: BenchmarkHistoryRun[],
): DashboardPoint[] => {
  const points: DashboardPoint[] = []
  for (const run of runs) {
    const reports = run.report.version === 2 ? run.report.reports : [run.report]
    const pointKeys = new Set<string>()
    for (const report of reports) {
      const summarySolvers = new Set(
        report.summary.map((summary) => summary.solverName),
      )
      const unrecognizedSample = report.tests.find(
        (sample) => !summarySolvers.has(sample.solverName),
      )
      if (unrecognizedSample) {
        throw new Error(
          `Benchmark report ${report.datasetName} has samples for ${unrecognizedSample.solverName} without a summary`,
        )
      }
      for (const summary of report.summary) {
        const pointKey = [
          report.datasetName,
          summary.solverName,
          report.effortLabel,
        ].join(" | ")
        if (pointKeys.has(pointKey)) {
          throw new Error(
            `Benchmark run ${run.runId} contains duplicate dashboard series ${pointKey}`,
          )
        }
        pointKeys.add(pointKey)
        points.push(makeDashboardPoint(run, report, summary))
      }
    }
  }
  return points
}

export type BenchmarkHistoryDashboardIndex = {
  version: 1
  kind: "benchmark-history-dashboard-index"
  dashboardRunLimit: number
  runs: Array<{
    runId: string
    runUrl: string
    commitSha: string
    createdAt: string
    runner: string
    path: string
  }>
  points: Array<Omit<DashboardPoint, "samples">>
}

export const createBenchmarkHistoryDashboardIndex = (
  allRuns: BenchmarkHistoryRun[],
): BenchmarkHistoryDashboardIndex => {
  const runs = [...allRuns].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )
  return {
    version: 1,
    kind: "benchmark-history-dashboard-index",
    dashboardRunLimit: DASHBOARD_RUN_LIMIT,
    runs: runs.map((run) => ({
      runId: run.runId,
      runUrl: run.runUrl,
      commitSha: run.commitSha,
      createdAt: run.createdAt,
      runner: run.runner,
      path: `runs/${run.runId}.json`,
    })),
    points: getDashboardPoints(runs.slice(-DASHBOARD_RUN_LIMIT)).map(
      ({ samples: _samples, ...point }) => point,
    ),
  }
}

export const writeBenchmarkHistoryDashboard = async ({
  runs,
  outputDirectory,
}: {
  runs: BenchmarkHistoryRun[]
  outputDirectory: string
}): Promise<void> => {
  const dashboardDirectory = join(import.meta.dir, "benchmark-dashboard")
  const outputDataDirectory = join(outputDirectory, "data")
  const outputRunsDirectory = join(outputDataDirectory, "runs")
  const dashboardIndex = createBenchmarkHistoryDashboardIndex(runs)
  const [html, css, script] = await Promise.all([
    readFile(join(dashboardDirectory, "index.html"), "utf8"),
    readFile(join(dashboardDirectory, "index.css"), "utf8"),
    readFile(join(dashboardDirectory, "index.js"), "utf8"),
  ])
  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputRunsDirectory, { recursive: true })
  await Promise.all([
    writeFile(join(outputDirectory, "index.html"), html),
    writeFile(join(outputDirectory, "index.css"), css),
    writeFile(join(outputDirectory, "index.js"), script),
    writeJsonFileAtomically(
      join(outputDataDirectory, "index.json"),
      dashboardIndex,
    ),
    ...runs.map((run) =>
      writeJsonFileAtomically(
        join(outputRunsDirectory, `${run.runId}.json`),
        run,
      ),
    ),
  ])
}

const writeJsonFileAtomically = async (
  filePath: string,
  value: unknown,
): Promise<void> => {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2))
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

export const readHistoryRuns = async (
  historyDirectory: string,
): Promise<BenchmarkHistoryRun[]> => {
  const indexPath = join(historyDirectory, HISTORY_INDEX_NAME)
  const runsDirectory = join(historyDirectory, HISTORY_RUNS_DIRECTORY)
  if (!existsSync(indexPath)) {
    if (
      existsSync(runsDirectory) &&
      (await readdir(runsDirectory)).length > 0
    ) {
      throw new Error(`Benchmark history index is missing: ${indexPath}`)
    }
    return []
  }
  const index = parseHistoryIndexOrThrow(
    await readJsonFileOrThrow(indexPath),
    indexPath,
  )
  if (existsSync(runsDirectory)) {
    const indexedFileNames = new Set(
      index.runs.map((entry) => `${entry.runId}.json`),
    )
    const unindexedFileName = (await readdir(runsDirectory)).find(
      (fileName) => !indexedFileNames.has(fileName),
    )
    if (unindexedFileName) {
      throw new Error(
        `Benchmark history contains unindexed run file: ${join(runsDirectory, unindexedFileName)}`,
      )
    }
  }
  const runs = await Promise.all(
    index.runs.map(async (entry) => {
      const runPath = join(historyDirectory, entry.path)
      const run = parseBenchmarkHistoryRunOrThrow(
        await readJsonFileOrThrow(runPath),
        runPath,
      )
      if (run.runId !== entry.runId || run.createdAt !== entry.createdAt) {
        throw new Error(
          `Benchmark history index entry ${entry.runId} does not match ${runPath}`,
        )
      }
      return run
    }),
  )
  getDashboardPoints(runs)
  return runs
}

export const mergePublishedHistoryRuns = async ({
  historyDirectory,
  publishedHistoryDirectory,
}: {
  historyDirectory: string
  publishedHistoryDirectory: string
}): Promise<BenchmarkHistoryRun[]> => {
  const historyRuns = await readHistoryRuns(historyDirectory)
  const indexPath = join(publishedHistoryDirectory, HISTORY_INDEX_NAME)
  const publishedRunsDirectory = join(
    publishedHistoryDirectory,
    HISTORY_RUNS_DIRECTORY,
  )
  if (!existsSync(indexPath)) {
    if (
      existsSync(publishedRunsDirectory) &&
      (await readdir(publishedRunsDirectory)).length > 0
    ) {
      throw new Error(
        `Published benchmark history index is missing: ${indexPath}`,
      )
    }
    return historyRuns
  }
  const value = await readJsonFileOrThrow(indexPath)
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("kind" in value) ||
    value.kind !== "benchmark-history-dashboard-index" ||
    !("runs" in value)
  ) {
    throw new Error(`Invalid published benchmark history index: ${indexPath}`)
  }
  const publishedIndex = parseHistoryIndexOrThrow(
    { version: 1, runs: value.runs },
    indexPath,
  )
  if (existsSync(publishedRunsDirectory)) {
    const indexedFileNames = new Set(
      publishedIndex.runs.map((entry) => `${entry.runId}.json`),
    )
    const unindexedFileName = (await readdir(publishedRunsDirectory)).find(
      (fileName) => !indexedFileNames.has(fileName),
    )
    if (unindexedFileName) {
      throw new Error(
        `Published benchmark history contains unindexed run file: ${join(publishedRunsDirectory, unindexedFileName)}`,
      )
    }
  }
  const runsById = new Map(historyRuns.map((run) => [run.runId, run]))
  const importedRuns: BenchmarkHistoryRun[] = []
  for (const entry of publishedIndex.runs) {
    const publishedRunPath = join(publishedHistoryDirectory, entry.path)
    const historyRun = runsById.get(entry.runId)
    if (historyRun) {
      if (historyRun.createdAt !== entry.createdAt) {
        throw new Error(
          `Published benchmark history index entry ${entry.runId} does not match ${publishedRunPath}`,
        )
      }
      const [historyContents, publishedContents] = await Promise.all([
        readFile(
          join(
            historyDirectory,
            HISTORY_RUNS_DIRECTORY,
            `${historyRun.runId}.json`,
          ),
        ),
        readFile(publishedRunPath),
      ])
      if (
        historyContents.toString("utf8") !== publishedContents.toString("utf8")
      ) {
        const publishedRun = parseBenchmarkHistoryRunOrThrow(
          JSON.parse(publishedContents.toString("utf8")),
          publishedRunPath,
        )
        if (stableStringify(historyRun) !== stableStringify(publishedRun)) {
          throw new Error(
            `Published benchmark history conflicts with workflow run ${publishedRun.runId}`,
          )
        }
      }
      continue
    }
    const publishedRun = parseBenchmarkHistoryRunOrThrow(
      await readJsonFileOrThrow(publishedRunPath),
      publishedRunPath,
    )
    if (
      publishedRun.runId !== entry.runId ||
      publishedRun.createdAt !== entry.createdAt
    ) {
      throw new Error(
        `Published benchmark history index entry ${entry.runId} does not match ${publishedRunPath}`,
      )
    }
    getDashboardPoints([publishedRun])
    runsById.set(publishedRun.runId, publishedRun)
    importedRuns.push(publishedRun)
  }
  if (importedRuns.length === 0) return historyRuns
  const sortedRuns = [...runsById.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )
  await mkdir(join(historyDirectory, HISTORY_RUNS_DIRECTORY), {
    recursive: true,
  })
  await Promise.all(
    importedRuns.map((run) =>
      writeJsonFileAtomically(
        join(historyDirectory, HISTORY_RUNS_DIRECTORY, `${run.runId}.json`),
        run,
      ),
    ),
  )
  const index: BenchmarkHistoryIndex = {
    version: 1,
    runs: sortedRuns.map((run) => ({
      runId: run.runId,
      createdAt: run.createdAt,
      path: join(HISTORY_RUNS_DIRECTORY, `${run.runId}.json`),
    })),
  }
  await writeJsonFileAtomically(
    join(historyDirectory, HISTORY_INDEX_NAME),
    index,
  )
  return sortedRuns
}

export const appendHistoryRun = async ({
  historyDirectory,
  historyRuns,
  run,
}: {
  historyDirectory: string
  historyRuns?: BenchmarkHistoryRun[]
  run: BenchmarkHistoryRun
}): Promise<BenchmarkHistoryRun[]> => {
  const validatedRun = parseBenchmarkHistoryRunOrThrow(run, "new history run")
  getDashboardPoints([validatedRun])
  const runs = historyRuns ?? (await readHistoryRuns(historyDirectory))
  const existingRun = runs.find((entry) => entry.runId === validatedRun.runId)
  if (existingRun) {
    if (stableStringify(existingRun) !== stableStringify(validatedRun)) {
      throw new Error(
        `Benchmark history contains conflicting workflow run ${validatedRun.runId}`,
      )
    }
    return runs
  }
  const sortedRuns = [...runs, validatedRun].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )
  const relativePath = join(
    HISTORY_RUNS_DIRECTORY,
    `${validatedRun.runId}.json`,
  )
  await mkdir(join(historyDirectory, HISTORY_RUNS_DIRECTORY), {
    recursive: true,
  })
  await writeJsonFileAtomically(
    join(historyDirectory, relativePath),
    validatedRun,
  )
  const index: BenchmarkHistoryIndex = {
    version: 1,
    runs: sortedRuns.map((entry) => ({
      runId: entry.runId,
      createdAt: entry.createdAt,
      path: join(HISTORY_RUNS_DIRECTORY, `${entry.runId}.json`),
    })),
  }
  await writeJsonFileAtomically(
    join(historyDirectory, HISTORY_INDEX_NAME),
    index,
  )
  return sortedRuns
}

const readJsonFileOrThrow = async (filePath: string): Promise<unknown> => {
  const contents = await readFile(filePath, "utf8")
  if (contents.trim() === "") throw new Error(`Empty JSON file: ${filePath}`)
  try {
    return JSON.parse(contents)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON in ${filePath}: ${message}`)
  }
}

const parseBenchmarkMetadataOrThrow = (
  value: unknown,
  sourceLabel: string,
): BenchmarkRunMetadata => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid benchmark metadata in ${sourceLabel}`)
  }
  if (
    !("workflowRunId" in value) ||
    typeof value.workflowRunId !== "string" ||
    !/^\d+$/.test(value.workflowRunId) ||
    !("workflowRunAttempt" in value) ||
    typeof value.workflowRunAttempt !== "number" ||
    !Number.isInteger(value.workflowRunAttempt) ||
    value.workflowRunAttempt < 1 ||
    !("commitSha" in value) ||
    typeof value.commitSha !== "string" ||
    value.commitSha.trim() === "" ||
    !("createdAt" in value) ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !("runner" in value) ||
    typeof value.runner !== "object" ||
    value.runner === null ||
    Array.isArray(value.runner) ||
    !("name" in value.runner) ||
    typeof value.runner.name !== "string" ||
    value.runner.name.trim() === ""
  ) {
    throw new Error(`Invalid benchmark metadata fields in ${sourceLabel}`)
  }
  return {
    workflowRunId: value.workflowRunId,
    workflowRunAttempt: value.workflowRunAttempt,
    commitSha: value.commitSha,
    createdAt: value.createdAt,
    runner: { name: value.runner.name },
    raw: { ...value },
  }
}

const parseBenchmarkHistoryRunOrThrow = (
  value: unknown,
  sourceLabel: string,
): BenchmarkHistoryRun => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid benchmark history run in ${sourceLabel}`)
  }
  if (
    !("version" in value) ||
    value.version !== 1 ||
    !("runId" in value) ||
    typeof value.runId !== "string" ||
    !/^\d+-\d+$/.test(value.runId) ||
    !("workflowRunId" in value) ||
    typeof value.workflowRunId !== "string" ||
    !("workflowRunAttempt" in value) ||
    typeof value.workflowRunAttempt !== "number" ||
    !Number.isInteger(value.workflowRunAttempt) ||
    value.workflowRunAttempt < 1 ||
    !("runUrl" in value) ||
    typeof value.runUrl !== "string" ||
    !("commitSha" in value) ||
    typeof value.commitSha !== "string" ||
    value.commitSha.trim() === "" ||
    !("createdAt" in value) ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !("runner" in value) ||
    typeof value.runner !== "string" ||
    value.runner.trim() === "" ||
    !("metadata" in value) ||
    !("report" in value)
  ) {
    throw new Error(`Invalid benchmark history run fields in ${sourceLabel}`)
  }
  let runUrl: URL
  try {
    runUrl = new URL(value.runUrl)
  } catch {
    throw new Error(`Invalid benchmark run URL in ${sourceLabel}`)
  }
  if (runUrl.protocol !== "https:") {
    throw new Error(`Invalid benchmark run URL protocol in ${sourceLabel}`)
  }
  const metadata = parseBenchmarkMetadataOrThrow(value.metadata, sourceLabel)
  const expectedRunId = `${value.workflowRunId}-${value.workflowRunAttempt}`
  if (
    value.runId !== expectedRunId ||
    metadata.workflowRunId !== value.workflowRunId ||
    metadata.workflowRunAttempt !== value.workflowRunAttempt ||
    metadata.commitSha !== value.commitSha ||
    metadata.createdAt !== value.createdAt ||
    metadata.runner.name !== value.runner
  ) {
    throw new Error(`Conflicting benchmark run metadata in ${sourceLabel}`)
  }
  return {
    version: 1,
    runId: value.runId,
    workflowRunId: value.workflowRunId,
    workflowRunAttempt: value.workflowRunAttempt,
    runUrl: value.runUrl,
    commitSha: value.commitSha,
    createdAt: value.createdAt,
    runner: value.runner,
    metadata: metadata.raw,
    report: parseBenchmarkOutputOrThrow(value.report, sourceLabel),
  }
}

const parseHistoryIndexOrThrow = (
  value: unknown,
  sourceLabel: string,
): BenchmarkHistoryIndex => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("version" in value) ||
    value.version !== 1 ||
    !("runs" in value) ||
    !Array.isArray(value.runs)
  ) {
    throw new Error(`Invalid benchmark history index: ${sourceLabel}`)
  }
  const runIds = new Set<string>()
  const runs = value.runs.map((entry, index) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      !("runId" in entry) ||
      typeof entry.runId !== "string" ||
      !/^\d+-\d+$/.test(entry.runId) ||
      !("createdAt" in entry) ||
      typeof entry.createdAt !== "string" ||
      Number.isNaN(Date.parse(entry.createdAt)) ||
      !("path" in entry) ||
      typeof entry.path !== "string"
    ) {
      throw new Error(`Invalid benchmark history index entry ${index}`)
    }
    const expectedPath = join(HISTORY_RUNS_DIRECTORY, `${entry.runId}.json`)
    if (entry.path !== expectedPath) {
      throw new Error(
        `Invalid path for benchmark history run ${entry.runId}: ${entry.path}`,
      )
    }
    if (runIds.has(entry.runId)) {
      throw new Error(`Duplicate benchmark history run ${entry.runId}`)
    }
    runIds.add(entry.runId)
    return {
      runId: entry.runId,
      createdAt: entry.createdAt,
      path: entry.path,
    }
  })
  for (let index = 1; index < runs.length; index++) {
    const previousRun = runs[index - 1]
    const currentRun = runs[index]
    if (
      previousRun !== undefined &&
      currentRun !== undefined &&
      previousRun.createdAt.localeCompare(currentRun.createdAt) > 0
    ) {
      throw new Error(`Benchmark history index is not sorted: ${sourceLabel}`)
    }
  }
  return { version: 1, runs }
}

const parseFlagValuesOrThrow = (
  args: string[],
  expectedFlags: string[],
  requiredFlags = expectedFlags,
): Map<string, string> => {
  const expected = new Set(expectedFlags)
  const values = new Map<string, string>()
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag?.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${flag ?? ""}`)
    }
    if (!expected.has(flag)) throw new Error(`Unknown flag: ${flag}`)
    if (values.has(flag)) throw new Error(`Duplicate flag: ${flag}`)
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`)
    }
    values.set(flag, value)
  }
  for (const flag of requiredFlags) {
    if (!values.has(flag)) throw new Error(`Missing ${flag}`)
  }
  return values
}

const parseCommandOrThrow = (args: string[]): BenchmarkHistoryCommand => {
  const command = args[0]
  if (command !== "render" && command !== "record") {
    throw new Error(
      "Usage: benchmark-history.ts <record|render> --history-dir <path> --out-dir <directory>",
    )
  }
  const commonFlags = ["--history-dir", "--out-dir"]
  const expectedFlags =
    command === "render"
      ? commonFlags
      : [
          ...commonFlags,
          "--report",
          "--metadata",
          "--run-url",
          "--published-history-dir",
        ]
  const requiredFlags =
    command === "render"
      ? expectedFlags
      : [...commonFlags, "--report", "--metadata", "--run-url"]
  const values = parseFlagValuesOrThrow(args, expectedFlags, requiredFlags)
  const historyDirectory = values.get("--history-dir")
  const outputDirectory = values.get("--out-dir")
  if (!historyDirectory || !outputDirectory) {
    throw new Error(`Could not parse ${command} command`)
  }
  if (command === "render") {
    return { command, historyDirectory, outputDirectory }
  }
  const reportPath = values.get("--report")
  const metadataPath = values.get("--metadata")
  const runUrl = values.get("--run-url")
  if (!reportPath || !metadataPath || !runUrl) {
    throw new Error("Could not parse record command")
  }
  return {
    command,
    historyDirectory,
    outputDirectory,
    publishedHistoryDirectory: values.get("--published-history-dir"),
    reportPath,
    metadataPath,
    runUrl,
  }
}

const main = async (): Promise<void> => {
  const command = parseCommandOrThrow(process.argv.slice(2))
  if (command.command === "render") {
    await writeBenchmarkHistoryDashboard({
      outputDirectory: command.outputDirectory,
      runs: await readHistoryRuns(command.historyDirectory),
    })
    return
  }
  const report = parseBenchmarkOutputOrThrow(
    await readJsonFileOrThrow(command.reportPath),
    command.reportPath,
  )
  const metadata = parseBenchmarkMetadataOrThrow(
    await readJsonFileOrThrow(command.metadataPath),
    command.metadataPath,
  )
  const historyRuns = command.publishedHistoryDirectory
    ? await mergePublishedHistoryRuns({
        historyDirectory: command.historyDirectory,
        publishedHistoryDirectory: command.publishedHistoryDirectory,
      })
    : undefined
  const runs = await appendHistoryRun({
    historyDirectory: command.historyDirectory,
    historyRuns,
    run: {
      version: 1,
      runId: `${metadata.workflowRunId}-${metadata.workflowRunAttempt}`,
      workflowRunId: metadata.workflowRunId,
      workflowRunAttempt: metadata.workflowRunAttempt,
      runUrl: command.runUrl,
      commitSha: metadata.commitSha,
      createdAt: metadata.createdAt,
      runner: metadata.runner.name,
      metadata: metadata.raw,
      report,
    },
  })
  await writeBenchmarkHistoryDashboard({
    outputDirectory: command.outputDirectory,
    runs,
  })
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
