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

// Older benchmark artifacts predate avgVia and sampleNumber. The parser accepts
// those two omissions only, then normalizes them before building dashboard data.
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
  outputPath: string
}

type RecordCommand = {
  command: "record"
  historyDirectory: string
  outputPath: string
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

export const createBenchmarkHistoryDashboard = (
  allRuns: BenchmarkHistoryRun[],
): string => {
  const runs = [...allRuns].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )
  const totalRunCount = runs.length
  const dashboardRuns = runs.slice(-DASHBOARD_RUN_LIMIT)
  const points = getDashboardPoints(dashboardRuns).map(
    ({ samples: _samples, ...point }) => point,
  )
  const data = JSON.stringify({
    runs: dashboardRuns,
    totalRunCount,
    points,
    dashboardRunLimit: DASHBOARD_RUN_LIMIT,
  })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Autorouter benchmark history</title>
<style>
:root{color-scheme:dark;--page:#080d18;--panel:#101827;--panel-raised:#141f31;--panel-soft:#0d1523;--border:#26344a;--border-strong:#3b4d68;--text:#edf4ff;--muted:#91a1b9;--subtle:#63748e;--accent:#67e8c1;--accent-strong:#2dd4a7;--accent-soft:rgba(103,232,193,.12);--blue:#79b8ff;--blue-soft:rgba(121,184,255,.12);--good:#67e8c1;--bad:#ff7b8b;--bad-soft:rgba(255,123,139,.12);--warn:#f6c76e;--shadow:0 24px 60px rgba(0,0,0,.22)}
:root[data-theme="light"]{color-scheme:light;--page:#f4f7fb;--panel:#fff;--panel-raised:#fff;--panel-soft:#f7f9fc;--border:#dbe3ee;--border-strong:#b8c6d9;--text:#152033;--muted:#586982;--subtle:#7b8ba1;--accent:#087f65;--accent-strong:#087f65;--accent-soft:rgba(8,127,101,.1);--blue:#1769aa;--blue-soft:rgba(23,105,170,.1);--good:#087f65;--bad:#c2344b;--bad-soft:rgba(194,52,75,.09);--warn:#9a6400;--shadow:0 20px 55px rgba(42,60,84,.12)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 85% -10%,rgba(62,99,221,.16),transparent 30rem),var(--page);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page-shell{width:min(1480px,calc(100% - 48px));margin:0 auto}.site-header{border-bottom:1px solid var(--border);background:rgba(8,13,24,.78);backdrop-filter:blur(18px)}:root[data-theme="light"] .site-header{background:rgba(244,247,251,.84)}.header-inner{display:flex;justify-content:space-between;gap:32px;align-items:flex-start;padding:34px 0 30px}.brand{display:flex;gap:16px;align-items:flex-start}.brand-mark{display:grid;place-items:center;width:44px;height:44px;flex:0 0 auto;border:1px solid rgba(103,232,193,.35);border-radius:13px;background:linear-gradient(145deg,rgba(103,232,193,.2),rgba(121,184,255,.08));color:var(--accent)}.brand-mark svg{width:25px;height:25px}.eyebrow{margin:0 0 4px;color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1,h2,h3,p{margin-top:0}h1{margin-bottom:6px;font-size:clamp(24px,3vw,38px);line-height:1.08;letter-spacing:-.035em}h2{margin-bottom:5px;font-size:21px;letter-spacing:-.02em}h3{margin-bottom:4px;font-size:14px}.lede{max-width:760px;margin:0;color:var(--muted)}.header-actions{display:flex;gap:10px;align-items:center}.header-facts{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:14px}.fact{padding:6px 10px;border:1px solid var(--border);border-radius:999px;background:var(--panel-soft);color:var(--muted);font-size:12px}.fact strong{color:var(--text);font-variant-numeric:tabular-nums}.button,.icon-button,select,input{min-height:38px;border:1px solid var(--border-strong);border-radius:9px;background:var(--panel-raised);color:var(--text);font:inherit}.button,.icon-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 12px;cursor:pointer;text-decoration:none;font-weight:700}.button:hover,.icon-button:hover{border-color:var(--accent);background:var(--accent-soft)}.button:focus-visible,.icon-button:focus-visible,select:focus-visible,input:focus-visible,.metric-button:focus-visible,.signal-card:focus-visible,tr[tabindex]:focus-visible{outline:3px solid rgba(121,184,255,.48);outline-offset:2px}.button-secondary{background:transparent}.icon-button{width:38px;padding:0;font-size:17px}.muted{color:var(--muted)}.section-block{margin:30px 0}.section-heading{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;margin-bottom:14px}.section-heading p{margin:0;color:var(--muted)}.panel{border:1px solid var(--border);border-radius:16px;background:linear-gradient(145deg,var(--panel-raised),var(--panel));box-shadow:var(--shadow)}.signal-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.signal-card{display:block;width:100%;min-height:132px;padding:16px;border:1px solid var(--border);border-radius:13px;background:var(--panel);color:var(--text);text-align:left;cursor:pointer}.signal-card:hover{transform:translateY(-1px);border-color:var(--bad);background:var(--bad-soft)}.signal-top{display:flex;justify-content:space-between;gap:10px;align-items:center}.signal-metric{color:var(--muted);font-size:12px;font-weight:700}.signal-change{color:var(--bad);font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}.signal-series{margin:16px 0 2px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.signal-date{color:var(--muted);font-size:12px}.empty-card{grid-column:1/-1;padding:24px;border:1px dashed var(--border-strong);border-radius:13px;color:var(--muted);text-align:center}.health-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.health-card{position:relative;overflow:hidden;padding:17px;border:1px solid var(--border);border-radius:13px;background:var(--panel)}.health-card:before{position:absolute;inset:0 auto 0 0;width:3px;background:var(--border-strong);content:""}.health-card[data-tone="good"]:before{background:var(--good)}.health-card[data-tone="bad"]:before{background:var(--bad)}.health-label{color:var(--muted);font-size:12px;font-weight:750}.health-value{margin:7px 0 2px;font-size:25px;font-weight:800;letter-spacing:-.025em;font-variant-numeric:tabular-nums}.delta{font-size:12px;font-weight:750}.delta.good{color:var(--good)}.delta.bad{color:var(--bad)}.delta.neutral{color:var(--muted)}.explorer{overflow:hidden}.explorer-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;padding:22px 22px 18px;border-bottom:1px solid var(--border)}.explorer-header p{margin:0;color:var(--muted)}.chart-summary{color:var(--muted);font-size:12px;text-align:right}.filter-grid{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:12px;padding:18px 22px 14px}.field{display:flex;flex-direction:column;gap:6px;color:var(--muted);font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.field select,.field input{width:100%;padding:0 11px;color:var(--text);font-size:13px;font-weight:600;letter-spacing:normal;text-transform:none}.metric-toolbar{display:flex;gap:18px;align-items:flex-start;padding:2px 22px 18px;overflow-x:auto}.metric-group{display:flex;gap:6px;align-items:center;white-space:nowrap}.metric-group-label{margin-right:3px;color:var(--subtle);font-size:11px;font-weight:800;text-transform:uppercase}.metric-button{min-height:34px;padding:0 11px;border:1px solid var(--border);border-radius:999px;background:transparent;color:var(--muted);font:inherit;font-size:12px;font-weight:750;cursor:pointer}.metric-button:hover{border-color:var(--border-strong);color:var(--text)}.metric-button[aria-pressed="true"]{border-color:rgba(103,232,193,.5);background:var(--accent-soft);color:var(--accent)}.chart-area{position:relative;margin:0 22px 18px;border:1px solid var(--border);border-radius:13px;background:var(--panel-soft)}.chart-scroll{overflow-x:auto;overflow-y:hidden}.chart{display:block;width:100%;min-width:760px;height:auto;aspect-ratio:1200/430}.chart text{font-family:inherit}.chart .point-hit{cursor:pointer;fill:transparent}.chart .point-visible{pointer-events:none}.chart .point-hit:focus+.point-visible{stroke:var(--blue);stroke-width:5}.chart-tooltip{position:absolute;z-index:5;min-width:210px;max-width:280px;padding:11px 12px;border:1px solid var(--border-strong);border-radius:10px;background:var(--panel-raised);box-shadow:var(--shadow);pointer-events:none}.chart-tooltip[hidden]{display:none}.tooltip-value{margin-bottom:3px;font-size:17px;font-weight:800}.tooltip-meta{color:var(--muted);font-size:12px}.empty-state{display:grid;place-items:center;min-height:350px;padding:30px;color:var(--muted);text-align:center}.chart-footer{display:flex;justify-content:space-between;gap:16px;padding:0 22px 20px;color:var(--muted);font-size:12px}.selected-panel{padding:22px}.selected-header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.selected-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}.run-meta{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin:19px 0;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--panel-soft)}.run-meta div{min-width:0}.run-meta dt{margin-bottom:4px;color:var(--muted);font-size:11px;font-weight:800;text-transform:uppercase}.run-meta dd{margin:0;overflow:hidden;color:var(--text);font-weight:650;text-overflow:ellipsis;white-space:nowrap}.run-meta a{color:var(--blue)}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.selected-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:20px}.selected-metric{padding:11px;border:1px solid var(--border);border-radius:10px;background:var(--panel)}.selected-metric span{display:block;color:var(--muted);font-size:11px}.selected-metric strong{display:block;margin-top:3px;font-size:15px;font-variant-numeric:tabular-nums}.table-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:end;margin:18px 0 8px}.table-toolbar-fields{display:flex;flex-wrap:wrap;gap:9px}.table-toolbar .field{min-width:170px}.result-count{color:var(--muted);font-size:12px}.table-wrap{max-height:560px;overflow:auto;border:1px solid var(--border);border-radius:11px}table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}caption{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}th,td{padding:10px 11px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}th{position:sticky;z-index:2;top:0;background:var(--panel-raised);color:var(--muted);font-size:10px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:var(--panel-soft)}.sort-button{padding:0;border:0;background:transparent;color:inherit;font:inherit;font-weight:800;text-transform:inherit;cursor:pointer}.scenario-cell{min-width:190px;font-weight:700}.scenario-cell small{display:block;color:var(--muted);font-weight:500}.number-cell{white-space:nowrap;font-variant-numeric:tabular-nums}.cell-delta{display:block;margin-top:2px;font-size:10px;font-weight:700}.badge{display:inline-flex;align-items:center;padding:3px 7px;border-radius:999px;font-size:10px;font-weight:850;letter-spacing:.03em;text-transform:uppercase}.badge.solved,.badge.passed{background:var(--accent-soft);color:var(--good)}.badge.failed,.badge.timeout{background:var(--bad-soft);color:var(--bad)}.error-cell{min-width:220px;max-width:430px;white-space:normal;overflow-wrap:anywhere}.error-cell details summary{color:var(--blue);cursor:pointer}.recent-panel{padding:22px}.recent-table tr[tabindex]{cursor:pointer}.recent-table tr[aria-selected="true"]{background:var(--accent-soft)}a{color:var(--blue)}.footer{padding:14px 0 36px;color:var(--subtle);font-size:12px;text-align:center}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.signal-series,.signal-date{display:block}.signal-date{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(max-width:1050px){.signal-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.health-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.filter-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.run-meta{grid-template-columns:repeat(3,minmax(0,1fr))}.selected-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:700px){.page-shell{width:min(100% - 28px,1480px)}.header-inner{display:block;padding:24px 0}.header-actions{margin-top:18px}.header-facts{justify-content:flex-start}.section-block{margin:22px 0}.section-heading,.explorer-header,.selected-header,.table-toolbar{display:block}.section-heading p,.chart-summary{margin-top:6px;text-align:left}.signal-grid{grid-template-columns:1fr}.signal-card{min-height:112px}.health-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.health-card:last-child{grid-column:1/-1}.filter-grid{grid-template-columns:1fr;padding:16px}.metric-toolbar{padding:0 16px 16px}.chart-area{margin:0 16px 14px}.chart-footer{display:block;padding:0 16px 16px}.chart-footer span{display:block;margin-top:4px}.selected-panel,.recent-panel{padding:16px}.selected-actions{justify-content:flex-start;margin-top:14px}.run-meta{grid-template-columns:repeat(2,minmax(0,1fr))}.selected-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.table-toolbar-fields{display:grid;grid-template-columns:1fr;width:100%}.table-toolbar .field{min-width:0}.result-count{margin-top:8px}.explorer-header{padding:17px 16px 15px}}
@media(prefers-reduced-motion:no-preference){.signal-card,.button,.metric-button{transition:transform .16s ease,border-color .16s ease,background .16s ease,color .16s ease}}
</style>
</head>
<body>
<header class="site-header"><div class="page-shell header-inner"><div class="brand"><div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M3 17h3l2-10 3 13 3-16 3 13h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div><p class="eyebrow">Main branch · benchmark intelligence</p><h1>Autorouter benchmark history</h1><p class="lede">Spot regressions, compare runs, and inspect the exact samples behind every change. Solve-time metrics use completed samples only; via aggregates use solved samples with via data.</p></div></div><div><div class="header-actions"><a class="button button-secondary" id="latest-run-link" href="#">Latest workflow</a><button class="icon-button" id="theme-toggle" type="button" aria-label="Switch color theme" title="Switch color theme">◐</button></div><div class="header-facts" id="header-facts"></div></div></div></header>
<main class="page-shell">
<section class="section-block" aria-labelledby="health-title"><div class="section-heading"><div><p class="eyebrow">Selected series</p><h2 id="health-title">Current health</h2></div><p id="health-context"></p></div><div class="health-grid" id="health-grid"></div></section>
<section class="section-block panel explorer" aria-labelledby="explorer-title"><div class="explorer-header"><div><p class="eyebrow">Explore</p><h2 id="explorer-title">Trend history</h2><p>Hover, tap, or focus a point for its exact value. Click or press Enter to inspect the run.</p></div><div class="chart-summary" id="chart-summary"></div></div><div class="filter-grid"><label class="field">Dataset<select id="dataset"></select></label><label class="field">Solver<select id="solver"></select></label><label class="field">Effort<select id="effort"></select></label><label class="field">Scope<select id="sample"><option value="">All samples</option></select></label><label class="field">Window<select id="range"><option value="20">20 runs</option><option value="50">50 runs</option><option value="100" selected>100 runs</option></select></label></div><div class="metric-toolbar" id="metric-toolbar" aria-label="Chart metric"></div><div class="chart-area"><div class="chart-scroll"><svg class="chart" id="chart" viewBox="0 0 1200 430" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="chart-title chart-description"><title id="chart-title">Benchmark trend chart</title><desc id="chart-description">Interactive history for the selected benchmark metric. Use Tab to focus points and the arrow keys to move between them.</desc></svg></div><div class="chart-tooltip" id="chart-tooltip" role="tooltip" hidden></div></div><div class="chart-footer"><strong id="chart-unit"></strong><span>Percentiles and timing aggregates include completed samples only.</span></div></section>
<section class="section-block panel selected-panel" id="run-details" aria-labelledby="selected-title"><div class="selected-header"><div><p class="eyebrow">Investigate</p><h2 id="selected-title">Selected run</h2><p class="muted" id="selected-context" aria-live="polite"></p></div><div class="selected-actions"><button class="button button-secondary" id="copy-link" type="button">Copy link</button><button class="button button-secondary" id="copy-summary" type="button">Copy summary</button><button class="button button-secondary" id="download-json" type="button">Export JSON</button><button class="button button-secondary" id="download-csv" type="button">Export CSV</button></div></div><dl class="run-meta" id="run-meta"></dl><div class="selected-metrics" id="selected-metrics"></div><div class="table-toolbar"><div class="table-toolbar-fields"><label class="field">Sample status<select id="sample-status"><option value="all">All samples</option><option value="issues">Issues only</option><option value="solved">Solved</option><option value="failed">Failed</option><option value="timeout">Timed out</option></select></label><label class="field">Search samples<input id="sample-search" type="search" placeholder="Scenario, phase, or error" /></label></div><span class="result-count" id="sample-result-count"></span></div><div class="table-wrap"><table id="samples"><caption>Samples for the selected benchmark run, compared with the previous comparable run</caption></table></div></section>
<section class="section-block panel recent-panel" aria-labelledby="recent-title"><div class="section-heading"><div><p class="eyebrow">Exact values</p><h2 id="recent-title">Recent comparable runs</h2></div><p>Select a row to inspect its samples.</p></div><div class="table-wrap"><table class="recent-table" id="recent-runs"><caption>Recent runs for the selected dataset, solver, effort, and sample scope</caption></table></div></section>
</main><footer class="page-shell footer">Self-contained benchmark artifact · raw reports are embedded for offline investigation.</footer><script id="benchmark-history-data" type="application/json">${data}</script>
<script>
const dataElement = document.getElementById('benchmark-history-data')
if (!dataElement) throw new Error('Benchmark dashboard data is missing')

const dashboardData = JSON.parse(dataElement.textContent)
const runById = new Map(dashboardData.runs.map((run) => [run.runId, run]))
const datasetSelect = getRequiredElement('dataset')
const solverSelect = getRequiredElement('solver')
const effortSelect = getRequiredElement('effort')
const sampleSelect = getRequiredElement('sample')
const rangeSelect = getRequiredElement('range')
const chart = getRequiredElement('chart')
const chartTooltip = getRequiredElement('chart-tooltip')
const samplesTable = getRequiredElement('samples')
const recentRunsTable = getRequiredElement('recent-runs')
const sampleStatusSelect = getRequiredElement('sample-status')
const sampleSearchInput = getRequiredElement('sample-search')
const initialHash = new URLSearchParams(location.hash.slice(1))
const chartColor = '#67e8c1'
const metricDefinitions = [
  { key: 'completedRate', label: 'Completion', group: 'Reliability', unit: '%', direction: 'higher' },
  { key: 'relaxedDrcRate', label: 'Relaxed DRC', group: 'Reliability', unit: '%', direction: 'higher' },
  { key: 'p50TimeMs', label: 'P50', group: 'Solve time', unit: 'ms', direction: 'lower' },
  { key: 'p90TimeMs', label: 'P90', group: 'Solve time', unit: 'ms', direction: 'lower' },
  { key: 'p95TimeMs', label: 'P95', group: 'Solve time', unit: 'ms', direction: 'lower' },
  { key: 'maxTimeMs', label: 'Maximum', group: 'Solve time', unit: 'ms', direction: 'lower' },
  { key: 'avgVia', label: 'Average', group: 'Vias', unit: 'vias', direction: 'lower' },
  { key: 'medianVia', label: 'Median', group: 'Vias', unit: 'vias', direction: 'lower' },
  { key: 'maxVia', label: 'Maximum', group: 'Vias', unit: 'vias', direction: 'lower' },
]
const metricByKey = new Map(metricDefinitions.map((metric) => [metric.key, metric]))
const dashboardState = {
  metricKey: metricByKey.has(initialHash.get('metric'))
    ? initialHash.get('metric')
    : 'completedRate',
  selectedRunId: initialHash.get('run'),
  sampleSortKey: 'sampleNumber',
  sampleSortDirection: 'asc',
}

function getRequiredElement(id) {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error('Benchmark dashboard element #' + id + ' is missing')
  }
  return element
}

function escapeHtml(value) {
  const replacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return String(value).replace(/[&<>"']/g, (character) => replacements[character])
}

function uniqueSorted(values) {
  const uniqueValues = [...new Set(values)]
  const sortedValues = uniqueValues.sort((left, right) =>
    String(left).localeCompare(String(right)),
  )
  return sortedValues
}

function setSelectOptions(select, values, preferredValue, labelForValue) {
  select.innerHTML = values
    .map((value) => '<option value="' + escapeHtml(value) + '">' +
      escapeHtml(labelForValue ? labelForValue(value) : value) + '</option>')
    .join('')
  if (preferredValue !== null && values.includes(preferredValue)) {
    select.value = preferredValue
  }
}

function getRunReports(run) {
  if (run.report.version === 2) {
    return run.report.reports
  }
  if (run.report.version === 1) {
    return [run.report]
  }
  throw new Error('Benchmark run ' + run.runId + ' has an unsupported report version')
}

function getPointSamples(point) {
  const run = runById.get(point.runId)
  if (!run) throw new Error('Benchmark run ' + point.runId + ' is missing')
  const report = getRunReports(run).find((item) =>
    item.datasetName === point.datasetName && item.effortLabel === point.effortLabel,
  )
  if (!report) throw new Error('Benchmark report for ' + point.datasetName + ' is missing')
  return report.tests
    .filter((sample) => sample.solverName === point.solverName)
    .map((sample) => {
      if (sample.sampleNumber !== undefined) return sample
      const numberMatches = sample.scenarioName.match(/\\d+/g)
      if (!numberMatches || numberMatches.length !== 1) {
        throw new Error('Could not derive sample number from ' + sample.scenarioName)
      }
      return { ...sample, sampleNumber: Number.parseInt(numberMatches[0], 10) }
    })
}

function formatDate(value, includeTime) {
  const options = includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { month: 'short', day: 'numeric' }
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value))
}

function formatDuration(value) {
  if (value === null || value === undefined) return 'n/a'
  if (!Number.isFinite(value)) throw new Error('Cannot format a non-finite duration')
  if (Math.abs(value) >= 1000) return (value / 1000).toFixed(2) + ' s'
  return value.toFixed(value < 100 ? 1 : 0) + ' ms'
}

function formatMetricValue(metric, value) {
  if (value === null || value === undefined) return 'n/a'
  if (!Number.isFinite(value)) throw new Error('Cannot format a non-finite metric')
  if (metric.unit === '%') return value.toFixed(1) + ' %'
  if (metric.unit === 'ms') return formatDuration(value)
  return value.toFixed(1) + ' vias'
}

function formatMetricDelta(metric, delta) {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) {
    return 'No previous value'
  }
  const prefix = delta > 0 ? '+' : ''
  if (metric.unit === '%') return prefix + delta.toFixed(1) + ' pp'
  if (metric.unit === 'ms') return prefix + formatDuration(delta)
  return prefix + delta.toFixed(1) + ' vias'
}

function getDeltaTone(metric, delta) {
  if (delta === null || delta === undefined || Math.abs(delta) < 0.0001) {
    return 'neutral'
  }
  const improved = metric.direction === 'higher' ? delta > 0 : delta < 0
  return improved ? 'good' : 'bad'
}

function formatStatus(sample) {
  if (sample.didTimeout) {
    return 'Timeout'
  }
  if (sample.didSolve) {
    return 'Solved'
  }
  return 'Failed'
}

function getBaseSeriesPoints() {
  return dashboardData.points.filter((point) =>
    point.datasetName === datasetSelect.value &&
    point.solverName === solverSelect.value &&
    point.effortLabel === effortSelect.value,
  )
}

function getScopedSeriesPoints() {
  const selectedSampleNumber = sampleSelect.value === ''
    ? null
    : Number(sampleSelect.value)
  if (selectedSampleNumber !== null && !Number.isInteger(selectedSampleNumber)) {
    throw new Error('Selected sample number is invalid')
  }
  return getBaseSeriesPoints()
    .map((point) => {
      const hydratedPoint = { ...point, samples: getPointSamples(point) }
      if (selectedSampleNumber === null) return hydratedPoint
      const sample = hydratedPoint.samples.find(
        (item) => item.sampleNumber === selectedSampleNumber,
      )
      if (!sample) return null
      return {
        ...hydratedPoint,
        completedRate: sample.didSolve ? 100 : 0,
        relaxedDrcRate: sample.relaxedDrcPassed ? 100 : 0,
        p50TimeMs: sample.elapsedTimeMs,
        p90TimeMs: sample.elapsedTimeMs,
        p95TimeMs: sample.elapsedTimeMs,
        maxTimeMs: sample.elapsedTimeMs,
        avgVia: sample.viaCount ?? null,
        medianVia: sample.viaCount ?? null,
        maxVia: sample.viaCount ?? null,
        samples: [sample],
      }
    })
    .filter((point) => point !== null)
}

function getVisiblePoints() {
  const range = Number(rangeSelect.value)
  if (![20, 50, 100].includes(range)) {
    throw new Error('Selected benchmark range is invalid')
  }
  return getScopedSeriesPoints().slice(-range)
}

function getPreviousPoint(point) {
  const points = getScopedSeriesPoints()
  const pointIndex = points.findIndex((item) => item.runId === point.runId)
  return pointIndex > 0 ? points[pointIndex - 1] : null
}

function getSelectedPoint() {
  const points = getVisiblePoints()
  const selectedPoint = points.find((point) => point.runId === dashboardState.selectedRunId)
  return selectedPoint ?? points[points.length - 1] ?? null
}

function renderHeader() {
  const latestRun = dashboardData.runs[dashboardData.runs.length - 1]
  const latestRunLink = getRequiredElement('latest-run-link')
  if (latestRun) {
    latestRunLink.href = latestRun.runUrl
    latestRunLink.textContent = 'Latest workflow #' + latestRun.runId
  } else {
    latestRunLink.hidden = true
  }
  const datasets = new Set(dashboardData.points.map((point) => point.datasetName))
  getRequiredElement('header-facts').innerHTML =
    '<span class="fact"><strong>' + (dashboardData.totalRunCount ?? dashboardData.runs.length) + '</strong> stored runs</span>' +
    '<span class="fact"><strong>' + Math.min(dashboardData.dashboardRunLimit, dashboardData.runs.length) +
    '</strong> runs charted</span><span class="fact"><strong>' + datasets.size +
    '</strong> datasets</span>' + (latestRun
      ? '<span class="fact">Updated <strong>' + escapeHtml(formatDate(latestRun.createdAt, true)) + '</strong></span>'
      : '')
}

function renderHealth() {
  const points = getScopedSeriesPoints()
  const latest = points[points.length - 1]
  const previous = points[points.length - 2]
  const healthGrid = getRequiredElement('health-grid')
  const healthContext = getRequiredElement('health-context')
  if (!latest) {
    healthGrid.innerHTML = '<div class="empty-card">No benchmark data matches these filters.</div>'
    healthContext.textContent = ''
    return
  }
  healthContext.textContent = latest.datasetName + ' · ' + latest.solverName + ' · ' +
    latest.effortLabel + ' · latest ' + formatDate(latest.createdAt, true)
  const healthMetricKeys = sampleSelect.value === ''
    ? ['completedRate', 'relaxedDrcRate', 'p50TimeMs', 'p95TimeMs', 'avgVia']
    : ['completedRate', 'relaxedDrcRate', 'p50TimeMs', 'avgVia']
  healthGrid.innerHTML = healthMetricKeys.map((metricKey) => {
    const metric = metricByKey.get(metricKey)
    const label = sampleSelect.value !== '' && metricKey === 'p50TimeMs'
      ? 'Elapsed time'
      : metric.label + (metric.group === 'Solve time'
          ? ' solve time'
          : metric.group === 'Vias' ? ' vias' : '')
    const delta = previous && latest[metricKey] !== null && previous[metricKey] !== null
      ? latest[metricKey] - previous[metricKey]
      : null
    const tone = getDeltaTone(metric, delta)
    return '<article class="health-card" data-tone="' + tone + '"><span class="health-label">' +
      escapeHtml(label) + '</span><div class="health-value">' +
      escapeHtml(formatMetricValue(metric, latest[metricKey])) + '</div><span class="delta ' + tone + '">' +
      escapeHtml(formatMetricDelta(metric, delta)) + ' vs previous</span></article>'
  }).join('')
}

function renderMetricToolbar() {
  const sampleScoped = sampleSelect.value !== ''
  const availableMetrics = sampleScoped
    ? metricDefinitions.filter((metric) =>
        ['completedRate', 'relaxedDrcRate', 'p50TimeMs', 'avgVia'].includes(metric.key),
      )
    : metricDefinitions
  if (!availableMetrics.some((metric) => metric.key === dashboardState.metricKey)) {
    dashboardState.metricKey = 'p50TimeMs'
  }
  const groups = uniqueSorted(availableMetrics.map((metric) => metric.group))
  getRequiredElement('metric-toolbar').innerHTML = groups.map((group) => {
    const buttons = availableMetrics.filter((metric) => metric.group === group).map((metric) => {
      const label = sampleScoped && metric.key === 'p50TimeMs'
        ? 'Elapsed time'
        : sampleScoped && metric.key === 'avgVia'
          ? 'Via count'
          : metric.label
      return '<button class="metric-button" type="button" data-metric="' + metric.key +
        '" aria-pressed="' + String(metric.key === dashboardState.metricKey) + '">' +
        escapeHtml(label) + '</button>'
    }).join('')
    return '<div class="metric-group"><span class="metric-group-label">' +
      escapeHtml(group) + '</span>' + buttons + '</div>'
  }).join('')
}

function getAxisScale(metric, maximum) {
  if (metric.unit === '%') return { divisor: 1, unit: '%', maximum: 100 }
  if (metric.unit === 'ms' && maximum >= 1000) {
    return { divisor: 1000, unit: 's', maximum: Math.max(maximum * 1.08, 1) }
  }
  return { divisor: 1, unit: metric.unit, maximum: Math.max(maximum * 1.08, 1) }
}

function formatAxisTick(value, scale) {
  const scaled = value / scale.divisor
  const decimals = scale.unit === '%' || scale.unit === 'vias' ? 1 : scaled < 10 ? 2 : 0
  return scaled.toFixed(decimals) + ' ' + scale.unit
}

function makeSvgElement(name, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name)
  for (const [attributeName, value] of Object.entries(attributes)) {
    element.setAttribute(attributeName, String(value))
  }
  return element
}

