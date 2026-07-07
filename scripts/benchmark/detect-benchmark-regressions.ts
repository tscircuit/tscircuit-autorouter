#!/usr/bin/env bun

import { existsSync } from "node:fs"
import type { BenchmarkReport, SolverRunSummary } from "./benchmark-types"
import { parseDatasetName } from "./scenarios"

// -----------------------------------------------------------------------------
// Thresholds are strict on solve rate and lenient on timing so tiny noisy time
// differences do not spam Slack.
// -----------------------------------------------------------------------------

export interface RegressionThresholds {
  /** Percentage-point drop in Completed% that counts as a regression. */
  completedRateDropPp: number
  /** Percentage-point drop in Relaxed DRC pass % that counts as a regression. */
  drcRateDropPp: number
  /** Percent increase in P50 solve time that counts as a regression. */
  p50IncreasePct: number
  /** Percent increase in P95 solve time that counts as a regression. */
  p95IncreasePct: number
  /** Percent increase in average via count that counts as a regression. */
  avgViaIncreasePct: number
  /** Absolute ms delta below which a time regression is treated as noise. */
  minTimeDeltaMs: number
}

export const DEFAULT_THRESHOLDS: RegressionThresholds = {
  completedRateDropPp: 0.01,
  drcRateDropPp: 0.01,
  p50IncreasePct: 15,
  p95IncreasePct: 15,
  avgViaIncreasePct: 10,
  minTimeDeltaMs: 5,
}

export type RegressionMetric =
  | "completedRate"
  | "relaxedDrcRate"
  | "p50TimeMs"
  | "p95TimeMs"
  | "avgVia"

export type RegressionKind =
  // A comparable metric moved past its threshold in the worse direction.
  | "metric-regression"
  // A metric that had a value in baseline is now null (e.g. nothing solved,
  // so P50 is n/a). Treated as a regression, never coerced to 0.
  | "metric-null"
  // A whole dataset/solver row present in baseline is gone from current.
  | "dataset-dropped"

interface BaseRegression {
  datasetName: string
  solverName: string
  effortLabel: string
}

export type Regression =
  | (BaseRegression & {
      metric: RegressionMetric
      kind: "metric-regression"
      baselineValue: number
      currentValue: number
      delta: number
      deltaPct: number | null
    })
  | (BaseRegression & {
      metric: RegressionMetric
      kind: "metric-null"
      baselineValue: number
      currentValue: null
      delta: null
      deltaPct: null
    })
  | (BaseRegression & {
      metric: null
      kind: "dataset-dropped"
      baselineValue: null
      currentValue: null
      delta: null
      deltaPct: null
    })

export interface NewDatasetEntry {
  datasetName: string
  solverName: string
  effortLabel: string
}

export interface RegressionReport {
  hasRegressions: boolean
  regressions: Regression[]
  newDatasets: NewDatasetEntry[]
  comparedKeys: number
  baselineMissing: boolean
}

/**
 * A single solver row from a BenchmarkReport with the rate labels already
 * parsed into numbers, or null when the source explicitly reports "n/a".
 */
export interface BenchmarkSummaryEntry {
  datasetName: string
  effortLabel: string
  solverName: string
  completedRate: number | null
  relaxedDrcRate: number | null
  p50TimeMs: number | null
  p95TimeMs: number | null
  avgVia: number | null
}

interface RateLabelContext {
  sourceLabel: string
  datasetName: string
  solverName: string
  metricName: "completedRateLabel" | "relaxedDrcRateLabel"
}

interface RateLabelParseInput {
  label: string
  context?: RateLabelContext
}

interface RequiredRegressionValueInput {
  regression: Regression
  value: number | null
  valueName: string
}

interface RequiredRegressionDeltaInput {
  regression: Regression
  delta: number | null
}

interface FlagValueInput {
  args: string[]
  flagName: string
}

const VALUE_FLAGS = new Set([
  "--baseline",
  "--commit",
  "--commit-url",
  "--current",
  "--out",
  "--run-url",
  "--slack-out",
])

