const formatTime = (timeMs) => {
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs)) {
    return "n/a"
  }
  return timeMs < 1_000
    ? `${Math.round(timeMs)}ms`
    : `${(timeMs / 1_000).toFixed(1)}s`
}

const formatAverage = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a"
  }
  return value.toFixed(2)
}

const formatSolverDisplayName = (solverName, effortLabel) => {
  const solver = String(solverName ?? "").replace(
    /^AutoroutingPipelineSolver(\d+).*$/,
    "Pipeline$1",
  )
  const match = String(effortLabel ?? "").match(/^(\d+)x effort$/)
  if (!match)
    return `${solver}${effortLabel === "mixed effort" ? "(mixed)" : ""}`
  const effort = Number.parseInt(match[1], 10)
  return `${solver}${Number.isFinite(effort) && effort > 1 ? `(${effort}x)` : ""}`
}

const parsePercentLabel = (label) => {
  const match = String(label ?? "")
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)%/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

const formatPercentPointDelta = (mainLabel, prLabel) => {
  const mainValue = parsePercentLabel(mainLabel)
  const prValue = parsePercentLabel(prLabel)
  if (mainValue === null || prValue === null) return "n/a"
  const delta = prValue - mainValue
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pp`
}

const formatRelativeDelta = (mainValue, prValue) => {
  if (
    typeof mainValue !== "number" ||
    typeof prValue !== "number" ||
    !Number.isFinite(mainValue) ||
    !Number.isFinite(prValue) ||
    mainValue === 0
  ) {
    return "n/a"
  }
  const delta = ((prValue - mainValue) / mainValue) * 100
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`
}

const getTimeoutCount = (report, solverName) => {
  if (!Array.isArray(report?.tests)) return null
  return report.tests.filter(
    (test) => test.solverName === solverName && test.didTimeout,
  ).length
}

const getDrcIssueCount = (report, solverName) => {
  if (!Array.isArray(report?.tests)) return null
  const completedTests = report.tests.filter(
    (test) => test.solverName === solverName && test.didSolve,
  )
  if (
    completedTests.length === 0 ||
    completedTests.some(
      (test) =>
        typeof test.drcErrorCount !== "number" ||
        !Number.isFinite(test.drcErrorCount),
    )
  ) {
    return null
  }
  return completedTests.reduce(
    (total, test) => total + test.drcErrorCount,
    0,
  )
}

const getTimePercentile = (report, solverName, percentile) => {
  if (!Array.isArray(report?.tests)) return null
  const elapsedTimes = report.tests
    .filter(
      (test) =>
        test.solverName === solverName &&
        (test.didSolve || test.didTimeout) &&
        typeof test.elapsedTimeMs === "number" &&
        Number.isFinite(test.elapsedTimeMs),
    )
    .map((test) => test.elapsedTimeMs)
    .sort((a, b) => a - b)
  if (elapsedTimes.length === 0) return null

  const index = (elapsedTimes.length - 1) * percentile
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)
  const lowerValue = elapsedTimes[lowerIndex]
  const upperValue = elapsedTimes[upperIndex]
  return lowerValue + (upperValue - lowerValue) * (index - lowerIndex)
}

const formatCountDelta = (mainValue, prValue) => {
  if (typeof mainValue !== "number" || typeof prValue !== "number") {
    return "n/a"
  }
  const delta = prValue - mainValue
  return `${delta > 0 ? "+" : ""}${delta}`
}

export const renderBenchmarkComparison = ({
  mainReport,
  prReport,
  fallbackText = "(benchmark results were not produced)",
  maxLength = 60_000,
}) => {
  if (!Array.isArray(prReport?.summary) || prReport.summary.length === 0) {
    const truncated =
      fallbackText.length > maxLength
        ? `${fallbackText.slice(0, maxLength)}\n\n...truncated...`
        : fallbackText
    return ["```", truncated, "```"]
  }

  const mainSummaries = new Map(
    Array.isArray(mainReport?.summary)
      ? mainReport.summary.map((row) => [row.solverName, row])
      : [],
  )
  const rows = []
  for (const prSummary of prReport.summary) {
    const mainSummary = mainSummaries.get(prSummary.solverName)
    const solver = formatSolverDisplayName(
      prSummary.solverName,
      prReport.effortLabel,
    )
    const mainTimeouts = getTimeoutCount(mainReport, prSummary.solverName)
    const prTimeouts = getTimeoutCount(prReport, prSummary.solverName)
    const mainDrcIssues = getDrcIssueCount(mainReport, prSummary.solverName)
    const prDrcIssues = getDrcIssueCount(prReport, prSummary.solverName)
    rows.push(
      `| ${solver} | Completion | ${mainSummary?.completedRateLabel ?? "n/a"} | ${prSummary.completedRateLabel} | ${formatPercentPointDelta(mainSummary?.completedRateLabel, prSummary.completedRateLabel)} |`,
      `| ${solver} | Relaxed DRC pass | ${mainSummary?.relaxedDrcRateLabel ?? "n/a"} | ${prSummary.relaxedDrcRateLabel} | ${formatPercentPointDelta(mainSummary?.relaxedDrcRateLabel, prSummary.relaxedDrcRateLabel)} |`,
      `| ${solver} | DRC issues | ${mainDrcIssues ?? "n/a"} | ${prDrcIssues ?? "n/a"} | ${formatCountDelta(mainDrcIssues, prDrcIssues)} |`,
      `| ${solver} | Timeouts | ${mainTimeouts ?? "n/a"} | ${prTimeouts ?? "n/a"} | ${formatCountDelta(mainTimeouts, prTimeouts)} |`,
    )
    for (const percentile of [50, 60, 70, 80, 90, 95]) {
      const mainTime = getTimePercentile(
        mainReport,
        prSummary.solverName,
        percentile / 100,
      )
      const prTime = getTimePercentile(
        prReport,
        prSummary.solverName,
        percentile / 100,
      )
      rows.push(
        `| ${solver} | P${percentile} time | ${formatTime(mainTime)} | ${formatTime(prTime)} | ${formatRelativeDelta(mainTime, prTime)} |`,
      )
    }
    rows.push(
      `| ${solver} | Average vias | ${formatAverage(mainSummary?.avgVia)} | ${formatAverage(prSummary.avgVia)} | ${formatRelativeDelta(mainSummary?.avgVia, prSummary.avgVia)} |`,
    )
  }

  return [
    `Dataset: ${prReport.datasetName} · Scenarios: ${prReport.scenarioCount} · Effort: ${prReport.effortLabel}`,
    "",
    "| Solver | Metric | Main | PR | Change |",
    "| --- | --- | ---: | ---: | ---: |",
    ...rows,
    "",
    "_DRC issue totals include completed samples; fewer is better._",
    "",
    "_Timing percentiles include solved and timed-out samples. Negative timing changes are faster._",
  ]
}