function appendChartTitle(metric, points) {
  const title = makeSvgElement('title', { id: 'chart-title' })
  title.textContent = metric.label + ' history for ' + datasetSelect.value
  const description = makeSvgElement('desc', { id: 'chart-description' })
  description.textContent = points.length +
    ' benchmark runs. Use Tab to focus data points and arrow keys to move between them.'
  chart.append(title, description)
}

function renderEmptyChart(message) {
  const label = makeSvgElement('text', {
    x: 600,
    y: 215,
    fill: 'currentColor',
    'text-anchor': 'middle',
    'font-size': 16,
    opacity: 0.7,
  })
  label.textContent = message
  chart.append(label)
  getRequiredElement('chart-summary').textContent = 'No chartable values'
  getRequiredElement('chart-unit').textContent = ''
}

function showTooltip(point, metric, anchor) {
  const previous = getPreviousPoint(point)
  const delta = previous && point[metric.key] !== null && previous[metric.key] !== null
    ? point[metric.key] - previous[metric.key]
    : null
  chartTooltip.innerHTML = '<div class="tooltip-value">' +
    escapeHtml(formatMetricValue(metric, point[metric.key])) + '</div><div class="tooltip-meta">' +
    escapeHtml(formatMetricDelta(metric, delta)) + ' vs previous<br>' +
    escapeHtml(formatDate(point.createdAt, true)) + '<br>Workflow #' +
    escapeHtml(point.runId) + '</div>'
  chartTooltip.hidden = false
  const containerBounds = chartTooltip.parentElement.getBoundingClientRect()
  const anchorBounds = anchor.getBoundingClientRect()
  const desiredLeft = anchorBounds.left + anchorBounds.width / 2 - containerBounds.left - 105
  const desiredTop = anchorBounds.top - containerBounds.top - chartTooltip.offsetHeight - 12
  chartTooltip.style.left = Math.max(8, Math.min(desiredLeft, containerBounds.width - 226)) + 'px'
  chartTooltip.style.top = Math.max(8, desiredTop) + 'px'
}