const BOOLEAN_FLAGS = new Set([
  "--allow-missing-baseline",
  "--fail-on-regression",
])

// -----------------------------------------------------------------------------
// Parsing / normalization
// -----------------------------------------------------------------------------

const isObjectRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null

const isSolverRunSummary = (input: unknown): input is SolverRunSummary => {
  if (!isObjectRecord(input)) {
    return false
  }
  return (
    typeof input.solverName === "string" &&
    input.solverName.trim() !== "" &&
    typeof input.completedRateLabel === "string" &&
    input.completedRateLabel.trim() !== "" &&
    typeof input.relaxedDrcRateLabel === "string" &&
    input.relaxedDrcRateLabel.trim() !== "" &&
    typeof input.timedOutLabel === "string" &&
    input.timedOutLabel.trim() !== "" &&
    (input.p50TimeMs === null ||
      (typeof input.p50TimeMs === "number" &&
        Number.isFinite(input.p50TimeMs) &&
        input.p50TimeMs >= 0)) &&
    (input.p95TimeMs === null ||
      (typeof input.p95TimeMs === "number" &&
        Number.isFinite(input.p95TimeMs) &&
        input.p95TimeMs >= 0)) &&
    (input.avgVia === null ||
      (typeof input.avgVia === "number" &&
        Number.isFinite(input.avgVia) &&
        input.avgVia >= 0))
  )
}

const isBenchmarkReport = (input: unknown): input is BenchmarkReport => {
  if (!isObjectRecord(input)) {
    return false
  }
  return (
    input.version === 1 &&
    typeof input.datasetName === "string" &&
    input.datasetName.trim() !== "" &&
    typeof input.scenarioCount === "number" &&
    Number.isInteger(input.scenarioCount) &&
    input.scenarioCount > 0 &&
    typeof input.effortLabel === "string" &&
    input.effortLabel.trim() !== "" &&
    Array.isArray(input.summary) &&
    input.summary.length > 0 &&
    input.summary.every(isSolverRunSummary) &&
    Array.isArray(input.solverFailureSummary) &&
    Array.isArray(input.timeoutSummary) &&
    Array.isArray(input.failureSummary) &&
    Array.isArray(input.snapshots) &&
    Array.isArray(input.tests)
  )
}

const isBenchmarkReportCollection = (
  input: unknown,
): input is { reports: BenchmarkReport[] } => {
  if (!isObjectRecord(input)) {
    return false
  }
  return (
    input.version === 2 &&
    input.kind === "benchmark-report-collection" &&
    Array.isArray(input.reports) &&
    input.reports.length > 0 &&
    input.reports.every(isBenchmarkReport)
  )
}

/**
 * Normalize a parsed benchmark JSON into a flat list of BenchmarkReport.
 * Accepts both a v1 single report and a v2 benchmark-report-collection.
 * Throws (fail-loud) on anything else — a malformed artifact is a real error,
 * not something to paper over with a default.
 */
export const normalizeBenchmarkReports = (
  parsed: unknown,
  sourceLabel: string,
): BenchmarkReport[] => {
  if (isBenchmarkReportCollection(parsed)) {
    return parsed.reports
  }
  if (isBenchmarkReport(parsed)) {
    return [parsed]
  }
  throw new Error(
    `Malformed benchmark report in ${sourceLabel}: expected a BenchmarkReport or a benchmark-report-collection`,
  )
}

/**
 * Parse a rate label like "97.5%" or "97.5% (timed out 2.5%)".
 * Returns null only for the explicit "n/a" sentinel.
 */
export const parseRateLabel = ({
  label,
  context,
}: RateLabelParseInput): number | null => {
  const trimmedLabel = label.trim()
  if (trimmedLabel === "n/a") {
    return null
  }

  const match = trimmedLabel.match(/^(\d+(?:\.\d+)?)%(?: \([^)]*\))?$/)
  if (!match) {
    const contextText = context
      ? ` for ${context.sourceLabel} ${context.datasetName} ${context.solverName} ${context.metricName}`
      : ""
    throw new Error(`Malformed rate label${contextText}: "${label}"`)
  }

  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    const contextText = context
      ? ` for ${context.sourceLabel} ${context.datasetName} ${context.solverName} ${context.metricName}`
      : ""
    throw new Error(`Rate label out of range${contextText}: "${label}"`)
  }

  return value
}