function moveChartFocus(event, pointIndex) {
  const pointControls = [...chart.querySelectorAll('.point-hit')]
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault()
    const offset = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = Math.max(0, Math.min(pointControls.length - 1, pointIndex + offset))
    pointControls[nextIndex]?.focus()
  }
}

function renderChart() {
  const points = getVisiblePoints()
  const metric = metricByKey.get(dashboardState.metricKey)
  if (!metric) throw new Error('Selected benchmark metric is invalid')
  chart.innerHTML = ''
  chartTooltip.hidden = true
  appendChartTitle(metric, points)
  if (points.length === 0) {
    renderEmptyChart('No runs match the selected filters.')
    return
  }
  const values = points
    .map((point) => point[metric.key])
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
  if (values.length === 0) {
    renderEmptyChart('No ' + metric.label.toLowerCase() + ' data is available for this series.')
    return
  }
  const maximum = Math.max(...values)
  const scale = getAxisScale(metric, maximum)
  const plot = { left: 88, right: 1172, top: 28, bottom: 370 }
  const plotWidth = plot.right - plot.left
  const plotHeight = plot.bottom - plot.top
  for (let row = 0; row < 5; row++) {
    const y = plot.top + (plotHeight * row) / 4
    const value = scale.maximum - (scale.maximum * row) / 4
    chart.append(makeSvgElement('line', {
      x1: plot.left,
      y1: y,
      x2: plot.right,
      y2: y,
      stroke: 'var(--border)',
    }))
    const label = makeSvgElement('text', {
      x: plot.left - 12,
      y: y + 4,
      fill: 'var(--muted)',
      'font-size': 11,
      'text-anchor': 'end',
    })
    label.textContent = formatAxisTick(value, scale)
    chart.append(label)
  }
  const xTickIndexes = uniqueSorted([0, Math.floor((points.length - 1) / 4),
    Math.floor((points.length - 1) / 2), Math.floor(((points.length - 1) * 3) / 4),
    points.length - 1]).map(Number)
  for (const pointIndex of xTickIndexes) {
    const position = points.length === 1 ? 0.5 : pointIndex / (points.length - 1)
    const x = plot.left + plotWidth * position
    const label = makeSvgElement('text', {
      x,
      y: 403,
      fill: 'var(--muted)',
      'font-size': 11,
      'text-anchor': pointIndex === 0 ? 'start' : pointIndex === points.length - 1 ? 'end' : 'middle',
    })
    label.textContent = formatDate(points[pointIndex].createdAt, false)
    chart.append(label)
  }
  let segment = []
  const flushSegment = () => {
    if (segment.length > 1) {
      chart.append(makeSvgElement('polyline', {
        points: segment.join(' '),
        fill: 'none',
        stroke: chartColor,
        'stroke-width': 3,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'pointer-events': 'none',
      }))
    }
    segment = []
  }
  const plottedPoints = []
  points.forEach((point, pointIndex) => {
    const value = point[metric.key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      flushSegment()
      return
    }
    const position = points.length === 1 ? 0.5 : pointIndex / (points.length - 1)
    const x = plot.left + plotWidth * position
    const y = plot.bottom - (value / scale.maximum) * plotHeight
    segment.push(x + ',' + y)
    plottedPoints.push({ point, x, y })
  })
  flushSegment()
  const selectedPoint = getSelectedPoint()
  const selectedPlot = plottedPoints.find((item) =>
    selectedPoint && item.point.runId === selectedPoint.runId,
  )
  if (selectedPlot) {
    chart.append(makeSvgElement('line', {
      x1: selectedPlot.x,
      y1: plot.top,
      x2: selectedPlot.x,
      y2: plot.bottom,
      stroke: 'var(--blue)',
      'stroke-width': 1,
      'stroke-dasharray': '4 5',
      opacity: 0.55,
    }))
  }
  plottedPoints.forEach(({ point, x, y }, pointIndex) => {
    const hitTarget = makeSvgElement('circle', {
      class: 'point-hit',
      cx: x,
      cy: y,
      r: 14,
      tabindex: 0,
      role: 'button',
      'aria-label': formatDate(point.createdAt, true) + ', ' +
        formatMetricValue(metric, point[metric.key]) + ', workflow ' + point.runId,
    })
    const visiblePoint = makeSvgElement('circle', {
      class: 'point-visible',
      cx: x,
      cy: y,
      r: selectedPoint && point.runId === selectedPoint.runId ? 6 : 4,
      fill: selectedPoint && point.runId === selectedPoint.runId ? 'var(--blue)' : chartColor,
      stroke: 'var(--panel-soft)',
      'stroke-width': 2,
    })
    hitTarget.addEventListener('mouseenter', () => showTooltip(point, metric, visiblePoint))
    hitTarget.addEventListener('mouseleave', () => { chartTooltip.hidden = true })
    hitTarget.addEventListener('focus', () => showTooltip(point, metric, visiblePoint))
    hitTarget.addEventListener('blur', () => { chartTooltip.hidden = true })
    hitTarget.addEventListener('click', () => selectPoint(point))
    hitTarget.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        selectPoint(point)
      } else {
        moveChartFocus(event, pointIndex)
      }
    })
    chart.append(hitTarget, visiblePoint)
  })
  getRequiredElement('chart-summary').textContent = points.length + ' runs · ' +
    formatDate(points[0].createdAt, false) + ' – ' +
    formatDate(points[points.length - 1].createdAt, false)
  const scopeLabel = sampleSelect.value === '' ? 'All samples' : 'Sample ' + sampleSelect.value
  getRequiredElement('chart-unit').textContent = metric.label + ' · ' + scopeLabel + ' · axis in ' + scale.unit
}