const makeCompositeKey = ({
  datasetName,
  solverName,
  effortLabel,
}: {
  datasetName: string
  solverName: string
  effortLabel: string
}): string => `${datasetName}::${solverName}::${effortLabel}`

/**
 * Flatten reports into a map keyed by datasetName + solverName + effortLabel.
 * If the same key appears twice within one file, the benchmark artifact is
 * ambiguous and comparison must stop instead of guessing which row to use.
 */
export const buildSummaryEntryMap = (
  reports: BenchmarkReport[],
  sourceLabel: string,
): Map<string, BenchmarkSummaryEntry> => {
  const entryMap = new Map<string, BenchmarkSummaryEntry>()

  for (const report of reports) {
    const datasetName =
      parseDatasetName(report.datasetName) ?? report.datasetName
    const effortLabel = report.effortLabel

    for (const summary of report.summary) {
      const entry: BenchmarkSummaryEntry = {
        datasetName,
        effortLabel,
        solverName: summary.solverName,
        completedRate: parseRateLabel({
          label: summary.completedRateLabel,
          context: {
            sourceLabel,
            datasetName,
            solverName: summary.solverName,
            metricName: "completedRateLabel",
          },
        }),
        relaxedDrcRate: parseRateLabel({
          label: summary.relaxedDrcRateLabel,
          context: {
            sourceLabel,
            datasetName,
            solverName: summary.solverName,
            metricName: "relaxedDrcRateLabel",
          },
        }),
        p50TimeMs: summary.p50TimeMs,
        p95TimeMs: summary.p95TimeMs,
        avgVia: summary.avgVia,
      }

      const baseKey = makeCompositeKey({
        datasetName,
        solverName: summary.solverName,
        effortLabel,
      })

      if (!entryMap.has(baseKey)) {
        entryMap.set(baseKey, entry)
        continue
      }

      throw new Error(
        `Duplicate benchmark summary key "${baseKey}" in ${sourceLabel}; datasetName + solverName + effortLabel must uniquely identify a row`,
      )
    }
  }

  return entryMap
}

// -----------------------------------------------------------------------------
// Detection (pure)
// -----------------------------------------------------------------------------

const percentDelta = (
  baselineValue: number,
  currentValue: number,
): number | null => {
  if (baselineValue === 0) {
    return null
  }
  return ((currentValue - baselineValue) / baselineValue) * 100
}

/**
 * Compare a single time/via metric where an INCREASE is bad.
 * Returns a Regression when the increase exceeds thresholds, else null.
 */
const detectIncreaseRegression = ({
  entry,
  baselineEntry,
  metric,
  baselineValue,
  currentValue,
  increasePct,
  minAbsoluteDelta,
}: {
  entry: BenchmarkSummaryEntry
  baselineEntry: BenchmarkSummaryEntry
  metric: RegressionMetric
  baselineValue: number | null
  currentValue: number | null
  increasePct: number
  minAbsoluteDelta: number
}): Regression | null => {
  // Both null: nothing to compare.
  if (baselineValue === null && currentValue === null) {
    return null
  }
  // Baseline had no value: cannot compute a regression from nothing.
  if (baselineValue === null) {
    return null
  }
  // Current went null while baseline had a value: solving got worse. Do NOT
  // coerce null to 0 — report it honestly as a null regression.
  if (currentValue === null) {
    return {
      datasetName: baselineEntry.datasetName,
      solverName: baselineEntry.solverName,
      effortLabel: baselineEntry.effortLabel,
      metric,
      kind: "metric-null",
      baselineValue,
      currentValue: null,
      delta: null,
      deltaPct: null,
    }
  }

  const delta = currentValue - baselineValue
  if (delta < minAbsoluteDelta) {
    return null
  }
  const deltaPct = percentDelta(baselineValue, currentValue)
  // When baseline is 0 (deltaPct null) any increase past the absolute floor is
  // a regression; otherwise require the percentage threshold too.
  if (deltaPct !== null && deltaPct <= increasePct) {
    return null
  }

  return {
    datasetName: entry.datasetName,
    solverName: entry.solverName,
    effortLabel: entry.effortLabel,
    metric,
    kind: "metric-regression",
    baselineValue,
    currentValue,
    delta,
    deltaPct,
  }
}