function getSampleSortValue(sample, key) {
  if (key === 'status') return formatStatus(sample)
  if (key === 'drc') return sample.relaxedDrcPassed ? 1 : 0
  if (key === 'vias') return sample.viaCount ?? Number.POSITIVE_INFINITY
  return sample[key] ?? ''
}

function getFilteredSortedSamples(point) {
  const query = sampleSearchInput.value.trim().toLowerCase()
  const status = sampleStatusSelect.value
  return [...point.samples]
    .filter((sample) => {
      const sampleStatus = formatStatus(sample).toLowerCase()
      const matchesStatus = status === 'all' ||
        (status === 'issues' && (!sample.didSolve || sample.didTimeout || !sample.relaxedDrcPassed)) ||
        (status === 'solved' && sample.didSolve) ||
        (status === 'failed' && !sample.didSolve && !sample.didTimeout) ||
        (status === 'timeout' && sample.didTimeout)
      const searchable = [sample.scenarioName, sample.errorPhaseName, sample.error,
        sample.sampleNumber, sampleStatus].join(' ').toLowerCase()
      return matchesStatus && searchable.includes(query)
    })
    .sort((left, right) => {
      const leftValue = getSampleSortValue(left, dashboardState.sampleSortKey)
      const rightValue = getSampleSortValue(right, dashboardState.sampleSortKey)
      const direction = dashboardState.sampleSortDirection === 'asc' ? 1 : -1
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * direction
      }
      return String(leftValue).localeCompare(String(rightValue)) * direction
    })
}

function renderDeltaText(metric, currentValue, previousValue) {
  if (previousValue === null || previousValue === undefined) return ''
  const delta = currentValue - previousValue
  const tone = getDeltaTone(metric, delta)
  return '<span class="cell-delta delta ' + tone + '">' +
    escapeHtml(formatMetricDelta(metric, delta)) + '</span>'
}

function renderError(sample) {
  const phase = sample.errorPhaseName
    ? '<strong>' + escapeHtml(sample.errorPhaseName) + '</strong>'
    : ''
  if (!sample.error) return phase || '<span class="muted">—</span>'
  return phase + (phase ? '<br>' : '') + '<details><summary>Error details</summary>' +
    escapeHtml(sample.error) + '</details>'
}

function renderSamples(point, previous) {
  const samples = getFilteredSortedSamples(point)
  const previousByNumber = new Map((previous?.samples ?? []).map((sample) =>
    [sample.sampleNumber, sample],
  ))
  const directionMark = dashboardState.sampleSortDirection === 'asc' ? ' ↑' : ' ↓'
  const header = (label, key) => '<button class="sort-button" type="button" data-sort="' +
    key + '">' + label + (dashboardState.sampleSortKey === key ? directionMark : '') + '</button>'
  const rows = samples.map((sample) => {
    const previousSample = previousByNumber.get(sample.sampleNumber)
    const status = formatStatus(sample)
    const statusClass = status.toLowerCase()
    const previousStatus = previousSample ? formatStatus(previousSample) : null
    const statusDelta = previousStatus && previousStatus !== status
      ? '<span class="cell-delta delta bad">was ' + escapeHtml(previousStatus) + '</span>'
      : ''
    const drcStatus = sample.relaxedDrcPassed ? 'Passed' : 'Failed'
    const previousDrc = previousSample
      ? previousSample.relaxedDrcPassed ? 'Passed' : 'Failed'
      : null
    const drcDelta = previousDrc && previousDrc !== drcStatus
      ? '<span class="cell-delta delta ' + (sample.relaxedDrcPassed ? 'good' : 'bad') +
        '">was ' + previousDrc + '</span>'
      : ''
    return '<tr><td class="scenario-cell">' + escapeHtml(sample.scenarioName) +
      '<small>Sample ' + sample.sampleNumber + '</small></td><td><span class="badge ' +
      statusClass + '">' + status + '</span>' + statusDelta + '</td><td class="number-cell">' +
      escapeHtml(formatDuration(sample.elapsedTimeMs)) +
      renderDeltaText(metricByKey.get('p50TimeMs'), sample.elapsedTimeMs, previousSample?.elapsedTimeMs) +
      '</td><td><span class="badge ' + (sample.relaxedDrcPassed ? 'passed' : 'failed') + '">' +
      drcStatus + '</span>' + drcDelta + '</td><td class="number-cell">' +
      (sample.viaCount === undefined ? 'n/a' : sample.viaCount + ' vias') +
      (sample.viaCount !== undefined && previousSample?.viaCount !== undefined
        ? renderDeltaText(metricByKey.get('avgVia'), sample.viaCount, previousSample.viaCount)
        : '') + '</td><td class="error-cell">' + renderError(sample) + '</td></tr>'
  })
  samplesTable.innerHTML = '<caption>Samples for the selected benchmark run, compared with the previous comparable run</caption>' +
    '<thead><tr><th>' + header('Scenario', 'scenarioName') + '</th><th>' +
    header('Status', 'status') + '</th><th>' + header('Solve time', 'elapsedTimeMs') +
    '</th><th>' + header('DRC', 'drc') + '</th><th>' + header('Vias', 'vias') +
    '</th><th>Error</th></tr></thead><tbody>' + rows.join('') + '</tbody>'
  getRequiredElement('sample-result-count').textContent = samples.length + ' of ' +
    point.samples.length + ' samples'
  samplesTable.querySelectorAll('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      if (dashboardState.sampleSortKey === button.dataset.sort) {
        dashboardState.sampleSortDirection =
          dashboardState.sampleSortDirection === 'asc' ? 'desc' : 'asc'
      } else {
        dashboardState.sampleSortKey = button.dataset.sort
        dashboardState.sampleSortDirection = 'asc'
      }
      renderSamples(point, previous)
    })
  })
}