/**
 * Compare a rate metric where a DROP is bad (Completed%, Relaxed DRC%).
 */
const detectRateDropRegression = ({
  entry,
  baselineEntry,
  metric,
  baselineValue,
  currentValue,
  dropPp,
}: {
  entry: BenchmarkSummaryEntry
  baselineEntry: BenchmarkSummaryEntry
  metric: RegressionMetric
  baselineValue: number | null
  currentValue: number | null
  dropPp: number
}): Regression | null => {
  if (baselineValue === null && currentValue === null) {
    return null
  }
  if (baselineValue === null) {
    return null
  }
  if (currentValue === null) {
    return {
      datasetName: baselineEntry.datasetName,
      solverName: baselineEntry.solverName,
      effortLabel: baselineEntry.effortLabel,
      metric,
      kind: "metric-null",
      baselineValue,
      currentValue: null,
      delta: null,
      deltaPct: null,
    }
  }

  const delta = currentValue - baselineValue
  const drop = -delta
  if (drop <= dropPp) {
    return null
  }

  return {
    datasetName: entry.datasetName,
    solverName: entry.solverName,
    effortLabel: entry.effortLabel,
    metric,
    kind: "metric-regression",
    baselineValue,
    currentValue,
    delta,
    deltaPct: percentDelta(baselineValue, currentValue),
  }
}

/**
 * The core comparison. Pure — takes flattened maps and returns a report.
 */
export const detectRegressions = ({
  current,
  baseline,
  thresholds,
  baselineMissing,
}: {
  current: Map<string, BenchmarkSummaryEntry>
  baseline: Map<string, BenchmarkSummaryEntry>
  thresholds: RegressionThresholds
  baselineMissing: boolean
}): RegressionReport => {
  const regressions: Regression[] = []
  const newDatasets: NewDatasetEntry[] = []
  let comparedKeys = 0

  for (const [key, baselineEntry] of baseline) {
    const entry = current.get(key)

    if (!entry) {
      // Whole dataset/solver row disappeared from the benchmark.
      regressions.push({
        datasetName: baselineEntry.datasetName,
        solverName: baselineEntry.solverName,
        effortLabel: baselineEntry.effortLabel,
        metric: null,
        kind: "dataset-dropped",
        baselineValue: null,
        currentValue: null,
        delta: null,
        deltaPct: null,
      })
      continue
    }

    comparedKeys += 1

    const completed = detectRateDropRegression({
      entry,
      baselineEntry,
      metric: "completedRate",
      baselineValue: baselineEntry.completedRate,
      currentValue: entry.completedRate,
      dropPp: thresholds.completedRateDropPp,
    })
    if (completed) regressions.push(completed)

    const drc = detectRateDropRegression({
      entry,
      baselineEntry,
      metric: "relaxedDrcRate",
      baselineValue: baselineEntry.relaxedDrcRate,
      currentValue: entry.relaxedDrcRate,
      dropPp: thresholds.drcRateDropPp,
    })
    if (drc) regressions.push(drc)

    const p50 = detectIncreaseRegression({
      entry,
      baselineEntry,
      metric: "p50TimeMs",
      baselineValue: baselineEntry.p50TimeMs,
      currentValue: entry.p50TimeMs,
      increasePct: thresholds.p50IncreasePct,
      minAbsoluteDelta: thresholds.minTimeDeltaMs,
    })
    if (p50) regressions.push(p50)

    const p95 = detectIncreaseRegression({
      entry,
      baselineEntry,
      metric: "p95TimeMs",
      baselineValue: baselineEntry.p95TimeMs,
      currentValue: entry.p95TimeMs,
      increasePct: thresholds.p95IncreasePct,
      minAbsoluteDelta: thresholds.minTimeDeltaMs,
    })
    if (p95) regressions.push(p95)

    const avgVia = detectIncreaseRegression({
      entry,
      baselineEntry,
      metric: "avgVia",
      baselineValue: baselineEntry.avgVia,
      currentValue: entry.avgVia,
      increasePct: thresholds.avgViaIncreasePct,
      // vias are unitless counts; the ms floor doesn't apply.
      minAbsoluteDelta: 0,
    })
    if (avgVia) regressions.push(avgVia)
  }

  for (const [key, entry] of current) {
    if (!baseline.has(key)) {
      newDatasets.push({
        datasetName: entry.datasetName,
        solverName: entry.solverName,
        effortLabel: entry.effortLabel,
      })
    }
  }

  return {
    hasRegressions: regressions.length > 0,
    regressions,
    newDatasets,
    comparedKeys,
    baselineMissing,
  }
}

// -----------------------------------------------------------------------------
// Slack Block Kit payload
// -----------------------------------------------------------------------------

const MAX_DATASET_SECTIONS = 40

const formatMs = (value: number): string => `${Math.round(value)}ms`

const formatVia = (value: number): string => value.toFixed(2)

const formatSignedPp = (delta: number): string => {
  const sign = delta > 0 ? "+" : "−"
  return `${sign}${Math.abs(delta).toFixed(1)}pp`
}

const formatSignedPct = (deltaPct: number): string => {
  const sign = deltaPct > 0 ? "+" : "−"
  return `${sign}${Math.abs(deltaPct).toFixed(1)}%`
}

const METRIC_TITLES: Record<RegressionMetric, string> = {
  completedRate: "Completed",
  relaxedDrcRate: "Relaxed DRC",
  p50TimeMs: "P50",
  p95TimeMs: "P95",
  avgVia: "Avg Via",
}

const getRequiredRegressionValue = ({
  regression,
  value,
  valueName,
}: RequiredRegressionValueInput): number => {
  if (value === null) {
    throw new Error(
      `Invalid regression state for ${regression.datasetName} ${regression.solverName} ${regression.kind}: missing ${valueName}`,
    )
  }
  return value
}

const getRequiredRegressionDelta = ({
  regression,
  delta,
}: RequiredRegressionDeltaInput): number => {
  if (delta === null) {
    throw new Error(
      `Invalid regression state for ${regression.datasetName} ${regression.solverName} ${regression.kind}: missing delta`,
    )
  }
  return delta
}

const renderRegressionLine = (regression: Regression): string => {
  if (regression.kind === "dataset-dropped") {
    return `• ${regression.solverName} — dropped from benchmark (was present in baseline)`
  }

  const metric = regression.metric
  const title = METRIC_TITLES[metric]

  if (regression.kind === "metric-null") {
    // The metric had a value and is now n/a (nothing solved).
    const baselineValue = getRequiredRegressionValue({
      regression,
      value: regression.baselineValue,
      valueName: "baselineValue",
    })
    const from =
      metric === "avgVia"
        ? formatVia(baselineValue)
        : metric === "p50TimeMs" || metric === "p95TimeMs"
          ? formatMs(baselineValue)
          : `${baselineValue.toFixed(1)}%`
    return `• ${regression.solverName} — ${title}: ${from} → n/a (no longer reported)`
  }

  const baselineValue = getRequiredRegressionValue({
    regression,
    value: regression.baselineValue,
    valueName: "baselineValue",
  })
  const currentValue = getRequiredRegressionValue({
    regression,
    value: regression.currentValue,
    valueName: "currentValue",
  })

  if (metric === "completedRate" || metric === "relaxedDrcRate") {
    return `• ${regression.solverName} — ${title}: ${baselineValue.toFixed(1)}% → ${currentValue.toFixed(1)}% (${formatSignedPp(
      getRequiredRegressionDelta({ regression, delta: regression.delta }),
    )})`
  }

  if (metric === "p50TimeMs" || metric === "p95TimeMs") {
    const pct =
      regression.deltaPct === null
        ? ""
        : ` (${formatSignedPct(regression.deltaPct)})`
    return `• ${regression.solverName} — ${title}: ${formatMs(baselineValue)} → ${formatMs(currentValue)}${pct}`
  }

  // avgVia
  const pct =
    regression.deltaPct === null
      ? ""
      : ` (${formatSignedPct(regression.deltaPct)})`
  return `• ${regression.solverName} — ${title}: ${formatVia(baselineValue)} → ${formatVia(currentValue)}${pct}`
}