function renderRunDetails() {
  const point = getSelectedPoint()
  const runMeta = getRequiredElement('run-meta')
  if (!point) {
    dashboardState.selectedRunId = null
    getRequiredElement('selected-context').textContent = 'No run matches the selected filters.'
    runMeta.innerHTML = ''
    getRequiredElement('selected-metrics').innerHTML = ''
    samplesTable.innerHTML = '<tbody><tr><td class="muted">No samples to display.</td></tr></tbody>'
    return
  }
  dashboardState.selectedRunId = point.runId
  const previous = getPreviousPoint(point)
  const run = runById.get(point.runId)
  if (!run) throw new Error('Selected benchmark run is missing')
  getRequiredElement('selected-context').textContent = previous
    ? 'Compared with workflow #' + previous.runId + ' from ' + formatDate(previous.createdAt, true) + '.'
    : 'This is the first comparable run in the chart window.'
  const metadataItems = [
    ['Workflow', '<a href="' + escapeHtml(run.runUrl) + '">#' + escapeHtml(run.runId) + '</a>'],
    ['Commit', '<code>' + escapeHtml(run.commitSha.slice(0, 10)) + '</code>'],
    ['Created', escapeHtml(formatDate(run.createdAt, true))],
    ['Runner', escapeHtml(run.runner)],
    ['Dataset', escapeHtml(point.datasetName)],
    ['Solver / effort', escapeHtml(point.solverName + ' · ' + point.effortLabel)],
  ]
  runMeta.innerHTML = metadataItems.map(([label, value]) =>
    '<div><dt>' + label + '</dt><dd title="' + escapeHtml(String(value).replace(/<[^>]+>/g, '')) +
    '">' + value + '</dd></div>',
  ).join('')
  const detailMetricKeys = sampleSelect.value === ''
    ? ['completedRate', 'relaxedDrcRate', 'p50TimeMs', 'p95TimeMs', 'avgVia']
    : ['completedRate', 'relaxedDrcRate', 'p50TimeMs', 'avgVia']
  getRequiredElement('selected-metrics').innerHTML = detailMetricKeys.map((metricKey) => {
    const metric = metricByKey.get(metricKey)
    const delta = previous && point[metricKey] !== null && previous[metricKey] !== null
      ? point[metricKey] - previous[metricKey]
      : null
    const label = sampleSelect.value !== '' && metricKey === 'p50TimeMs'
      ? 'Elapsed time'
      : metric.label + (metric.group === 'Vias' ? ' vias' : '')
    return '<div class="selected-metric"><span>' + escapeHtml(label) + '</span><strong>' +
      escapeHtml(formatMetricValue(metric, point[metricKey])) + '</strong><small class="delta ' +
      getDeltaTone(metric, delta) + '">' + escapeHtml(formatMetricDelta(metric, delta)) + '</small></div>'
  }).join('')
  renderSamples(point, previous)
}