export const buildSlackPayload = ({
  report,
  runUrl,
  commit,
  commitUrl,
}: {
  report: RegressionReport
  runUrl?: string
  commit?: string
  commitUrl?: string
}): { blocks: unknown[] } => {
  const blocks: unknown[] = []

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: "🔻 Benchmark regression on main",
      emoji: true,
    },
  })

  // Commit + run context line.
  const contextParts: string[] = []
  if (commit) {
    const shortCommit = commit.slice(0, 7)
    contextParts.push(
      commitUrl
        ? `*Commit:* <${commitUrl}|${shortCommit}>`
        : `*Commit:* ${shortCommit}`,
    )
  }
  if (runUrl) {
    contextParts.push(`*Run:* <${runUrl}|View benchmark run>`)
  }
  if (contextParts.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: contextParts.join("  ·  ") },
    })
  }

  blocks.push({ type: "divider" })

  // Group regressions by dataset, preserving first-seen order.
  const byDataset = new Map<string, Regression[]>()
  for (const regression of report.regressions) {
    const list = byDataset.get(regression.datasetName)
    if (list) {
      list.push(regression)
    } else {
      byDataset.set(regression.datasetName, [regression])
    }
  }

  const datasetNames = [...byDataset.keys()]
  const shownDatasetNames = datasetNames.slice(0, MAX_DATASET_SECTIONS)

  for (const datasetName of shownDatasetNames) {
    const list = byDataset.get(datasetName)
    if (!list) {
      throw new Error(
        `Invalid Slack payload state: dataset "${datasetName}" has no regression list`,
      )
    }
    const lines = list.map(renderRegressionLine)
    // Slack section text hard limit is 3000 chars; keep well under it.
    let text = `*${datasetName}*\n${lines.join("\n")}`
    if (text.length > 2900) {
      text = `${text.slice(0, 2870)}\n…(truncated)`
    }
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text },
    })
  }

  const remaining = datasetNames.length - shownDatasetNames.length
  if (remaining > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `…and ${remaining} more dataset${remaining === 1 ? "" : "s"} with regressions (see the benchmark-regressions.json artifact).`,
        },
      ],
    })
  }

  return { blocks }
}

// -----------------------------------------------------------------------------
// Human-readable stdout summary
// -----------------------------------------------------------------------------

const renderHumanSummary = (report: RegressionReport): string => {
  if (report.baselineMissing) {
    return "No baseline available, skipping comparison."
  }
  const lines: string[] = []
  lines.push(
    `Compared ${report.comparedKeys} dataset/solver key(s) against baseline.`,
  )
  if (!report.hasRegressions) {
    lines.push("No regressions detected. ✅")
  } else {
    lines.push(`Found ${report.regressions.length} regression(s):`)
    for (const regression of report.regressions) {
      lines.push(
        `  - ${regression.datasetName} · ${regression.solverName} · ${
          regression.metric ?? regression.kind
        } (${regression.kind})`,
      )
    }
  }
  if (report.newDatasets.length > 0) {
    lines.push(`New dataset/solver rows (info, not regressions):`)
    for (const entry of report.newDatasets) {
      lines.push(`  + ${entry.datasetName} · ${entry.solverName}`)
    }
  }
  return lines.join("\n")
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

const getFlagValue = ({
  args,
  flagName,
}: FlagValueInput): string | undefined => {
  const flagIndex = args.indexOf(flagName)
  if (flagIndex === -1) {
    return undefined
  }
  const value = args[flagIndex + 1]
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flagName}`)
  }
  return value
}

const assertKnownFlags = (args: string[]): void => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`)
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = args[index + 1]
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`)
      }
      index += 1
      continue
    }
    if (!BOOLEAN_FLAGS.has(arg)) {
      throw new Error(`Unknown flag: ${arg}`)
    }
  }
}

const readJsonFile = async (filePath: string): Promise<unknown> => {
  const rawJson = await Bun.file(filePath).text()
  if (!rawJson.trim()) {
    throw new Error(`Empty benchmark report file: ${filePath}`)
  }
  try {
    return JSON.parse(rawJson)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse JSON in ${filePath}: ${message}`)
  }
}

const writeGithubOutput = async (hasRegressions: boolean): Promise<void> => {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) {
    return
  }
  const existing = existsSync(outputPath)
    ? await Bun.file(outputPath).text()
    : ""
  await Bun.write(
    outputPath,
    `${existing}hasRegressions=${hasRegressions ? "true" : "false"}\n`,
  )
}

const runCli = async (args: string[]): Promise<number> => {
  assertKnownFlags(args)

  const currentPath = getFlagValue({ args, flagName: "--current" })
  const baselinePath = getFlagValue({ args, flagName: "--baseline" })
  const outPath =
    getFlagValue({ args, flagName: "--out" }) ?? "benchmark-regressions.json"
  const slackOutPath = getFlagValue({ args, flagName: "--slack-out" })
  const runUrl = getFlagValue({ args, flagName: "--run-url" })
  const commit = getFlagValue({ args, flagName: "--commit" })
  const commitUrl = getFlagValue({ args, flagName: "--commit-url" })
  const allowMissingBaseline = args.includes("--allow-missing-baseline")
  const failOnRegression = args.includes("--fail-on-regression")

  if (!currentPath) {
    throw new Error(
      "Usage: bun scripts/benchmark/detect-benchmark-regressions.ts --current <path> --baseline <path> [--out <path>] [--slack-out <path>] [--run-url <url>] [--commit <sha>] [--commit-url <url>] [--allow-missing-baseline] [--fail-on-regression]",
    )
  }

  if (!existsSync(currentPath)) {
    throw new Error(`Current benchmark report not found: ${currentPath}`)
  }

  if (!baselinePath) {
    if (!allowMissingBaseline) {
      throw new Error(
        "Missing --baseline. Pass --allow-missing-baseline only for an explicit cold start.",
      )
    }
    console.log("No baseline available, skipping comparison.")
    const report: RegressionReport = {
      hasRegressions: false,
      regressions: [],
      newDatasets: [],
      comparedKeys: 0,
      baselineMissing: true,
    }
    await Bun.write(outPath, JSON.stringify(report, null, 2))
    await writeGithubOutput(false)
    return 0
  }

  if (allowMissingBaseline) {
    throw new Error(
      "--allow-missing-baseline cannot be used when --baseline is provided",
    )
  }

  if (!existsSync(baselinePath)) {
    throw new Error(`Baseline benchmark report not found: ${baselinePath}`)
  }

  const currentReports = normalizeBenchmarkReports(
    await readJsonFile(currentPath),
    currentPath,
  )
  const baselineReports = normalizeBenchmarkReports(
    await readJsonFile(baselinePath),
    baselinePath,
  )

  const currentMap = buildSummaryEntryMap(currentReports, "current")
  const baselineMap = buildSummaryEntryMap(baselineReports, "baseline")

  const report = detectRegressions({
    current: currentMap,
    baseline: baselineMap,
    thresholds: DEFAULT_THRESHOLDS,
    baselineMissing: false,
  })

  await Bun.write(outPath, JSON.stringify(report, null, 2))

  if (slackOutPath && report.hasRegressions) {
    const payload = buildSlackPayload({
      report,
      runUrl,
      commit,
      commitUrl,
    })
    await Bun.write(slackOutPath, JSON.stringify(payload, null, 2))
  }

  console.log(renderHumanSummary(report))
  await writeGithubOutput(report.hasRegressions)

  return failOnRegression && report.hasRegressions ? 1 : 0
}

if (import.meta.main) {
  runCli(Bun.argv.slice(2))
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(message)
      process.exit(1)
    })
}