function renderRecentRuns() {
  const points = getScopedSeriesPoints().slice(-15).reverse()
  const rows = points.map((point) =>
    '<tr tabindex="0" data-run-id="' + escapeHtml(point.runId) + '" aria-selected="' +
    String(point.runId === dashboardState.selectedRunId) + '"><td>' +
    escapeHtml(formatDate(point.createdAt, true)) + '</td><td>' +
    escapeHtml(formatMetricValue(metricByKey.get('completedRate'), point.completedRate)) + '</td><td>' +
    escapeHtml(formatMetricValue(metricByKey.get('relaxedDrcRate'), point.relaxedDrcRate)) + '</td><td>' +
    escapeHtml(formatMetricValue(metricByKey.get('p50TimeMs'), point.p50TimeMs)) + '</td><td>' +
    escapeHtml(formatMetricValue(metricByKey.get('p95TimeMs'), point.p95TimeMs)) + '</td><td>' +
    escapeHtml(formatMetricValue(metricByKey.get('avgVia'), point.avgVia)) + '</td><td><a href="' +
    escapeHtml(point.runUrl) + '">#' + escapeHtml(point.runId) + '</a></td></tr>',
  )
  recentRunsTable.innerHTML = '<caption>Recent runs for the selected dataset, solver, effort, and sample scope</caption>' +
    '<thead><tr><th>Date</th><th>Completion (%)</th><th>DRC (%)</th><th>P50 solve time</th>' +
    '<th>P95 solve time</th><th>Average vias</th><th>Workflow</th></tr></thead><tbody>' +
    rows.join('') + '</tbody>'
  recentRunsTable.querySelectorAll('[data-run-id]').forEach((row) => {
    const chooseRow = () => {
      const point = points.find((item) => item.runId === row.dataset.runId)
      if (point) selectPoint(point)
    }
    row.addEventListener('click', (event) => {
      if (!event.target.closest('a')) chooseRow()
    })
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        chooseRow()
      }
    })
  })
}

function updateHash() {
  const parameters = new URLSearchParams()
  parameters.set('dataset', datasetSelect.value)
  parameters.set('solver', solverSelect.value)
  parameters.set('effort', effortSelect.value)
  if (sampleSelect.value) parameters.set('sample', sampleSelect.value)
  parameters.set('range', rangeSelect.value)
  parameters.set('metric', dashboardState.metricKey)
  if (dashboardState.selectedRunId) parameters.set('run', dashboardState.selectedRunId)
  history.replaceState(null, '', '#' + parameters.toString())
}

function renderDashboard(resetSelection) {
  const points = getVisiblePoints()
  if (resetSelection || !points.some((point) => point.runId === dashboardState.selectedRunId)) {
    dashboardState.selectedRunId = points[points.length - 1]?.runId ?? null
  }
  renderMetricToolbar()
  renderHealth()
  renderChart()
  renderRunDetails()
  renderRecentRuns()
  updateHash()
}

function selectPoint(point) {
  dashboardState.selectedRunId = point.runId
  renderChart()
  renderRunDetails()
  renderRecentRuns()
  updateHash()
}

function rebuildSampleOptions(preferredValue) {
  const samples = getBaseSeriesPoints().flatMap((point) => getPointSamples(point))
  const sampleNumbers = [...new Set(samples.map((sample) => {
    if (sample.sampleNumber !== undefined) return sample.sampleNumber
    const matches = sample.scenarioName.match(/\\d+/g)
    if (!matches || matches.length !== 1) {
      throw new Error('Could not derive sample number from ' + sample.scenarioName)
    }
    return Number.parseInt(matches[0], 10)
  }))].sort((left, right) => left - right)
  const values = ['', ...sampleNumbers.map(String)]
  setSelectOptions(sampleSelect, values, preferredValue, (value) =>
    value === '' ? 'All samples' : 'Sample ' + value,
  )
}

function rebuildSeriesControls(preferredSolver, preferredEffort, preferredSample) {
  const solvers = uniqueSorted(dashboardData.points
    .filter((point) => point.datasetName === datasetSelect.value)
    .map((point) => point.solverName))
  setSelectOptions(solverSelect, solvers, preferredSolver)
  const efforts = uniqueSorted(dashboardData.points
    .filter((point) => point.datasetName === datasetSelect.value &&
      point.solverName === solverSelect.value)
    .map((point) => point.effortLabel))
  setSelectOptions(effortSelect, efforts, preferredEffort)
  rebuildSampleOptions(preferredSample)
}

function initializeControls() {
  const latestPoint = dashboardData.points[dashboardData.points.length - 1]
  const datasets = uniqueSorted(dashboardData.points.map((point) => point.datasetName))
  const preferredDataset = initialHash.get('dataset') ?? latestPoint?.datasetName ?? null
  setSelectOptions(datasetSelect, datasets, preferredDataset)
  rebuildSeriesControls(
    initialHash.get('solver') ?? latestPoint?.solverName ?? null,
    initialHash.get('effort') ?? latestPoint?.effortLabel ?? null,
    initialHash.get('sample') ?? '',
  )
  if (['20', '50', '100'].includes(initialHash.get('range'))) {
    rangeSelect.value = initialHash.get('range')
  }
}

async function copyText(text, button, successLabel) {
  let copied = false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      copied = true
    }
  } catch (_error) {
    copied = false
  }
  if (!copied) {
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.append(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  const originalLabel = button.textContent
  button.textContent = successLabel
  setTimeout(() => { button.textContent = originalLabel }, 1400)
}

function getSelectedExportData() {
  const point = getSelectedPoint()
  if (!point) throw new Error('There is no selected benchmark run to export')
  return { point, previous: getPreviousPoint(point), run: runById.get(point.runId) }
}

function downloadBlob(fileName, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function quoteCsv(value) {
  const hasValue = value !== null && value !== undefined
  const text = hasValue ? String(value) : ''
  const escapedText = text.replace(/"/g, '""')
  const quotedText = '"' + escapedText + '"'
  return quotedText
}

function buildSelectedSummary() {
  const { point, previous, run } = getSelectedExportData()
  const lines = [
    '### Autorouter benchmark ' + point.datasetName + ' · ' + point.solverName,
    '- Run: [' + run.runId + '](' + run.runUrl + ') at ' + formatDate(run.createdAt, true),
    '- Commit: ' + run.commitSha,
  ]
  for (const metricKey of ['completedRate', 'relaxedDrcRate', 'p50TimeMs', 'p95TimeMs', 'avgVia']) {
    const metric = metricByKey.get(metricKey)
    const delta = previous && point[metricKey] !== null && previous[metricKey] !== null
      ? point[metricKey] - previous[metricKey]
      : null
    lines.push('- ' + metric.label + ': ' + formatMetricValue(metric, point[metricKey]) +
      ' (' + formatMetricDelta(metric, delta) + ' vs previous)')
  }
  return lines.join('\\n')
}

function setupTheme() {
  let storedTheme = null
  try {
    storedTheme = localStorage.getItem('benchmark-dashboard-theme')
  } catch (_error) {
    storedTheme = null
  }
  const theme = storedTheme ??
    (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  document.documentElement.dataset.theme = theme
}

datasetSelect.addEventListener('change', () => {
  rebuildSeriesControls(null, null, '')
  renderDashboard(true)
})
solverSelect.addEventListener('change', () => {
  rebuildSeriesControls(solverSelect.value, null, '')
  renderDashboard(true)
})
effortSelect.addEventListener('change', () => {
  rebuildSampleOptions('')
  renderDashboard(true)
})
sampleSelect.addEventListener('change', () => renderDashboard(true))
rangeSelect.addEventListener('change', () => renderDashboard(true))
getRequiredElement('metric-toolbar').addEventListener('click', (event) => {
  const button = event.target.closest('[data-metric]')
  if (!button) return
  dashboardState.metricKey = button.dataset.metric
  renderDashboard(false)
})
sampleStatusSelect.addEventListener('change', renderRunDetails)
sampleSearchInput.addEventListener('input', renderRunDetails)
getRequiredElement('theme-toggle').addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = nextTheme
  try {
    localStorage.setItem('benchmark-dashboard-theme', nextTheme)
  } catch (_error) {
    // A downloaded artifact can still switch theme when storage is unavailable.
  }
})
getRequiredElement('copy-link').addEventListener('click', (event) =>
  copyText(location.href, event.currentTarget, 'Link copied'),
)
getRequiredElement('copy-summary').addEventListener('click', (event) =>
  copyText(buildSelectedSummary(), event.currentTarget, 'Summary copied'),
)
getRequiredElement('download-json').addEventListener('click', () => {
  const data = getSelectedExportData()
  downloadBlob('benchmark-' + data.point.runId + '.json', JSON.stringify(data, null, 2), 'application/json')
})
getRequiredElement('download-csv').addEventListener('click', () => {
  const { point, previous } = getSelectedExportData()
  const previousByNumber = new Map((previous?.samples ?? []).map((sample) =>
    [sample.sampleNumber, sample],
  ))
  const rows = [['scenario', 'sample_number', 'status', 'solve_time_ms', 'previous_solve_time_ms',
    'drc_passed', 'previous_drc_passed', 'via_count', 'previous_via_count', 'error_phase', 'error']]
  for (const sample of point.samples) {
    const previousSample = previousByNumber.get(sample.sampleNumber)
    rows.push([sample.scenarioName, sample.sampleNumber, formatStatus(sample), sample.elapsedTimeMs,
      previousSample?.elapsedTimeMs, sample.relaxedDrcPassed, previousSample?.relaxedDrcPassed,
      sample.viaCount, previousSample?.viaCount, sample.errorPhaseName, sample.error])
  }
  downloadBlob('benchmark-' + point.runId + '.csv', rows.map((row) =>
    row.map(quoteCsv).join(','),
  ).join('\\n'), 'text/csv')
})

setupTheme()
initializeControls()
renderHeader()
renderDashboard(false)
</script></body></html>`
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

export const appendHistoryRun = async ({
  historyDirectory,
  run,
}: {
  historyDirectory: string
  run: BenchmarkHistoryRun
}): Promise<BenchmarkHistoryRun[]> => {
  const validatedRun = parseBenchmarkHistoryRunOrThrow(run, "new history run")
  getDashboardPoints([validatedRun])
  const runs = await readHistoryRuns(historyDirectory)
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
  for (const flag of expectedFlags) {
    if (!values.has(flag)) throw new Error(`Missing ${flag}`)
  }
  return values
}

const parseCommandOrThrow = (args: string[]): BenchmarkHistoryCommand => {
  const command = args[0]
  if (command !== "render" && command !== "record") {
    throw new Error(
      "Usage: benchmark-history.ts <record|render> --history-dir <path> --out <path>",
    )
  }
  const commonFlags = ["--history-dir", "--out"]
  const expectedFlags =
    command === "render"
      ? commonFlags
      : [...commonFlags, "--report", "--metadata", "--run-url"]
  const values = parseFlagValuesOrThrow(args, expectedFlags)
  const historyDirectory = values.get("--history-dir")
  const outputPath = values.get("--out")
  if (!historyDirectory || !outputPath) {
    throw new Error(`Could not parse ${command} command`)
  }
  if (command === "render") {
    return { command, historyDirectory, outputPath }
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
    outputPath,
    reportPath,
    metadataPath,
    runUrl,
  }
}

const main = async (): Promise<void> => {
  const command = parseCommandOrThrow(process.argv.slice(2))
  if (command.command === "render") {
    await writeFile(
      command.outputPath,
      createBenchmarkHistoryDashboard(
        await readHistoryRuns(command.historyDirectory),
      ),
    )
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
  const runs = await appendHistoryRun({
    historyDirectory: command.historyDirectory,
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
  await writeFile(command.outputPath, createBenchmarkHistoryDashboard(runs))
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
